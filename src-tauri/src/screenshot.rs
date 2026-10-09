use crate::{
    error::AppError,
    screenshot_annotation::{apply_annotations, validate_annotations, ScreenshotAnnotation},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{imageops, DynamicImage, ImageFormat, RgbaImage};
use screenshots::Screen;
use serde::Deserialize;
use std::{
    borrow::Cow,
    io::Cursor,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct ScreenshotState(Mutex<Option<CapturedScreen>>, AtomicBool);

struct CapturedScreen {
    image: RgbaImage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSelection {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
    #[serde(default)]
    annotations: Vec<ScreenshotAnnotation>,
}

impl ScreenshotState {
    pub fn new() -> Self {
        Self(Mutex::new(None), AtomicBool::new(false))
    }
}

pub fn begin_screenshot(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<ScreenshotState>();
    let mut session = state
        .0
        .lock()
        .map_err(|_| AppError::Screenshot("截图状态不可用。".to_string()))?;
    let is_new_capture = session.is_none();
    if is_new_capture {
        let screens = Screen::all()
            .map_err(|error| AppError::Screenshot(format!("无法读取屏幕：{error}")))?;
        let screen = screens
            .iter()
            .find(|screen| screen.display_info.is_primary)
            .or_else(|| screens.first())
            .ok_or_else(|| AppError::Screenshot("未检测到可用屏幕。".to_string()))?;
        let image = screen
            .capture()
            .map_err(|error| AppError::Screenshot(format!("屏幕捕获失败：{error}")))?;
        *session = Some(CapturedScreen { image });
    }
    drop(session);

    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| AppError::Screenshot("截图窗口不可用。".to_string()))?;
    let open_window = || -> Result<(), AppError> {
        if is_new_capture {
            // Tauri monitor coordinates are physical; screenshots/display-info can report scaled coordinates.
            let monitor = window.primary_monitor()
                .map_err(|_| AppError::Screenshot("无法读取主显示器范围。".to_string()))?
                .ok_or_else(|| AppError::Screenshot("未检测到主显示器。".to_string()))?;
            window.set_fullscreen(false)
                .and_then(|_| window.set_position(*monitor.position()))
                .and_then(|_| window.set_size(*monitor.size()))
                .and_then(|_| window.set_fullscreen(true))
                .map_err(|_| AppError::Screenshot("无法设置截图全屏覆盖。".to_string()))?;
        }
        window.set_always_on_top(true)
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .map_err(|_| AppError::Screenshot("无法打开截图窗口。".to_string()))?;
        if is_new_capture && state.1.load(Ordering::Acquire) {
            emit_screenshot_image(app)?;
        }
        Ok(())
    };
    let result = open_window();
    if result.is_err() && is_new_capture {
        let _ = finish_screenshot(app, &state);
    }
    result
}

pub fn screenshot_overlay_ready(app: &AppHandle, state: &ScreenshotState) -> Result<(), AppError> {
    state.1.store(true, Ordering::Release);
    if state
        .0
        .lock()
        .map_err(|_| AppError::Screenshot("截图状态不可用。".to_string()))?
        .is_some()
    {
        emit_screenshot_image(app)?;
    }
    Ok(())
}

fn emit_screenshot_image(app: &AppHandle) -> Result<(), AppError> {
    let image = get_screenshot_image(app.state::<ScreenshotState>())?;
    app.emit_to("capture", "screenshot-ready", image)
        .map_err(|_| AppError::Screenshot("无法显示屏幕图像。".to_string()))
}

pub fn get_screenshot_image(state: State<'_, ScreenshotState>) -> Result<String, AppError> {
    let session = state
        .0
        .lock()
        .map_err(|_| AppError::Screenshot("截图状态不可用。".to_string()))?;
    let image = session
        .as_ref()
        .ok_or_else(|| AppError::Screenshot("截图已结束，请重新开始。".to_string()))?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image.image.clone())
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| AppError::Screenshot("准备屏幕图像失败。".to_string()))?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png.into_inner())))
}

pub fn save_screenshot_impl(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    selection: ScreenshotSelection,
) -> Result<bool, AppError> {
    let image = crop_selection(&state, selection)?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| AppError::Screenshot("编码截图失败。".to_string()))?;
    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| AppError::Screenshot("截图窗口不可用。".to_string()))?;
    window
        .set_always_on_top(false)
        .map_err(|_| AppError::Screenshot("无法打开文件保存窗口。".to_string()))?;
    let path = rfd::FileDialog::new()
        .add_filter("PNG 图片", &["png"])
        .set_file_name("screenshot.png")
        .save_file();
    let Some(mut path) = path else {
        window
            .set_always_on_top(true)
            .map_err(|_| AppError::Screenshot("无法恢复截图窗口。".to_string()))?;
        return Ok(false);
    };
    path.set_extension("png");
    if std::fs::write(path, png.into_inner()).is_err() {
        let _ = window.set_always_on_top(true);
        return Err(AppError::Screenshot("保存截图失败，请检查目标位置和权限。".to_string()));
    }
    finish_screenshot(&app, &state)?;
    Ok(true)
}

