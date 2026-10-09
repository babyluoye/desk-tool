mod error;
mod models;
mod newapi;
mod storage;
mod translation;
#[cfg(windows)]
mod translation_jobs;
#[cfg(windows)]
mod pinned_screenshot;
#[cfg(windows)]
mod screenshot;
#[cfg(windows)]
mod screenshot_annotation;
#[cfg(windows)]
mod screenshot_shortcut;

use chrono::Utc;
use error::AppError;
use models::{
    AppSnapshot, ConnectionConfig, GetUsageLogsInput, SaveConnectionInput, SyncResult,
    UpdateTokenGroupInput, UsageLogPage,
};
use newapi::NewApiClient;
use translation::{public_settings, SaveTranslationInput, TranslationSettings};
use std::sync::Arc;
use storage::{SecureStore, StoredConnection};
use tauri::{Emitter, Manager, State};
#[cfg(windows)]
use screenshot::ScreenshotState;
#[cfg(windows)]
use screenshot_shortcut::ScreenshotShortcutState;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<SecureStore>,
}

#[tauri::command]
fn get_translation_settings(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<TranslationSettings, AppError> {
    if window.label() != "main" && !window.label().starts_with("pinned-") {
        return Err(AppError::Validation("翻译配置来源无效。".into()));
    }
    let config = state.store.load_translation()?;
    Ok(public_settings(&config))
}

#[tauri::command]
fn save_translation_settings(
    window: tauri::WebviewWindow, state: State<'_, AppState>, input: SaveTranslationInput,
) -> Result<TranslationSettings, AppError> {
    if window.label() != "main" { return Err(AppError::Validation("翻译配置只能在主窗口修改。".into())); }
    let mut settings = input.settings;
    translation::validate_settings(&mut settings)?;
    let mut config = state.store.load_translation()?;
    if !input.clear_api_key && input.api_key.trim().is_empty() && !config.api_key.is_empty() {
        let before = translation::completion_url(&config.settings.base_url)?;
        let after = translation::completion_url(&settings.base_url)?;
        if before.origin() != after.origin() {
            return Err(AppError::Validation("服务域名已变更，请重新输入 API Key，或先清除原 Key。".into()));
        }
    }
    if input.clear_api_key { config.api_key.clear(); }
    if !input.clear_api_key && !input.api_key.trim().is_empty() {
        let key = input.api_key.trim();
        if key.len() > 4096 || key.chars().any(char::is_control) {
            return Err(AppError::Validation("API Key 格式无效。".into()));
        }
        config.api_key = key.to_string();
    }
    config.settings = settings;
    state.store.save_translation(&config)?;
    #[cfg(windows)]
    if !config.settings.consent { translation_jobs::cancel_pending(window.app_handle()); }
    Ok(public_settings(&config))
}

#[cfg(windows)]
#[tauri::command]
async fn start_screenshot(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), AppError> {
    require_window(&window, "main")?;
    tauri::async_runtime::spawn_blocking(move || screenshot::begin_screenshot(&app))
        .await.map_err(|_| AppError::Screenshot("启动截图任务失败，请重试。".to_string()))?
}

#[cfg(windows)]
#[tauri::command]
fn get_screenshot_image(window: tauri::WebviewWindow, state: State<'_, ScreenshotState>) -> Result<String, AppError> {
    require_window(&window, "capture")?;
    screenshot::get_screenshot_image(state)
}

#[cfg(windows)]
#[tauri::command]
fn screenshot_overlay_ready(window: tauri::WebviewWindow, app: tauri::AppHandle, state: State<'_, ScreenshotState>) -> Result<(), AppError> {
    require_window(&window, "capture")?;
    screenshot::screenshot_overlay_ready(&app, &state)
}

#[cfg(windows)]
#[tauri::command]
async fn save_screenshot(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    selection: screenshot::ScreenshotSelection,
) -> Result<bool, AppError> {
    require_window(&window, "capture")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ScreenshotState>();
        screenshot::save_screenshot_impl(app.clone(), state, selection)
    }).await.map_err(|_| AppError::Screenshot("保存截图任务失败，请重试。".to_string()))?
}

