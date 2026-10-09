mod error;
mod models;
mod newapi;
mod storage;
#[cfg(windows)]
mod screenshot;

use chrono::Utc;
use error::AppError;
use models::{
    AppSnapshot, ConnectionConfig, GetUsageLogsInput, SaveConnectionInput, SyncResult,
    UpdateTokenGroupInput, UsageLogPage,
};
use newapi::NewApiClient;
use std::sync::Arc;
use storage::{SecureStore, StoredConnection};
use tauri::{Emitter, Manager, State};
#[cfg(windows)]
use screenshot::ScreenshotState;
#[cfg(windows)]
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<SecureStore>,
}

#[cfg(windows)]
#[tauri::command]
fn start_screenshot(app: tauri::AppHandle) -> Result<(), AppError> {
    screenshot::begin_screenshot(&app)
}

#[cfg(windows)]
#[tauri::command]
fn get_screenshot_image(state: State<'_, ScreenshotState>) -> Result<String, AppError> {
    screenshot::get_screenshot_image(state)
}

#[cfg(windows)]
#[tauri::command]
fn screenshot_overlay_ready(app: tauri::AppHandle, state: State<'_, ScreenshotState>) -> Result<(), AppError> {
    screenshot::screenshot_overlay_ready(&app, &state)
}

#[cfg(windows)]
#[tauri::command]
fn save_screenshot(
    app: tauri::AppHandle,
    state: State<'_, ScreenshotState>,
    selection: screenshot::ScreenshotSelection,
) -> Result<bool, AppError> {
    screenshot::save_screenshot_impl(app, state, selection)
}

#[cfg(windows)]
#[tauri::command]
fn copy_screenshot(
    app: tauri::AppHandle,
    state: State<'_, ScreenshotState>,
    selection: screenshot::ScreenshotSelection,
) -> Result<(), AppError> {
    screenshot::copy_screenshot_impl(app, state, selection)
}

#[cfg(windows)]
#[tauri::command]
fn cancel_screenshot(app: tauri::AppHandle, state: State<'_, ScreenshotState>) -> Result<(), AppError> {
    screenshot::cancel_screenshot_impl(app, state)
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, AppError> {
    state.store.load_snapshot()
}

#[tauri::command]
fn save_connection(
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
    Ok(snapshot)
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, AppState>, close_to_tray: bool) -> Result<AppSnapshot, AppError> {
    let mut snapshot = state.store.load_snapshot()?;
    snapshot.close_to_tray = close_to_tray;
    state.store.save_snapshot(&snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
async fn get_usage_logs(
    state: State<'_, AppState>,
    input: GetUsageLogsInput,
) -> Result<UsageLogPage, AppError> {
    let connection = state
        .store
        .load_connection()?
        .ok_or_else(|| AppError::NotConfigured("请先配置 NewAPI 地址和管理凭证。".to_string()))?;
    let client = NewApiClient::new(connection)?;
    client.fetch_usage_logs(input.page).await
}

#[tauri::command]
async fn sync_from_newapi(
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
    Ok(SyncResult { snapshot, warning: None })
}

#[tauri::command]
async fn update_token_group(
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
    Ok(snapshot)
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

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.unminimize()
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .is_err()
        {
            eprintln!("Unable to restore the main window.");
        }
    }
}

#[cfg(windows)]
macro_rules! app_handlers {
    () => {
        tauri::generate_handler![
            get_snapshot,
            save_connection,
            start_screenshot,
            get_screenshot_image,
            screenshot_overlay_ready,
            save_screenshot,
            copy_screenshot,
            cancel_screenshot,
            sync_from_newapi,
            get_usage_logs,
            set_close_to_tray,
            update_token_group
        ]
    };
}

#[cfg(not(windows))]
macro_rules! app_handlers {
    () => {
        tauri::generate_handler![
            get_snapshot,
            save_connection,
            sync_from_newapi,
            get_usage_logs,
            set_close_to_tray,
            update_token_group
        ]
    };
}

pub fn run() {
    let state = AppState {
        store: Arc::new(SecureStore),
    };

    let builder = tauri::Builder::default().manage(state);

    #[cfg(windows)]
    let builder = builder
        .manage(ScreenshotState::new())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Err(error) = screenshot::begin_screenshot(app) {
                            let _ = app.emit("screenshot-error", error.to_string());
                        }
                    }
                })
                .build(),
        );

    builder
        .setup(|app| {
            #[cfg(windows)]
            if app.global_shortcut().register("Ctrl+Shift+S").is_err() {
                let _ = app.emit("screenshot-error", "快捷键 Ctrl+Shift+S 已被占用，可从工具集手动启动截图。");
            }
            let icon = app.default_window_icon().cloned().ok_or_else(|| {
                std::io::Error::other("The application icon is required for the system tray.")
            })?;
            let menu = tauri::menu::MenuBuilder::new(app)
                .text("open-main", "打开主窗口")
                .text("usage-logs", "使用日志")
                .separator()
                .text("quit", "退出")
                .build()?;
            let tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("DeskTool")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open-main" => restore_main_window(app),
                    "usage-logs" => {
                        restore_main_window(app);
                        let _ = app.emit("navigate", "logs");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    }) {
                        restore_main_window(tray.app_handle());
                    }
                });
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "capture" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    screenshot::cancel_screenshot_from_app(&window.app_handle());
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let close_to_tray = window
                        .app_handle()
                        .state::<AppState>()
                        .store
                        .load_snapshot()
                        .map(|snapshot| snapshot.close_to_tray)
                        .unwrap_or(false);
                    api.prevent_close();
                    if close_to_tray {
                        if window.hide().is_err() {
                            eprintln!("Unable to hide the main window to the system tray.");
                        }
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                tauri::WindowEvent::Resized(_)
                    if window.is_minimized().unwrap_or(false)
                        && window.is_visible().unwrap_or(false)
                        && window.hide().is_err() =>
                {
                    let _ = window.unminimize();
                }
                _ => {}
            }
        })
        .invoke_handler(app_handlers!())
        .run(tauri::generate_context!())
        .expect("error while running DeskTool");
}
