import { invoke } from "@tauri-apps/api/core";
import type { AppSnapshot, SyncResult, UpdateTokenGroupInput } from "./domain";

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

  updateRefreshInterval(seconds: number): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("update_refresh_interval", { input: { seconds } });
  },

  updateInactiveOpacity(percent: number): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("update_inactive_opacity", { input: { percent } });
  },
};