#[cfg(windows)]
#[tauri::command]
async fn copy_screenshot(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    selection: screenshot::ScreenshotSelection,
) -> Result<(), AppError> {
    require_window(&window, "capture")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ScreenshotState>();
        screenshot::copy_screenshot_impl(app.clone(), state, selection)
    }).await.map_err(|_| AppError::Screenshot("复制截图任务失败，请重试。".to_string()))?
}

#[cfg(windows)]
#[tauri::command]
async fn pin_screenshot(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    selection: screenshot::ScreenshotSelection,
    translate: Option<bool>,
) -> Result<(), AppError> {
    require_window(&window, "capture")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ScreenshotState>();
        screenshot::pin_screenshot_impl(app.clone(), state, selection, translate.unwrap_or(false))
    }).await.map_err(|_| AppError::Screenshot("贴图任务失败，请重试。".to_string()))?
}

#[cfg(windows)]
#[tauri::command]
fn get_pinned_screenshot(window: tauri::WebviewWindow) -> Result<Option<String>, AppError> {
    pinned_screenshot::get_pinned_screenshot(&window)
}

#[cfg(windows)]
#[tauri::command]
fn show_pinned_screenshot(window: tauri::WebviewWindow) -> Result<(), AppError> {
    pinned_screenshot::show_pinned_screenshot(&window)
}

#[cfg(windows)]
#[tauri::command]
fn take_pinned_auto_translate(window: tauri::WebviewWindow) -> bool {
    pinned_screenshot::take_auto_translate(&window)
}

#[cfg(windows)]
#[tauri::command]
fn start_image_translation(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<translation_jobs::JobSnapshot, AppError> {
    let mut config = state.store.load_translation()?;
    translation::validate_settings(&mut config.settings)?;
    translation_jobs::start(&window, config)
}

#[cfg(windows)]
#[tauri::command]
fn get_image_translation(window: tauri::WebviewWindow) -> Result<Option<translation_jobs::JobSnapshot>, AppError> {
    translation_jobs::snapshot(&window)
}

#[cfg(windows)]
#[tauri::command]
fn cancel_image_translation(window: tauri::WebviewWindow) {
    translation_jobs::cancel_for_label(window.app_handle(), window.label(), false);
}

#[cfg(windows)]
#[tauri::command]
fn next_ocr_task(window: tauri::WebviewWindow) -> Result<Option<translation_jobs::OcrTask>, AppError> {
    translation_jobs::take_next(&window)
}

#[cfg(windows)]
#[tauri::command]
async fn complete_ocr_task(window: tauri::WebviewWindow, id: String, document: Option<translation::OcrDocument>) -> Result<(), AppError> {
    translation_jobs::complete_ocr(window, id, document).await
}

#[cfg(windows)]
#[tauri::command]
async fn copy_translation_text(window: tauri::WebviewWindow, text: String) -> Result<(), AppError> {
    if !window.label().starts_with("pinned-") || text.len() > 256000 {
        return Err(AppError::Validation("复制文字来源或大小无效。".into()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard = arboard::Clipboard::new().map_err(|_| AppError::Translation("无法访问系统剪贴板。".into()))?;
        clipboard.set_text(text).map_err(|_| AppError::Translation("复制文字失败。".into()))
    }).await.map_err(|_| AppError::Translation("复制任务失败。".into()))?
}

#[cfg(windows)]
#[tauri::command]
fn cancel_screenshot(window: tauri::WebviewWindow, app: tauri::AppHandle, state: State<'_, ScreenshotState>) -> Result<(), AppError> {
    require_window(&window, "capture")?;
    screenshot::cancel_screenshot_impl(app, state)
}

#[cfg(windows)]
#[tauri::command]
async fn set_screenshot_shortcut(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<AppSnapshot, AppError> {
    require_window(&window, "main")?;
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        screenshot_shortcut::update_shortcut(&app, &store, &shortcut)
    }).await.map_err(|_| AppError::Screenshot("保存快捷键任务失败，请重试。".to_string()))?
}

#[cfg(windows)]
#[tauri::command]
fn get_screenshot_shortcut_warning(state: State<'_, ScreenshotShortcutState>) -> Option<String> {
    state.warning()
}

#[cfg(windows)]
#[tauri::command]
async fn set_screenshot_shortcut_recording(
    window: tauri::WebviewWindow,
    recording: bool,
) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(AppError::Validation("快捷键只能在主窗口设置。".to_string()));
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || screenshot_shortcut::set_recording(&app, recording))
        .await.map_err(|_| AppError::Screenshot("快捷键录入状态更新失败。".to_string()))?
}

