import { invoke } from "@tauri-apps/api/core";
import type { TranslationJob } from "./domain";

export const translationApi = {
  start: () => invoke<TranslationJob>("start_image_translation"),
  snapshot: () => invoke<TranslationJob | null>("get_image_translation"),
  cancel: () => invoke<void>("cancel_image_translation"),
  copy: (text: string) => invoke<void>("copy_translation_text", { text }),
};

export function fitImage(width: number, height: number, imageWidth: number, imageHeight: number) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const fittedWidth = imageWidth * scale;
  const fittedHeight = imageHeight * scale;
  return { x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}

export const languageOptions = [
  ["zh-CN", "简体中文"], ["zh-TW", "繁体中文"], ["en", "英语"], ["ja", "日语"],
  ["ko", "韩语"], ["fr", "法语"], ["de", "德语"], ["ru", "俄语"], ["es", "西班牙语"],
];
