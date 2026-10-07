use crate::{
    error::AppError,
    models::{ApiToken, TokenGroup, UpdateTokenGroupInput},
    storage::StoredConnection,
};
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

const TOKEN_PAGE_SIZE: u32 = 100;

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
        let group = input.group_id.trim();
        if group.is_empty() {
            return Err(AppError::Validation("分组不能为空。".to_string()));
        }

        let payload = json!({
            "id": token_id,
            "group": group,
        });
        let response = self
            .request(self.http.put(self.url("/api/token/")))
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::NewApi(format!("更新令牌分组失败：{error}")))?;
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