fn require_window(window: &tauri::WebviewWindow, label: &str) -> Result<(), AppError> {
    if window.label() != label { return Err(AppError::Validation("该操作不允许从当前窗口调用。".into())); }
    Ok(())
}

#[tauri::command]
fn get_snapshot(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<AppSnapshot, AppError> {
    require_window(&window, "main")?;
    state.store.load_snapshot()
}

#[tauri::command]
fn save_connection(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: SaveConnectionInput,
) -> Result<AppSnapshot, AppError> {
    require_window(&window, "main")?;
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
fn set_close_to_tray(window: tauri::WebviewWindow, state: State<'_, AppState>, close_to_tray: bool) -> Result<AppSnapshot, AppError> {
    require_window(&window, "main")?;
    let mut snapshot = state.store.load_snapshot()?;
    snapshot.close_to_tray = close_to_tray;
    state.store.save_snapshot(&snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
async fn get_usage_logs(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: GetUsageLogsInput,
) -> Result<UsageLogPage, AppError> {
    require_window(&window, "main")?;
    let connection = state
        .store
        .load_connection()?
        .ok_or_else(|| AppError::NotConfigured("请先配置 NewAPI 地址和管理凭证。".to_string()))?;
    let client = NewApiClient::new(connection)?;
    client.fetch_usage_logs(input.page).await
}

#[tauri::command]
async fn sync_from_newapi(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    require_window(&window, "main")?;
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
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: UpdateTokenGroupInput,
) -> Result<AppSnapshot, AppError> {
    require_window(&window, "main")?;
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
            get_translation_settings,
            save_translation_settings,
            start_screenshot,
            get_screenshot_image,
            screenshot_overlay_ready,
            save_screenshot,
            copy_screenshot,
            pin_screenshot,
            get_pinned_screenshot,
            show_pinned_screenshot,
            take_pinned_auto_translate,
            start_image_translation,
            get_image_translation,
            cancel_image_translation,
            next_ocr_task,
            complete_ocr_task,
            copy_translation_text,
            cancel_screenshot,
            set_screenshot_shortcut,
            get_screenshot_shortcut_warning,
            set_screenshot_shortcut_recording,
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
            get_translation_settings,
            save_translation_settings,
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
        .manage(pinned_screenshot::PinnedScreenshotState::new())
        .manage(ScreenshotState::new())
        .manage(translation_jobs::TranslationJobs::default())
        .manage(ScreenshotShortcutState::new())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed
                        && app.state::<ScreenshotShortcutState>().matches(shortcut)
                    {
                        let app = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            if let Err(error) = screenshot::begin_screenshot(&app) {
                                let _ = app.emit("screenshot-error", error.to_string());
                            }
                        });
                    }
                })
                .build(),
        );

    builder
        .setup(|app| {
            #[cfg(windows)]
            {
                let state = app.state::<AppState>();
                // A failed registration is exposed by the warning command after the frontend is ready.
                let _ = screenshot_shortcut::initialize(app.handle(), &state.store);
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
            if window.label().starts_with("pinned-") {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    pinned_screenshot::remove_pinned_screenshot(window.app_handle(), window.label());
                }
                return;
            }
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
            #[cfg(windows)]
            if matches!(event, tauri::WindowEvent::Focused(false) | tauri::WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle().clone();
                let closing = matches!(event, tauri::WindowEvent::CloseRequested { .. });
                tauri::async_runtime::spawn_blocking(move || {
                    if closing || !app.get_webview_window("main")
                        .and_then(|window| window.is_focused().ok()).unwrap_or(false)
                    {
                        if let Err(error) = screenshot_shortcut::set_recording(&app, false) {
                            let _ = app.emit("screenshot-error", error.to_string());
                        }
                    }
                });
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