pub fn copy_screenshot_impl(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    selection: ScreenshotSelection,
) -> Result<(), AppError> {
    let image = crop_selection(&state, selection)?;
    let (width, height) = image.dimensions();
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|_| AppError::Screenshot("无法访问系统剪贴板。".to_string()))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|_| AppError::Screenshot("复制截图到剪贴板失败。".to_string()))?;
    finish_screenshot(&app, &state)
}

pub fn pin_screenshot_impl(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    selection: ScreenshotSelection,
) -> Result<(), AppError> {
    let (x, y, viewport_width, viewport_height) =
        (selection.x, selection.y, selection.viewport_width, selection.viewport_height);
    let image = crop_selection(&state, selection)?;
    let label = crate::pinned_screenshot::create_pinned_screenshot(
        &app, image, x, y, viewport_width, viewport_height,
    )?;
    if let Err(error) = finish_screenshot(&app, &state) {
        if let Some(window) = app.get_webview_window(&label) { let _ = window.destroy(); }
        crate::pinned_screenshot::remove_pinned_screenshot(&app, &label);
        return Err(error);
    }
    Ok(())
}

pub fn cancel_screenshot_impl(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
) -> Result<(), AppError> {
    finish_screenshot(&app, &state)
}

pub fn cancel_screenshot_from_app(app: &AppHandle) {
    let state = app.state::<ScreenshotState>();
    let _ = finish_screenshot(app, &state);
}

fn crop_selection(
    state: &ScreenshotState,
    selection: ScreenshotSelection,
) -> Result<RgbaImage, AppError> {
    if ![
        selection.x,
        selection.y,
        selection.width,
        selection.height,
        selection.viewport_width,
        selection.viewport_height,
    ]
    .iter()
    .all(|value| value.is_finite())
        || selection.width <= 0.0
        || selection.height <= 0.0
        || selection.viewport_width <= 0.0
        || selection.viewport_height <= 0.0
        || selection.x < 0.0
        || selection.y < 0.0
        || selection.x + selection.width > selection.viewport_width
        || selection.y + selection.height > selection.viewport_height
    {
        return Err(AppError::Validation("请选择有效的截图区域。".to_string()));
    }

    validate_annotations(&selection.annotations)?;
    let session = state
        .0
        .lock()
        .map_err(|_| AppError::Screenshot("截图状态不可用。".to_string()))?;
    let image = &session
        .as_ref()
        .ok_or_else(|| AppError::Screenshot("截图已结束，请重新开始。".to_string()))?
        .image;
    let scale_x = image.width() as f64 / selection.viewport_width;
    let scale_y = image.height() as f64 / selection.viewport_height;
    let left = (selection.x.max(0.0) * scale_x).floor() as u32;
    let top = (selection.y.max(0.0) * scale_y).floor() as u32;
    let right = ((selection.x + selection.width).max(0.0) * scale_x)
        .ceil()
        .clamp(0.0, image.width() as f64) as u32;
    let bottom = ((selection.y + selection.height).max(0.0) * scale_y)
        .ceil()
        .clamp(0.0, image.height() as f64) as u32;
    let left = left.min(image.width());
    let top = top.min(image.height());
    if right <= left || bottom <= top {
        return Err(AppError::Validation("截图区域太小。".to_string()));
    }
    let mut cropped = imageops::crop_imm(image, left, top, right - left, bottom - top).to_image();
    drop(session);
    apply_annotations(&mut cropped, &selection.annotations, selection.width, selection.height);
    Ok(cropped)
}

fn finish_screenshot(app: &AppHandle, state: &ScreenshotState) -> Result<(), AppError> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| AppError::Screenshot("截图状态不可用。".to_string()))?;
    *session = None;
    drop(session);
    if let Some(window) = app.get_webview_window("capture") {
        window
            .hide()
            .map_err(|_| AppError::Screenshot("无法关闭截图窗口。".to_string()))?;
        window
            .set_always_on_top(true)
            .map_err(|_| AppError::Screenshot("无法重置截图窗口。".to_string()))?;
    }
    let _ = app.emit_to("capture", "screenshot-finished", ());
    Ok(())
}
