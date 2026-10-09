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

pub const DEFAULT_SCREENSHOT_SHORTCUT: &str = "Ctrl+Shift+S";

fn default_screenshot_shortcut() -> String {
    DEFAULT_SCREENSHOT_SHORTCUT.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub connection: Option<ConnectionConfig>,
    pub tokens: Vec<ApiToken>,
    pub groups: Vec<TokenGroup>,
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default = "default_screenshot_shortcut")]
    pub screenshot_shortcut: String,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        Self {
            connection: None,
            tokens: Vec::new(),
            groups: Vec::new(),
            last_synced_at: None,
            close_to_tray: false,
            screenshot_shortcut: default_screenshot_shortcut(),
        }
    }
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetUsageLogsInput {
    pub page: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLog {
    pub id: i64,
    pub created_at: i64,
    pub username: String,
    pub token_name: String,
    pub model_name: String,
    pub quota: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub use_time: i64,
    pub is_stream: bool,
    pub channel_name: String,
    pub group: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogPage {
    pub items: Vec<UsageLog>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}
