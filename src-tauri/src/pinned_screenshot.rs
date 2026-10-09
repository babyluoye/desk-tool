use crate::error::AppError;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::{collections::HashMap, io::Cursor, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const MAX_PINNED_IMAGES: usize = 16;

pub struct PinnedScreenshotState {
    images: Mutex<HashMap<String, Option<String>>>,
    auto_translate: Mutex<HashMap<String, bool>>,
    next_id: AtomicU64,
}

impl PinnedScreenshotState {
    pub fn new() -> Self {
        Self { images: Mutex::new(HashMap::new()), auto_translate: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1) }
    }
}

pub fn create_pinned_screenshot(
    app: &AppHandle,
    image: RgbaImage,
    x: f64,
    y: f64,
    viewport_width: f64,
    viewport_height: f64,
    translate: bool,
) -> Result<String, AppError> {
    let capture = app.get_webview_window("capture")
        .ok_or_else(|| AppError::Screenshot("截图窗口不可用。".to_string()))?;
    let monitor = capture.primary_monitor()
        .map_err(|_| AppError::Screenshot("无法读取贴图显示范围。".to_string()))?
        .ok_or_else(|| AppError::Screenshot("未检测到主显示器。".to_string()))?;
    let size = monitor.size();
    let scale = monitor.scale_factor();
    let available_width = size.width.saturating_sub((32.0 * scale) as u32).max(1);
    let available_height = size.height.saturating_sub((64.0 * scale) as u32).max(1);
    let ratio = (available_width as f64 / image.width() as f64)
        .min(available_height as f64 / image.height() as f64).min(1.0);
    let width = ((image.width() as f64 * ratio).round() as u32)
        .max((120.0 * scale).ceil() as u32).min(available_width);
    let height = ((image.height() as f64 * ratio).round() as u32)
        .max((72.0 * scale).ceil() as u32).min(available_height);
    let local_x = (x / viewport_width * size.width as f64).round()
        .clamp(0.0, size.width.saturating_sub(width) as f64);
    let local_y = (y / viewport_height * size.height as f64).round()
        .clamp(0.0, size.height.saturating_sub(height) as f64);
    let position = PhysicalPosition::new(
        (monitor.position().x as f64 + local_x).round() as i32,
        (monitor.position().y as f64 + local_y).round() as i32,
    );
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image).write_to(&mut png, ImageFormat::Png)
        .map_err(|_| AppError::Screenshot("准备贴图失败。".to_string()))?;
    let encoded = format!("data:image/png;base64,{}", STANDARD.encode(png.into_inner()));
    let state = app.state::<PinnedScreenshotState>();
    let label = format!("pinned-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    {
        let mut images = state.images.lock()
            .map_err(|_| AppError::Screenshot("贴图状态不可用。".to_string()))?;
        if images.len() >= MAX_PINNED_IMAGES {
            return Err(AppError::Validation("最多同时保留 16 张贴图，请先关闭部分贴图。".to_string()));
        }
        images.insert(label.clone(), None);
    }
    if let Ok(mut flags) = state.auto_translate.lock() { flags.insert(label.clone(), translate); }
    // This runs on a blocking worker: creating a WebView on the Windows main thread can deadlock.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html#pinned".into()))
        .title("贴图 · DeskTool")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(true)
        .visible(false)
        .inner_size(width as f64 / scale, height as f64 / scale)
        .min_inner_size(120.0, 72.0)
        .build();
    let window = match window {
        Ok(window) => window,
        Err(_) => {
            remove_pinned_screenshot(app, &label);
            return Err(AppError::Screenshot("无法创建贴图窗口，请重试。".to_string()));
        }
    };
    if window.set_size(PhysicalSize::new(width, height))
        .and_then(|_| window.set_position(position)).is_err()
    {
        let _ = window.destroy();
        remove_pinned_screenshot(app, &label);
        return Err(AppError::Screenshot("无法设置贴图位置，请重试。".to_string()));
    }
    {
        let mut images = match state.images.lock() {
            Ok(images) => images,
            Err(_) => {
                let _ = window.destroy();
                return Err(AppError::Screenshot("贴图状态不可用。".to_string()));
            }
        };
        if let Some(image) = images.get_mut(&label) { *image = Some(encoded); }
        else {
            drop(images);
            let _ = window.destroy();
            return Err(AppError::Screenshot("贴图窗口已关闭。".to_string()));
        }
    }
    // The image page shows the window after decoding, avoiding a blank window above the capture overlay.
    Ok(label)
}

pub fn get_pinned_screenshot(window: &WebviewWindow) -> Result<Option<String>, AppError> {
    let state = window.app_handle().state::<PinnedScreenshotState>();
    let images = state.images.lock()
        .map_err(|_| AppError::Screenshot("贴图状态不可用。".to_string()))?;
    images.get(window.label()).cloned()
        .ok_or_else(|| AppError::Screenshot("贴图已关闭或不可用。".to_string()))
}

pub fn show_pinned_screenshot(window: &WebviewWindow) -> Result<(), AppError> {
    let state = window.app_handle().state::<PinnedScreenshotState>();
    let exists = state.images.lock()
        .map_err(|_| AppError::Screenshot("贴图状态不可用。".to_string()))?
        .get(window.label()).is_some_and(|image| image.is_some());
    if !exists { return Err(AppError::Screenshot("贴图已关闭或不可用。".to_string())); }
    window.set_always_on_top(true).and_then(|_| window.show()).and_then(|_| window.set_focus())
        .map_err(|_| AppError::Screenshot("无法显示置顶贴图。".to_string()))
}

pub fn image_for_label(app: &AppHandle, label: &str) -> Result<String, AppError> {
    let state = app.state::<PinnedScreenshotState>();
    let images = state.images.lock().map_err(|_| AppError::Screenshot("贴图状态不可用。".into()))?;
    images.get(label).and_then(|image| image.clone())
        .ok_or_else(|| AppError::Screenshot("贴图图片尚未准备好或已关闭。".into()))
}

pub fn take_auto_translate(window: &WebviewWindow) -> bool {
    let state = window.app_handle().state::<PinnedScreenshotState>();
    let translate = state.auto_translate.lock().ok()
        .and_then(|mut flags| flags.remove(window.label())).unwrap_or(false);
    translate
}

pub fn remove_pinned_screenshot(app: &AppHandle, label: &str) {
    let state = app.state::<PinnedScreenshotState>();
    if let Ok(mut images) = state.images.lock() { images.remove(label); }
    if let Ok(mut flags) = state.auto_translate.lock() { flags.remove(label); }
    crate::translation_jobs::cancel_for_label(app, label, true);
}
