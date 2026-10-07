mod error;
mod models;
mod newapi;
mod storage;

use chrono::Utc;
use error::AppError;
use models::{
    AppSnapshot, ConnectionConfig, SaveConnectionInput, SyncResult, UpdateInactiveOpacityInput,
    UpdateRefreshIntervalInput, UpdateTokenGroupInput,
};
use newapi::NewApiClient;
use std::sync::Arc;
use storage::{SecureStore, StoredConnection};
use tauri::{AppHandle, Emitter, Manager, State};

const SNAPSHOT_UPDATED_EVENT: &str = "snapshot-updated";
const MIN_REFRESH_INTERVAL_SECONDS: u32 = 1;
const MAX_REFRESH_INTERVAL_SECONDS: u32 = 3600;
const MIN_INACTIVE_OPACITY_PERCENT: u8 = 20;
const MAX_INACTIVE_OPACITY_PERCENT: u8 = 100;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<SecureStore>,
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, AppError> {
    state.store.load_snapshot()
}

#[tauri::command]
fn save_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SaveConnectionInput,
) -> Result<AppSnapshot, AppError> {
    let base_url = validate_base_url(&input.base_url)?;
    let admin_credential = input.admin_credential.trim();
    let existing = state.store.load_connection()?;
    let credential = if admin_credential.is_empty() {
        existing
            .as_ref()
            .map(|connection| connection.admin_credential.clone())
            .ok_or_else(|| AppError::Validation("管理凭证不能为空。".to_string()))?
    } else {
        admin_credential.to_string()
    };

    state.store.save_connection(&StoredConnection {
        base_url: base_url.clone(),
        admin_credential: credential,
    })?;

    let snapshot = state.store.load_snapshot()?;
    state.store.save_snapshot(&AppSnapshot {
        connection: Some(ConnectionConfig {
            base_url,
            admin_credential_configured: true,
        }),
        ..snapshot
    })?;
    let snapshot = state.store.load_snapshot()?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn update_refresh_interval(
    app: AppHandle,
    state: State<'_, AppState>,
    input: UpdateRefreshIntervalInput,
) -> Result<AppSnapshot, AppError> {
    if !(MIN_REFRESH_INTERVAL_SECONDS..=MAX_REFRESH_INTERVAL_SECONDS).contains(&input.seconds) {
        return Err(AppError::Validation(format!(
            "刷新间隔必须在 {MIN_REFRESH_INTERVAL_SECONDS} 到 {MAX_REFRESH_INTERVAL_SECONDS} 秒之间。"
        )));
    }

    let mut snapshot = state.store.load_snapshot()?;
    snapshot.refresh_interval_seconds = input.seconds;
    state.store.save_snapshot(&snapshot)?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn update_inactive_opacity(
    app: AppHandle,
    state: State<'_, AppState>,
    input: UpdateInactiveOpacityInput,
) -> Result<AppSnapshot, AppError> {
    if !(MIN_INACTIVE_OPACITY_PERCENT..=MAX_INACTIVE_OPACITY_PERCENT).contains(&input.percent) {
        return Err(AppError::Validation(format!(
            "未激活透明度必须在 {MIN_INACTIVE_OPACITY_PERCENT}% 到 {MAX_INACTIVE_OPACITY_PERCENT}% 之间。"
        )));
    }

    let mut snapshot = state.store.load_snapshot()?;
    snapshot.inactive_opacity_percent = input.percent;
    state.store.save_snapshot(&snapshot)?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
async fn sync_from_newapi(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let connection = state
        .store
        .load_connection()?
        .ok_or_else(|| AppError::NotConfigured("请先配置 NewAPI 地址和管理凭证。".to_string()))?;
    let client = NewApiClient::new(connection)?;
    let tokens = client.fetch_tokens().await?;
    let mut groups = client.fetch_groups().await?;
    for group in &mut groups {
        group.token_count = tokens
            .iter()
            .filter(|token| token.group_id.as_deref() == Some(group.id.as_str()))
            .count();
    }
    let mut snapshot = state.store.load_snapshot()?;
    snapshot.tokens = tokens;
    snapshot.groups = groups;
    snapshot.last_synced_at = Some(Utc::now().to_rfc3339());
    state.store.save_snapshot(&snapshot)?;
    emit_snapshot(&app, &snapshot);
    Ok(SyncResult { snapshot, warning: None })
}

#[tauri::command]
async fn update_token_group(
    app: AppHandle,
    state: State<'_, AppState>,
    input: UpdateTokenGroupInput,
) -> Result<AppSnapshot, AppError> {
    if input.token_id.trim().is_empty() || input.group_id.trim().is_empty() {
        return Err(AppError::Validation("令牌和分组不能为空。".to_string()));
    }

    let connection = state
        .store
        .load_connection()?
        .ok_or_else(|| AppError::NotConfigured("请先配置 NewAPI 地址和管理凭证。".to_string()))?;
    let client = NewApiClient::new(connection)?;

    // 服务端更新成功前不修改本地快照，保证失败时原数据保持不变。
    client.update_token_group(&input).await?;
    let mut snapshot = state.store.load_snapshot()?;
    let group_name = snapshot
        .groups
        .iter()
        .find(|group| group.id == input.group_id)
        .map(|group| group.name.clone());
    let previous_group_id = snapshot
        .tokens
        .iter()
        .find(|token| token.id == input.token_id)
        .and_then(|token| token.group_id.clone());
    if let Some(token) = snapshot.tokens.iter_mut().find(|token| token.id == input.token_id) {
        token.group_id = Some(input.group_id.clone());
        token.group_name = group_name;
        token.updated_at = Some(Utc::now().to_rfc3339());
    }
    if previous_group_id.as_deref() != Some(input.group_id.as_str()) {
        for group in &mut snapshot.groups {
            if previous_group_id.as_deref() == Some(group.id.as_str()) {
                group.token_count = group.token_count.saturating_sub(1);
            }
            if group.id == input.group_id {
                group.token_count += 1;
            }
        }
    }
    state.store.save_snapshot(&snapshot)?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

fn emit_snapshot(app: &AppHandle, snapshot: &AppSnapshot) {
    let _ = app.emit(SNAPSHOT_UPDATED_EVENT, snapshot);
}

fn validate_base_url(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim().trim_end_matches('/');
    let parsed = url::Url::parse(trimmed)
        .map_err(|_| AppError::Validation("服务地址格式无效。".to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::Validation("服务地址必须是有效的 HTTP 或 HTTPS 地址。".to_string()));
    }
    Ok(trimmed.to_string())
}

fn open_floating_window(app: &AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("floating")
        .ok_or_else(|| AppError::Storage("悬浮窗未初始化。".to_string()))?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|error| AppError::Storage(format!("悬浮窗打开失败：{error}")))
}

pub fn run() {
    let state = AppState {
        store: Arc::new(SecureStore),
    };

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            let menu = tauri::menu::MenuBuilder::new(app)
                .text("open-floating", "打开悬浮窗")
                .separator()
                .text("quit", "退出")
                .build()?;
            let tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .menu_on_left_click(true)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "open-floating" => {
                            let _ = open_floating_window(&app_handle);
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                });
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_connection,
            update_refresh_interval,
            update_inactive_opacity,
            sync_from_newapi,
            update_token_group
        ])
        .run(tauri::generate_context!())
        .expect("error while running NewAPI Desk");
}
