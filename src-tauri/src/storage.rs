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
            Ok(value) => serde_json::from_str(&value)
                .map_err(|_| AppError::Storage("本地令牌数据格式无效。".to_string())),
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

    pub fn load_translation(&self) -> Result<crate::translation::StoredTranslationConfig, AppError> {
        match self.entry("translation-config")?.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map_err(|_| AppError::Storage("翻译配置格式无效。".into())),
            Err(keyring::Error::NoEntry) => Ok(Default::default()),
            Err(_) => Err(AppError::Storage("翻译安全配置读取失败。".into())),
        }
    }

    pub fn save_translation(&self, config: &crate::translation::StoredTranslationConfig) -> Result<(), AppError> {
        let value = serde_json::to_string(config)
            .map_err(|_| AppError::Storage("翻译配置序列化失败。".into()))?;
        self.entry("translation-config")?.set_password(&value)
            .map_err(|_| AppError::Storage("翻译配置安全保存失败。".into()))
    }

    fn entry(&self, account: &str) -> Result<Entry, AppError> {
        Entry::new(SERVICE_NAME, account)
            .map_err(|error| AppError::Storage(format!("系统安全存储不可用：{error}")))
    }
}
