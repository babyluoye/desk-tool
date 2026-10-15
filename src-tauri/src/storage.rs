use crate::{error::AppError, models::AppSnapshot};
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "newapi-desk";
const CONFIG_KEY: &str = "connection-config";
const SNAPSHOT_KEY: &str = "snapshot";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConnection {
    pub base_url: String,
    pub admin_credential: String,
}

#[derive(Default)]
pub struct SecureStore;

impl SecureStore {
    pub fn load_snapshot(&self) -> Result<AppSnapshot, AppError> {
        match self.entry(SNAPSHOT_KEY)?.get_password() {
            Ok(value) => {
                let mut value: serde_json::Value = serde_json::from_str(&value)
                    .map_err(|_| AppError::Storage("本地令牌数据格式无效。".to_string()))?;
                let had_removed_field = value.as_object_mut()
                    .and_then(|object| object.remove("screenshotShortcut"))
                    .is_some();
                let snapshot: AppSnapshot = serde_json::from_value(value)
                    .map_err(|_| AppError::Storage("本地令牌数据格式无效。".to_string()))?;
                if had_removed_field {
                    self.save_snapshot(&snapshot)?;
                }
                Ok(snapshot)
            }
            Err(keyring::Error::NoEntry) => Ok(AppSnapshot::default()),
            Err(error) => Err(AppError::Storage(format!("本地令牌数据读取失败：{error}"))),
        }
    }

    pub fn save_snapshot(&self, snapshot: &AppSnapshot) -> Result<(), AppError> {
        let value = serde_json::to_string(snapshot)
            .map_err(|_| AppError::Storage("本地令牌数据序列化失败。".to_string()))?;
        self.entry(SNAPSHOT_KEY)?
            .set_password(&value)
            .map_err(|error| AppError::Storage(format!("本地令牌数据安全保存失败：{error}")))
    }

    pub fn load_connection(&self) -> Result<Option<StoredConnection>, AppError> {
        match self.entry(CONFIG_KEY)?.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map(Some)
                .map_err(|_| AppError::Storage("连接配置格式无效。".to_string())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Storage(format!("连接配置读取失败：{error}"))),
        }
    }

    pub fn save_connection(&self, connection: &StoredConnection) -> Result<(), AppError> {
        let value = serde_json::to_string(connection)
            .map_err(|_| AppError::Storage("连接配置序列化失败。".to_string()))?;
        self.entry(CONFIG_KEY)?
            .set_password(&value)
            .map_err(|error| AppError::Storage(format!("连接配置安全保存失败：{error}")))
    }

    pub fn clear_legacy_translation_config(&self) -> Result<(), AppError> {
        match self.entry("translation-config")?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::Storage("旧翻译凭证清除失败。".into())),
        }
    }

    pub fn load_cloudflare_token(&self) -> Result<Option<String>, AppError> {
        match self.entry("cloudflare-token")?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::Storage("Cloudflare 安全配置读取失败。".into())),
        }
    }

    pub fn save_cloudflare_token(&self, token: &str) -> Result<(), AppError> {
        self.entry("cloudflare-token")?.set_password(token)
            .map_err(|_| AppError::Storage("Cloudflare API Token 安全保存失败。".into()))
    }

    pub fn clear_cloudflare_token(&self) -> Result<(), AppError> {
        match self.entry("cloudflare-token")?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::Storage("Cloudflare 安全配置清除失败。".into())),
        }
    }

    fn entry(&self, account: &str) -> Result<Entry, AppError> {
        Entry::new(SERVICE_NAME, account)
            .map_err(|error| AppError::Storage(format!("系统安全存储不可用：{error}")))
    }
}
