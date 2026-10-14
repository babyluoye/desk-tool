use crate::{error::AppError, models::{DnsRecord, DnsRecordInput, CloudflareZone}, storage::SecureStore};
use reqwest::{header, Client, RequestBuilder, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{net::{Ipv4Addr, Ipv6Addr}, time::Duration};

const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const PAGE_SIZE: u32 = 50;
const MAX_PAGES: u32 = 100;

#[derive(Clone)]
pub struct CloudflareClient {
    http: Client,
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    success: bool,
    result: Option<T>,
    result_info: Option<ResultInfo>,
}

#[derive(Debug, Deserialize)]
struct ResultInfo {
    total_pages: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawZone {
    id: String,
    name: String,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawDnsRecord {
    id: String,
    r#type: String,
    name: String,
    content: Option<String>,
    ttl: u32,
    proxied: Option<bool>,
    priority: Option<u16>,
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct DnsRecordWrite {
    r#type: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    ttl: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    proxied: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

impl CloudflareClient {
    pub fn new(token: &str) -> Result<Self, AppError> {
        if token.is_empty() || token.len() > 4096 || token.chars().any(char::is_control) {
            return Err(AppError::Validation("Cloudflare API Token 格式无效。".into()));
        }
        let mut headers = header::HeaderMap::new();
        let mut authorization = format!("Bearer {token}").parse::<header::HeaderValue>()
            .map_err(|_| AppError::Validation("Cloudflare API Token 格式无效。".into()))?;
        authorization.set_sensitive(true);
        headers.insert(header::AUTHORIZATION, authorization);
        let http = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| AppError::Cloudflare("无法初始化 Cloudflare 请求。".into()))?;
        Ok(Self { http })
    }

    pub async fn fetch_zones(&self) -> Result<Vec<CloudflareZone>, AppError> {
        let mut zones = Vec::new();
        for page in 1..=MAX_PAGES {
            let endpoint = format!("{API_BASE}/zones?per_page={PAGE_SIZE}&page={page}&order=name&direction=asc");
            let response: Envelope<Vec<RawZone>> = self.send(self.http.get(endpoint)).await?;
            let batch = response.result.ok_or_else(|| AppError::Cloudflare("Cloudflare 未返回域名列表。".into()))?;
            let batch_len = batch.len();
            zones.extend(batch.into_iter().map(|zone| CloudflareZone {
                id: zone.id,
                name: zone.name,
                status: zone.status.unwrap_or_else(|| "unknown".into()),
            }));
            let total_pages = response.result_info.and_then(|info| info.total_pages);
            if total_pages.map(|total| page >= total).unwrap_or(batch_len < PAGE_SIZE as usize) {
                return Ok(zones);
            }
        }
        Err(AppError::Cloudflare("Cloudflare 域名数量超出单次读取上限。".into()))
    }

    pub async fn fetch_records(&self, zone_id: &str) -> Result<Vec<DnsRecord>, AppError> {
        validate_id(zone_id, "域名")?;
        let mut records = Vec::new();
        for page in 1..=MAX_PAGES {
            let endpoint = format!("{API_BASE}/zones/{zone_id}/dns_records?per_page={PAGE_SIZE}&page={page}&order=type&direction=asc");
            let response: Envelope<Vec<RawDnsRecord>> = self.send(self.http.get(endpoint)).await?;
            let batch = response.result.ok_or_else(|| AppError::Cloudflare("Cloudflare 未返回 DNS 记录。".into()))?;
            let batch_len = batch.len();
            records.extend(batch.into_iter().map(|record| map_dns_record(record, zone_id)));
            let total_pages = response.result_info.and_then(|info| info.total_pages);
            if total_pages.map(|total| page >= total).unwrap_or(batch_len < PAGE_SIZE as usize) {
                return Ok(records);
            }
        }
        Err(AppError::Cloudflare("DNS 记录数量超出单次读取上限。".into()))
    }

    pub async fn validate_zone(&self, zone_id: &str, zone_name: &str) -> Result<(), AppError> {
        validate_id(zone_id, "域名")?;
        let expected = zone_name.trim().trim_end_matches('.').to_ascii_lowercase();
        let zones = self.fetch_zones().await?;
        if zones.iter().any(|zone| zone.id == zone_id && zone.name.eq_ignore_ascii_case(&expected)) {
            Ok(())
        } else {
            Err(AppError::Validation("所选 Cloudflare 域名无效或已无访问权限。".into()))
        }
    }

    pub async fn save_record(&self, input: DnsRecordInput) -> Result<(), AppError> {
        validate_id(&input.zone_id, "域名")?;
        if let Some(id) = input.record_id.as_deref() { validate_id(id, "DNS 记录")?; }
        let body = build_record_write(&input)?;
        let endpoint = match input.record_id.as_deref() {
            Some(id) => format!("{API_BASE}/zones/{}/dns_records/{id}", input.zone_id),
            None => format!("{API_BASE}/zones/{}/dns_records", input.zone_id),
        };
        let request = if input.record_id.is_some() {
            self.http.patch(endpoint).json(&body)
        } else {
            self.http.post(endpoint).json(&body)
        };
        let _: Envelope<Value> = self.send(request).await?;
        Ok(())
    }

    pub async fn delete_record(&self, zone_id: &str, record_id: &str) -> Result<(), AppError> {
        validate_id(zone_id, "域名")?;
        validate_id(record_id, "DNS 记录")?;
        let endpoint = format!("{API_BASE}/zones/{zone_id}/dns_records/{record_id}");
        let _: Envelope<Value> = self.send(self.http.delete(endpoint)).await?;
        Ok(())
    }

    async fn send<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<Envelope<T>, AppError> {
        let response = request.send().await.map_err(|_| AppError::Cloudflare("无法连接 Cloudflare，请检查网络后重试。".into()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status));
        }
        const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
        if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES) {
            return Err(AppError::Cloudflare("Cloudflare 返回的数据超出读取限制。".into()));
        }
        let mut response = response;
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await
            .map_err(|_| AppError::Cloudflare("读取 Cloudflare 响应失败。".into()))? {
            if body.len().saturating_add(chunk.len()) as u64 > MAX_RESPONSE_BYTES {
                return Err(AppError::Cloudflare("Cloudflare 返回的数据超出读取限制。".into()));
            }
            body.extend_from_slice(&chunk);
        }
        let envelope = serde_json::from_slice::<Envelope<T>>(&body)
            .map_err(|_| AppError::Cloudflare("Cloudflare 返回的数据格式无效。".into()))?;
        if !envelope.success {
            return Err(AppError::Cloudflare("Cloudflare 拒绝了请求，请检查 Token 权限和输入内容。".into()));
        }
        Ok(envelope)
    }
}

fn map_dns_record(record: RawDnsRecord, zone_id: &str) -> DnsRecord {
    let priority = record.priority.or_else(|| {
        record.data.as_ref().and_then(|data| data.get("priority")).and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
    });
    DnsRecord {
        id: record.id,
        zone_id: zone_id.to_string(),
        record_type: record.r#type,
        name: record.name,
        content: record.content.unwrap_or_default(),
        ttl: record.ttl,
        proxied: record.proxied.unwrap_or(false),
        priority,
        data: record.data,
    }
}

pub fn load_client(store: &SecureStore) -> Result<CloudflareClient, AppError> {
    let token = store.load_cloudflare_token()?
        .ok_or_else(|| AppError::NotConfigured("请先在设置中配置 Cloudflare API Token。".into()))?;
    CloudflareClient::new(&token)
}

fn status_error(status: StatusCode) -> AppError {
    let message = match status {
        StatusCode::UNAUTHORIZED => "Cloudflare API Token 无效或已失效。",
        StatusCode::FORBIDDEN => "Cloudflare 拒绝访问，请检查 Token 的 Zone:Read 和 DNS:Edit 权限。",
        StatusCode::NOT_FOUND => "Cloudflare 域名或 DNS 记录不存在。",
        StatusCode::TOO_MANY_REQUESTS => "Cloudflare 请求过于频繁，请稍后重试。",
        _ if status.is_server_error() => "Cloudflare 服务暂时不可用，请稍后重试。",
        _ => "Cloudflare 请求失败，请检查 Token 权限和输入内容。",
    };
    AppError::Cloudflare(message.into())
}

fn validate_id(value: &str, label: &str) -> Result<(), AppError> {
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::Validation(format!("{label}标识无效。")));
    }
    Ok(())
}

