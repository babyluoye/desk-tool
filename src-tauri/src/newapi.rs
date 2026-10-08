use crate::{
    error::AppError,
    models::{ApiToken, TokenGroup, UpdateTokenGroupInput},
    storage::StoredConnection,
};
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const TOKEN_PAGE_SIZE: u32 = 100;
const TOKEN_EDIT_FIELDS: &[&str] = &[
    "name",
    "expired_time",
    "remain_quota",
    "unlimited_quota",
    "model_limits_enabled",
    "model_limits",
    "allow_ips",
    "cross_group_retry",
];

pub struct NewApiClient {
    connection: StoredConnection,
    http: Client,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct TokenPage {
    #[serde(default)]
    items: Vec<RemoteToken>,
    #[serde(default)]
    total: u32,
}

#[derive(Debug, Deserialize)]
struct RemoteToken {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default, alias = "key")]
    token: String,
    #[serde(default)]
    status: i32,
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    updated_at: Option<i64>,
    #[serde(default)]
    accessed_time: Option<i64>,
}

// No defaults: omitted fields must not silently become destructive PUT values.
#[derive(Deserialize, Serialize)]
struct TokenGroupUpdate {
    id: u64,
    name: String,
    expired_time: i64,
    remain_quota: i64,
    unlimited_quota: bool,
    model_limits_enabled: bool,
    model_limits: String,
    allow_ips: Option<String>,
    group: String,
    cross_group_retry: bool,
}

impl NewApiClient {
    pub fn new(connection: StoredConnection) -> Result<Self, AppError> {
        let http = Client::builder()
            .user_agent("NewAPI-Desk/0.1")
            .build()
            .map_err(|error| AppError::NewApi(format!("HTTP 客户端初始化失败：{error}")))?;
        Ok(Self { connection, http })
    }

    pub async fn fetch_tokens(&self) -> Result<Vec<ApiToken>, AppError> {
        let mut page = 1u32;
        let mut tokens = Vec::new();

        loop {
            let response = self
                .request(self.http.get(self.url("/api/token/")))
                .query(&[("p", page), ("size", TOKEN_PAGE_SIZE)])
                .send()
                .await
                .map_err(|error| AppError::NewApi(format!("获取令牌列表失败：{error}")))?;
            let response: ApiResponse<TokenPage> = parse_response(response).await?;
            let Some(result) = response.data else {
                break;
            };
            let count = result.items.len();
            tokens.extend(result.items.into_iter().map(map_token));
            if count == 0 || tokens.len() as u32 >= result.total || count < TOKEN_PAGE_SIZE as usize {
                break;
            }
            page += 1;
        }

        Ok(tokens)
    }

    pub async fn fetch_groups(&self) -> Result<Vec<TokenGroup>, AppError> {
        let response = self
            .request(self.http.get(self.url("/api/group/")))
            .send()
            .await
            .map_err(|error| AppError::NewApi(format!("获取分组列表失败：{error}")))?;
        let response: ApiResponse<Vec<String>> = parse_response(response).await?;

        let names = response.data.unwrap_or_default();
        Ok(names
            .into_iter()
            .map(|name| TokenGroup {
                id: name.clone(),
                name,
                token_count: 0,
            })
            .collect())
    }

