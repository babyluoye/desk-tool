use crate::error::AppError;
use image::{Rgba, RgbaImage};
use serde::Deserialize;

const MAX_ANNOTATIONS: usize = 128;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationTool {
    RedBox,
    Mosaic,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenshotAnnotation {
    tool: AnnotationTool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub fn validate_annotations(annotations: &[ScreenshotAnnotation]) -> Result<(), AppError> {
    if annotations.len() > MAX_ANNOTATIONS {
        return Err(AppError::Validation("标注数量过多，请先撤销或清除部分标注。".to_string()));
    }
    for annotation in annotations {
        if ![annotation.x, annotation.y, annotation.width, annotation.height]
            .iter().all(|value| value.is_finite())
            || annotation.x < 0.0 || annotation.y < 0.0
            || annotation.x >= 1.0 || annotation.y >= 1.0
            || annotation.width <= 0.0 || annotation.height <= 0.0
            || annotation.x + annotation.width > 1.0 + 1e-9
            || annotation.y + annotation.height > 1.0 + 1e-9
        {
            return Err(AppError::Validation("标注区域无效，请重新绘制。".to_string()));
        }
    }
    Ok(())
}

// Called only after validating normalized rectangles and the selection dimensions.
pub fn apply_annotations(
    image: &mut RgbaImage,
    annotations: &[ScreenshotAnnotation],
    selection_width: f64,
    selection_height: f64,
) {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 { return; }
    let scale_x = width as f64 / selection_width;
    let scale_y = height as f64 / selection_height;
    for annotation in annotations {
        let left = ((annotation.x * width as f64).floor() as u32).min(width - 1);
        let top = ((annotation.y * height as f64).floor() as u32).min(height - 1);
        let right = (((annotation.x + annotation.width) * width as f64).ceil() as u32).min(width);
        let bottom = (((annotation.y + annotation.height) * height as f64).ceil() as u32).min(height);
        if right <= left || bottom <= top { continue; }
        match annotation.tool {
            AnnotationTool::RedBox => {
                let line_x = (3.0 * scale_x).ceil().max(1.0) as u32;
                let line_y = (3.0 * scale_y).ceil().max(1.0) as u32;
                let line_x = line_x.min(right - left);
                let line_y = line_y.min(bottom - top);
                let red = Rgba([227, 27, 35, 255]);
                for y in top..bottom {
                    if y - top < line_y || bottom - y <= line_y {
                        for x in left..right { image.put_pixel(x, y, red); }
                    } else {
                        for x in left..left + line_x { image.put_pixel(x, y, red); }
                        for x in right - line_x..right { image.put_pixel(x, y, red); }
                    }
                }
            }
            AnnotationTool::Mosaic => {
                let block_x = ((12.0 * scale_x).round().max(1.0) as u32).min(width);
                let block_y = ((12.0 * scale_y).round().max(1.0) as u32).min(height);
                for by in (top..bottom).step_by(block_y as usize) {
                    for bx in (left..right).step_by(block_x as usize) {
                        let end_x = bx.saturating_add(block_x).min(right);
                        let end_y = by.saturating_add(block_y).min(bottom);
                        let mut totals = [0u64; 4];
                        let count = (end_x - bx) as u64 * (end_y - by) as u64;
                        for y in by..end_y {
                            for x in bx..end_x {
                                let pixel = image.get_pixel(x, y);
                                for channel in 0..4 { totals[channel] += pixel[channel] as u64; }
                            }
                        }
                        let color = Rgba(totals.map(|total| (total / count) as u8));
                        for y in by..end_y {
                            for x in bx..end_x { image.put_pixel(x, y, color); }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn annotation(tool: AnnotationTool, x: f64, y: f64, width: f64, height: f64) -> ScreenshotAnnotation {
        ScreenshotAnnotation { tool, x, y, width, height }
    }

    #[test]
    fn rejects_invalid_rectangles_and_excessive_counts() {
        for invalid in [
            annotation(AnnotationTool::RedBox, f64::NAN, 0.0, 0.5, 0.5),
            annotation(AnnotationTool::Mosaic, 0.0, 0.0, f64::INFINITY, 0.5),
            annotation(AnnotationTool::Mosaic, -0.1, 0.0, 0.5, 0.5),
            annotation(AnnotationTool::RedBox, 0.0, 0.0, 0.0, 0.5),
            annotation(AnnotationTool::RedBox, 0.9, 0.0, 0.2, 0.5),
        ] {
            assert!(validate_annotations(&[invalid]).is_err());
        }
        let excessive: Vec<_> = (0..129)
            .map(|_| annotation(AnnotationTool::RedBox, 0.0, 0.0, 1.0, 1.0)).collect();
        assert!(validate_annotations(&excessive).is_err());
        assert!(validate_annotations(&[]).is_ok());
    }

    #[test]
    fn accepts_frontend_tool_names_and_rejects_unknown_tools() {
        for tool in ["redBox", "mosaic"] {
            let value = serde_json::json!({ "tool": tool, "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 });
            let parsed: ScreenshotAnnotation = serde_json::from_value(value).unwrap();
            assert!(validate_annotations(&[parsed]).is_ok());
        }
        let value = serde_json::json!({ "tool": "unknown", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 });
        assert!(serde_json::from_value::<ScreenshotAnnotation>(value).is_err());
    }

    #[test]
    fn red_box_scales_with_dpi_and_preserves_interior_and_outside() {
        let background = Rgba([10, 20, 30, 255]);
        let mut image = RgbaImage::from_pixel(80, 80, background);
        apply_annotations(&mut image, &[annotation(AnnotationTool::RedBox, 0.25, 0.25, 0.5, 0.5)], 40.0, 40.0);
        let red = Rgba([227, 27, 35, 255]);
        assert_eq!(*image.get_pixel(20, 20), red);
        assert_eq!(*image.get_pixel(25, 40), red);
        assert_eq!(*image.get_pixel(26, 40), background);
        assert_eq!(*image.get_pixel(40, 40), background);
        assert_eq!(*image.get_pixel(59, 59), red);
        assert_eq!(*image.get_pixel(60, 60), background);
    }

    #[test]
    fn mosaic_averages_partial_blocks_and_does_not_modify_outside() {
        let mut image = RgbaImage::from_fn(16, 4, |x, _| Rgba([x as u8, 20, 30, 255]));
        apply_annotations(&mut image, &[annotation(AnnotationTool::Mosaic, 0.0, 0.0, 0.875, 1.0)], 16.0, 4.0);
        assert_eq!(image.get_pixel(0, 0)[0], 5);
        assert_eq!(image.get_pixel(11, 3)[0], 5);
        assert_eq!(image.get_pixel(12, 0)[0], 12);
        assert_eq!(image.get_pixel(13, 3)[0], 12);
        assert_eq!(image.get_pixel(14, 0)[0], 14);
        assert_eq!(image.get_pixel(15, 3)[0], 15);
    }

    #[test]
    fn applies_overlapping_annotations_in_order() {
        let mut image = RgbaImage::from_pixel(12, 12, Rgba([0, 0, 0, 255]));
        let annotations = [
            annotation(AnnotationTool::RedBox, 0.0, 0.0, 1.0, 1.0),
            annotation(AnnotationTool::Mosaic, 0.0, 0.0, 1.0, 1.0),
            annotation(AnnotationTool::RedBox, 0.25, 0.25, 0.5, 0.5),
        ];
        apply_annotations(&mut image, &annotations, 12.0, 12.0);
        assert_eq!(*image.get_pixel(0, 0), Rgba([170, 20, 26, 255]));
        assert_eq!(*image.get_pixel(3, 3), Rgba([227, 27, 35, 255]));
    }
}