fn build_record_write(input: &DnsRecordInput) -> Result<DnsRecordWrite, AppError> {
    let record_type = input.record_type.trim().to_ascii_uppercase();
    if !["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"].contains(&record_type.as_str()) {
        return Err(AppError::Validation("暂不支持该 DNS 记录类型。".into()));
    }
    if input.ttl != 1 && !(60..=86400).contains(&input.ttl) {
        return Err(AppError::Validation("TTL 必须为自动（1）或 60 至 86400 秒。".into()));
    }
    let zone_name = input.zone_name.trim().trim_end_matches('.').to_ascii_lowercase();
    if !valid_hostname(&zone_name) { return Err(AppError::Validation("域名格式无效。".into())); }
    let name = normalize_record_name(&input.name, &zone_name)?;
    let proxied = matches!(record_type.as_str(), "A" | "AAAA" | "CNAME").then_some(input.proxied);
    let content = if record_type == "TXT" { input.content.clone() } else { input.content.trim().to_string() };
    let mut priority = None;
    let mut data = None;

    match record_type.as_str() {
        "A" => {
            content.parse::<Ipv4Addr>().map_err(|_| AppError::Validation("A 记录必须填写有效的 IPv4 地址。".into()))?;
        }
        "AAAA" => {
            content.parse::<Ipv6Addr>().map_err(|_| AppError::Validation("AAAA 记录必须填写有效的 IPv6 地址。".into()))?;
        }
        "CNAME" | "NS" => validate_target(&content, "记录目标")?,
        "TXT" => validate_text(&content, 4096, "TXT 内容")?,
        "MX" => {
            validate_target(&content, "邮件服务器")?;
            priority = Some(input.priority.ok_or_else(|| AppError::Validation("MX 记录需要填写优先级。".into()))?);
        }
        "SRV" => {
            let value = input.data.as_ref().ok_or_else(|| AppError::Validation("SRV 记录字段不完整。".into()))?;
            let target = value.get("target").and_then(Value::as_str).unwrap_or("").trim();
            let srv_priority = value.get("priority").and_then(Value::as_u64);
            let weight = value.get("weight").and_then(Value::as_u64);
            let port = value.get("port").and_then(Value::as_u64);
            let mut srv_labels = name.strip_suffix(&format!(".{}", zone_name)).unwrap_or("").split('.');
            let service = srv_labels.next().unwrap_or("");
            let proto = srv_labels.next().unwrap_or("");
            if srv_labels.next().is_some() || !valid_service_part(service) || !valid_service_part(proto) {
                return Err(AppError::Validation("SRV 名称需包含有效的服务名和协议名，例如 _sip._tcp。".into()));
            }
            validate_target(target, "SRV 目标")?;
            let srv_priority = bounded_u16(srv_priority, "SRV 优先级")?;
            let weight = bounded_u16(weight, "SRV 权重")?;
            let port = bounded_u16(port, "SRV 端口")?;
            data = Some(json!({"priority": srv_priority, "weight": weight, "port": port, "target": target}));
        }
        "CAA" => {
            let value = input.data.as_ref().ok_or_else(|| AppError::Validation("CAA 记录字段不完整。".into()))?;
            let flags = value.get("flags").and_then(Value::as_u64).filter(|number| *number <= 255)
                .ok_or_else(|| AppError::Validation("CAA flags 必须为 0 至 255。".into()))?;
            let tag = value.get("tag").and_then(Value::as_str).unwrap_or("").trim().to_ascii_lowercase();
            if !["issue", "issuewild", "iodef"].contains(&tag.as_str()) {
                return Err(AppError::Validation("CAA 标签必须是 issue、issuewild 或 iodef。".into()));
            }
            let caa_value = value.get("value").and_then(Value::as_str).unwrap_or("").trim();
            if caa_value.len() > 2048 || caa_value.chars().any(char::is_control) {
                return Err(AppError::Validation("CAA 值格式无效或超出长度限制。".into()));
            }
            data = Some(json!({"flags": flags, "tag": tag, "value": caa_value}));
        }
        _ => unreachable!(),
    }
    if content.is_empty() && !matches!(record_type.as_str(), "SRV" | "CAA") {
        return Err(AppError::Validation("DNS 记录内容不能为空。".into()));
    }

    Ok(DnsRecordWrite {
        r#type: record_type,
        name,
        content: if matches!(input.record_type.trim().to_ascii_uppercase().as_str(), "SRV" | "CAA") { None } else { Some(content) },
        ttl: if input.proxied && proxied.is_some() { 1 } else { input.ttl },
        proxied,
        priority,
        data,
    })
}