    pub async fn update_token_group(
        &self,
        input: &UpdateTokenGroupInput,
    ) -> Result<(), AppError> {
        let token_id = input
            .token_id
            .parse::<u64>()
            .map_err(|_| AppError::Validation("令牌标识格式无效。".to_string()))?;
        if token_id == 0 || token_id > i64::MAX as u64 {
            return Err(AppError::Validation("令牌标识格式无效。".to_string()));
        }
        let group = input.group_id.as_str();
        if group.trim().is_empty() {
            return Err(AppError::Validation("分组不能为空。".to_string()));
        }

        // This API is a full edit, not PATCH. Refresh fields immediately before PUT.
        let detail = self
            .request(self.http.get(self.url(&format!("/api/token/{token_id}"))))
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .send()
            .await
            .map_err(|_| AppError::NewApi("读取令牌最新配置失败，未提交分组修改。".to_string()))?;
        let detail: ApiResponse<Value> = parse_response(detail).await?;
        let detail = detail.data.ok_or_else(|| {
            AppError::NewApi("服务端未返回令牌详情，未提交分组修改。".to_string())
        })?;
        let payload = prepare_group_update(&detail, token_id, group)?;
        let response = self
            .request(self.http.put(self.url("/api/token/")))
            .json(&payload)
            .send()
            .await
            .map_err(|_| AppError::NewApi("更新令牌分组请求失败，本地缓存未修改。".to_string()))?;
        let _: ApiResponse<Value> = parse_response(response).await?;
        Ok(())
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.connection.base_url.trim_end_matches('/'), path)
    }

    fn request(&self, request: RequestBuilder) -> RequestBuilder {
        let credential = self.connection.admin_credential.trim();
        let authorization = if credential.starts_with("Bearer ") {
            credential.to_string()
        } else {
            format!("Bearer {credential}")
        };
        request
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
    }
}

async fn parse_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<ApiResponse<T>, AppError> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| AppError::NewApi(format!("读取 NewAPI 响应失败：{error}")))?;
    let parsed: ApiResponse<T> = serde_json::from_str(&body).map_err(|_| {
        AppError::NewApi(format!("NewAPI 返回了无法识别的响应（HTTP {status}）。"))
    })?;
    if !status.is_success() || !parsed.success {
        let message = if parsed.message.trim().is_empty() {
            format!("NewAPI 请求失败（HTTP {status}）。")
        } else {
            parsed.message.clone()
        };
        return Err(AppError::NewApi(message));
    }
    Ok(parsed)
}

fn prepare_group_update(detail: &Value, token_id: u64, group: &str) -> Result<TokenGroupUpdate, AppError> {
    let fields = detail.as_object().ok_or_else(|| {
        AppError::NewApi("令牌详情格式无效，未提交分组修改。".to_string())
    })?;
    if fields.get("id").and_then(Value::as_u64) != Some(token_id) {
        return Err(AppError::NewApi("服务端返回的令牌标识不匹配，未提交分组修改。".to_string()));
    }

    // Whitelist editable fields: never echo keys, ownership or usage counters in a PUT.
    let mut payload = serde_json::Map::new();
    payload.insert("id".to_string(), json!(token_id));
    payload.insert("group".to_string(), json!(group));
    for &field in TOKEN_EDIT_FIELDS {
        let value = fields.get(field).ok_or_else(|| {
            AppError::NewApi(format!("令牌详情缺少 {field}，为避免覆盖原配置，未提交分组修改。"))
        })?;
        payload.insert(field.to_string(), value.clone());
    }
    // Omit auto_groups: NewAPI preserves them for group=auto; non-auto clears them server-side.
    serde_json::from_value(Value::Object(payload)).map_err(|_| {
        AppError::NewApi("令牌编辑字段格式不兼容，为避免覆盖原配置，未提交分组修改。".to_string())
    })
}

fn map_token(token: RemoteToken) -> ApiToken {
    let group_name = token.group.filter(|group| !group.trim().is_empty());
    let updated_at = token
        .updated_at
        .or(token.accessed_time)
        .and_then(timestamp_to_rfc3339);
    ApiToken {
        id: token.id.to_string(),
        name: if token.name.trim().is_empty() {
            format!("令牌 {}", token.id)
        } else {
            token.name
        },
        masked_token: mask_token(&token.token),
        group_id: group_name.clone(),
        group_name,
        enabled: token.status != 0,
        updated_at,
    }
}

