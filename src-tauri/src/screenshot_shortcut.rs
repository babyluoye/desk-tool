use crate::{error::AppError, models::AppSnapshot, storage::SecureStore};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub struct ScreenshotShortcutState {
    active_id: AtomicU32,
    runtime: Mutex<ShortcutRuntime>,
}

#[derive(Default)]
struct ShortcutRuntime {
    configured: Option<Shortcut>,
    registered: bool,
    recording: bool,
}

impl ScreenshotShortcutState {
    pub fn new() -> Self {
        Self { active_id: AtomicU32::new(0), runtime: Mutex::new(ShortcutRuntime::default()) }
    }

    pub fn matches(&self, shortcut: &Shortcut) -> bool {
        let active_id = self.active_id.load(Ordering::Acquire);
        active_id != 0 && active_id == shortcut.id()
    }

    pub fn warning(&self) -> Option<String> {
        if self.active_id.load(Ordering::Acquire) == 0 {
            Some("截图快捷键未生效，可能已被其他程序占用。请在设置中重新保存或更换组合键，也可从工具集手动截图。".to_string())
        } else {
            None
        }
    }
}

pub fn initialize(app: &AppHandle, store: &SecureStore) -> Result<(), AppError> {
    let snapshot = store.load_snapshot()?;
    let (_, shortcut) = parse_shortcut(&snapshot.screenshot_shortcut)?;
    let state = app.state::<ScreenshotShortcutState>();
    let mut runtime = state.runtime.lock()
        .map_err(|_| AppError::Screenshot("快捷键设置状态不可用。".to_string()))?;
    runtime.configured = Some(shortcut);
    app.global_shortcut().register(shortcut)
        .map_err(|_| AppError::Screenshot("截图快捷键注册失败。".to_string()))?;
    runtime.registered = true;
    state.active_id.store(shortcut.id(), Ordering::Release);
    Ok(())
}

pub fn set_recording(app: &AppHandle, recording: bool) -> Result<(), AppError> {
    let state = app.state::<ScreenshotShortcutState>();
    let mut runtime = state.runtime.lock()
        .map_err(|_| AppError::Screenshot("快捷键设置状态不可用。".to_string()))?;
    if recording && !app.get_webview_window("main")
        .and_then(|window| window.is_focused().ok()).unwrap_or(false)
    {
        return Err(AppError::Validation("请在主窗口录入快捷键。".to_string()));
    }
    if runtime.recording == recording { return Ok(()); }
    let manager = app.global_shortcut();
    if recording {
        let registered_shortcut = runtime.configured.filter(|_| runtime.registered);
        state.active_id.store(0, Ordering::Release);
        if let Some(shortcut) = registered_shortcut {
            // Windows consumes registered hotkeys, so unregister while recording to receive keydown events.
            if manager.unregister(shortcut).is_err() {
                state.active_id.store(shortcut.id(), Ordering::Release);
                return Err(AppError::Screenshot("无法暂停截图快捷键，请重试。".to_string()));
            }
        }
        runtime.registered = false;
        runtime.recording = true;
    } else {
        runtime.recording = false;
        if let Some(shortcut) = runtime.configured {
            if !manager.is_registered(shortcut) {
                manager.register(shortcut)
                    .map_err(|_| AppError::Screenshot("截图快捷键恢复失败，可能已被其他程序占用，请重新保存或更换组合键。".to_string()))?;
            }
            runtime.registered = true;
            state.active_id.store(shortcut.id(), Ordering::Release);
        }
    }
    Ok(())
}

pub fn update_shortcut(
    app: &AppHandle,
    store: &SecureStore,
    value: &str,
) -> Result<AppSnapshot, AppError> {
    let (normalized, shortcut) = parse_shortcut(value)?;
    let state = app.state::<ScreenshotShortcutState>();
    let mut runtime = state.runtime.lock()
        .map_err(|_| AppError::Screenshot("快捷键设置状态不可用。".to_string()))?;
    let mut snapshot = store.load_snapshot()?;
    let previous = runtime.configured.filter(|_| runtime.registered);
    let manager = app.global_shortcut();
    let newly_registered = !manager.is_registered(shortcut);
    if newly_registered {
        // Register first so a conflict leaves the previous shortcut available.
        manager.register(shortcut)
            .map_err(|_| AppError::Validation("该快捷键已被占用或无法注册，请选择其他组合键。".to_string()))?;
    }
    snapshot.screenshot_shortcut = normalized;
    if let Err(error) = store.save_snapshot(&snapshot) {
        if newly_registered { let _ = manager.unregister(shortcut); }
        return Err(error);
    }
    runtime.configured = Some(shortcut);
    runtime.registered = true;
    runtime.recording = false;
    state.active_id.store(shortcut.id(), Ordering::Release);
    if let Some(previous) = previous.filter(|previous| previous.id() != shortcut.id()) {
        // The handler filters obsolete IDs even if Windows refuses to unregister one.
        let _ = manager.unregister(previous);
    }
    Ok(snapshot)
}

fn parse_shortcut(value: &str) -> Result<(String, Shortcut), AppError> {
    if value.len() > 64 {
        return Err(AppError::Validation("截图快捷键格式无效。".to_string()));
    }
    let parts: Vec<&str> = value.split('+').map(str::trim).collect();
    let (key, modifiers) = parts.split_last()
        .ok_or_else(|| AppError::Validation("请输入截图快捷键。".to_string()))?;
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    for modifier in modifiers {
        match *modifier {
            "Ctrl" if !ctrl => ctrl = true,
            "Alt" if !alt => alt = true,
            "Shift" if !shift => shift = true,
            _ => return Err(AppError::Validation("快捷键修饰键只支持 Ctrl、Alt 和 Shift，且不能重复。".to_string())),
        }
    }
    if !ctrl && !alt {
        return Err(AppError::Validation("截图快捷键必须包含 Ctrl 或 Alt。".to_string()));
    }
    let is_letter_or_digit = key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric();
    let is_function_key = matches!(*key, "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12");
    if !is_letter_or_digit && !is_function_key {
        return Err(AppError::Validation("请使用字母、数字或 F1–F12 作为快捷键。".to_string()));
    }
    let mut normalized = Vec::new();
    if ctrl { normalized.push("Ctrl"); }
    if alt { normalized.push("Alt"); }
    if shift { normalized.push("Shift"); }
    let key = key.to_ascii_uppercase();
    normalized.push(&key);
    let normalized = normalized.join("+");
    let shortcut = normalized.parse::<Shortcut>()
        .map_err(|_| AppError::Validation("截图快捷键格式无效。".to_string()))?;
    Ok((normalized, shortcut))
}
