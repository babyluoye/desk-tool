use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub base_url: String,
    pub admin_credential_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiToken {
    pub id: String,
    pub name: String,
    pub masked_token: String,
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    pub enabled: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenGroup {
    pub id: String,
    pub name: String,
    pub token_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub connection: Option<ConnectionConfig>,
    pub tokens: Vec<ApiToken>,
    pub groups: Vec<TokenGroup>,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub snapshot: AppSnapshot,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionInput {
    pub base_url: String,
    pub admin_credential: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTokenGroupInput {
    pub token_id: String,
    pub group_id: String,
}
