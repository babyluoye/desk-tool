import { invoke } from "@tauri-apps/api/core";
import type { AppSnapshot, CloudflareZone, DnsRecord, DnsRecordInput, SyncResult, UpdateTokenGroupInput, UsageLogPage } from "./domain";

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

  getCloudflareTokenConfigured(): Promise<boolean> {
    return invoke<boolean>("get_cloudflare_token_configured");
  },

  saveCloudflareToken(token: string): Promise<boolean> {
    return invoke<boolean>("save_cloudflare_token", { token });
  },

  clearCloudflareToken(): Promise<void> {
    return invoke<void>("clear_cloudflare_token");
  },

  listCloudflareZones(): Promise<CloudflareZone[]> {
    return invoke<CloudflareZone[]>("list_cloudflare_zones");
  },

  listDnsRecords(zoneId: string): Promise<DnsRecord[]> {
    return invoke<DnsRecord[]>("list_dns_records", { zoneId });
  },

  saveDnsRecord(input: DnsRecordInput): Promise<void> {
    return invoke<void>("save_dns_record", { input });
  },

  deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    return invoke<void>("delete_dns_record", { zoneId, recordId });
  },

  setCloseToTray(closeToTray: boolean): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("set_close_to_tray", { closeToTray });
  },

};