fn normalize_record_name(value: &str, zone: &str) -> Result<String, AppError> {
    let value = value.trim().trim_end_matches('.').to_ascii_lowercase();
    if value == "@" { return Ok(zone.to_string()); }
    if value.is_empty() { return Err(AppError::Validation("记录名称不能为空。".into())); }
    let full = if value == zone || value.ends_with(&format!(".{zone}")) { value } else { format!("{value}.{zone}") };
    if !valid_hostname(&full) || (full != zone && !full.ends_with(&format!(".{zone}"))) {
        return Err(AppError::Validation("记录名称必须位于所选域名范围内。".into()));
    }
    Ok(full)
}

fn validate_target(value: &str, label: &str) -> Result<(), AppError> {
    let target = value.trim().trim_end_matches('.');
    if valid_hostname(target) { Ok(()) } else { Err(AppError::Validation(format!("{label}格式无效。"))) }
}

fn valid_hostname(value: &str) -> bool {
    !value.is_empty() && value.len() <= 253 && value.is_ascii() && value.split('.').all(|label| {
        !label.is_empty() && label.len() <= 63 && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'*'))
    })
}

fn validate_text(value: &str, max_len: usize, label: &str) -> Result<(), AppError> {
    if value.is_empty() || value.len() > max_len || value.chars().any(char::is_control) {
        return Err(AppError::Validation(format!("{label}格式无效或超出长度限制。")));
    }
    Ok(())
}