fn mask_token(value: &str) -> String {
    if value.len() <= 8 {
        return "••••••••".to_string();
    }
    let prefix_len = value.char_indices().nth(4).map(|(index, _)| index).unwrap_or(4);
    let suffix_start = value
        .char_indices()
        .rev()
        .nth(3)
        .map(|(index, _)| index)
        .unwrap_or(value.len().saturating_sub(4));
    format!("{}...{}", &value[..prefix_len], &value[suffix_start..])
}

fn timestamp_to_rfc3339(value: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(value, 0).map(|time| time.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_detail(unlimited: bool) -> Value {
        json!({
            "id": 42,
            "name": "Production API",
            "expired_time": -1,
            "remain_quota": 1234567,
            "unlimited_quota": unlimited,
            "model_limits_enabled": true,
            "model_limits": "model-a,model-b",
            "allow_ips": "192.0.2.1\n198.51.100.2",
            "group": "old-group",
            "cross_group_retry": true,
            "auto_groups": ["old-group", "backup-group"],
            "key": "synthetic-test-key",
            "user_id": 7,
            "status": 1,
            "used_quota": 500,
            "created_time": 1700000000,
            "accessed_time": 1700001000
        })
    }

    #[test]
    fn preserves_all_editable_fields_for_limited_and_unlimited_tokens() {
        for unlimited in [false, true] {
            let detail = token_detail(unlimited);
            let update = prepare_group_update(&detail, 42, "new-group").unwrap();
            let payload = serde_json::to_value(update).unwrap();
            assert_eq!(payload["id"], detail["id"]);
            assert_eq!(payload["group"], json!("new-group"));
            for &field in TOKEN_EDIT_FIELDS {
                assert_eq!(payload[field], detail[field], "Changed field: {field}");
            }
            assert_eq!(payload.as_object().unwrap().len(), TOKEN_EDIT_FIELDS.len() + 2);
            for field in ["key", "user_id", "status", "used_quota", "created_time", "accessed_time", "auto_groups"] {
                assert!(payload.get(field).is_none(), "Unexpected field: {field}");
            }
        }
    }

    #[test]
    fn preserves_empty_zero_and_nullable_values() {
        let mut detail = token_detail(true);
        detail["name"] = json!("");
        detail["remain_quota"] = json!(0);
        detail["model_limits_enabled"] = json!(false);
        detail["model_limits"] = json!("");
        detail["allow_ips"] = Value::Null;
        detail["cross_group_retry"] = json!(false);
        let payload = serde_json::to_value(prepare_group_update(&detail, 42, "auto").unwrap()).unwrap();
        for &field in TOKEN_EDIT_FIELDS {
            assert_eq!(payload[field], detail[field], "Changed field: {field}");
        }
        assert!(payload.get("auto_groups").is_none());
    }

    #[test]
    fn refuses_every_missing_editable_field_including_nullable_allow_ips() {
        for &field in TOKEN_EDIT_FIELDS {
            let mut detail = token_detail(true);
            detail.as_object_mut().unwrap().remove(field);
            assert!(prepare_group_update(&detail, 42, "new-group").is_err(), "Missing: {field}");
        }
    }

    #[test]
    fn refuses_wrong_types_without_substituting_defaults() {
        for &field in TOKEN_EDIT_FIELDS {
            let mut detail = token_detail(true);
            detail[field] = json!([]);
            assert!(prepare_group_update(&detail, 42, "new-group").is_err(), "Wrong type: {field}");
        }
    }

    #[test]
    fn refuses_missing_mismatched_or_malformed_details() {
        let detail = token_detail(true);
        assert!(prepare_group_update(&detail, 43, "new-group").is_err());
        let mut missing_id = detail;
        missing_id.as_object_mut().unwrap().remove("id");
        assert!(prepare_group_update(&missing_id, 42, "new-group").is_err());
        assert!(prepare_group_update(&Value::Null, 42, "new-group").is_err());
        assert!(prepare_group_update(&json!([]), 42, "new-group").is_err());
    }
}
