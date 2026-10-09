import { invoke } from "@tauri-apps/api/core";
import type { AppSnapshot, SyncResult, TranslationSettings, UpdateTokenGroupInput, UsageLogPage } from "./domain";

export const appApi = {
  getSnapshot(): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("get_snapshot");
  },

  saveConnection(config: { baseUrl: string; adminCredential: string }): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("save_connection", { input: config });
  },

  syncFromNewApi(): Promise<SyncResult> {
    return invoke<SyncResult>("sync_from_newapi");
  },

  updateTokenGroup(input: UpdateTokenGroupInput): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("update_token_group", { input });
  },

  getUsageLogs(page: number): Promise<UsageLogPage> {
    return invoke<UsageLogPage>("get_usage_logs", { input: { page } });
  },

  setCloseToTray(closeToTray: boolean): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("set_close_to_tray", { closeToTray });
  },

  setScreenshotShortcut(shortcut: string): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("set_screenshot_shortcut", { shortcut });
  },

  getScreenshotShortcutWarning(): Promise<string | null> {
    return invoke<string | null>("get_screenshot_shortcut_warning");
  },

  setScreenshotShortcutRecording(recording: boolean): Promise<void> {
    return invoke<void>("set_screenshot_shortcut_recording", { recording });
  },

  getTranslationSettings(): Promise<TranslationSettings> {
    return invoke<TranslationSettings>("get_translation_settings");
  },

  saveTranslationSettings(settings: TranslationSettings, apiKey: string, clearApiKey: boolean): Promise<TranslationSettings> {
    return invoke<TranslationSettings>("save_translation_settings", { input: { settings, apiKey, clearApiKey } });
  },

  startScreenshot(): Promise<void> {
    return invoke<void>("start_screenshot");
  },
};
