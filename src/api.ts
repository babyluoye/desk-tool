import { invoke } from "@tauri-apps/api/core";
import type { AppSnapshot, SyncResult, UpdateTokenGroupInput, UsageLogPage } from "./domain";

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
};