fn valid_service_part(value: &str) -> bool {
    value.starts_with('_') && value.len() > 1 && value.len() <= 64
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn bounded_u16(value: Option<u64>, label: &str) -> Result<u16, AppError> {
    value.filter(|number| *number <= u16::MAX as u64).map(|number| number as u16)
        .ok_or_else(|| AppError::Validation(format!("{label}必须为 0 至 65535。")))
}

#[cfg(test)]
mod tests {
    use super::{map_dns_record, Envelope, RawDnsRecord};

    #[test]
    fn maps_dns_response_without_zone_id_from_request_path() {
        let raw: RawDnsRecord = serde_json::from_str(
            r#"{"id":"023e105f4ecef8ad9ca31a8372d0c353","type":"A","name":"example.com","content":"198.51.100.4","ttl":3600,"proxied":false}"#,
        ).unwrap();
        let record = map_dns_record(raw, "123e105f4ecef8ad9ca31a8372d0c353");
        assert_eq!(record.zone_id, "123e105f4ecef8ad9ca31a8372d0c353");
        assert_eq!(record.content, "198.51.100.4");
        assert_eq!(record.ttl, 3600);
    }

    #[test]
    fn accepts_dns_write_response_with_documented_record_fields() {
        let response: Envelope<serde_json::Value> = serde_json::from_str(
            r#"{"success":true,"result":{"id":"023e105f4ecef8ad9ca31a8372d0c353","type":"A","name":"example.com","content":"198.51.100.4","ttl":3600,"proxied":false}}"#,
        ).unwrap();
        assert!(response.success);
        assert!(response.result.is_some());
    }
}
