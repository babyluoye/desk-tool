export type ConnectionState = "not_configured" | "ready" | "syncing" | "error";

export interface ConnectionConfig {
  baseUrl: string;
  adminCredentialConfigured: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  maskedToken: string;
  groupId: string | null;
  groupName: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

export interface TokenGroup {
  id: string;
  name: string;
  tokenCount: number;
}

export interface AppSnapshot {
  connection: ConnectionConfig | null;
  tokens: ApiToken[];
  groups: TokenGroup[];
  lastSyncedAt: string | null;
  closeToTray: boolean;
}

export interface SyncResult {
  snapshot: AppSnapshot;
  warning: string | null;
}

export interface UpdateTokenGroupInput {
  tokenId: string;
  groupId: string;
}

export interface UsageLog {
  id: number;
  createdAt: number;
  username: string;
  tokenName: string;
  modelName: string;
  quota: number;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  isStream: boolean;
  channelName: string;
  group: string;
}

export interface UsageLogPage {
  items: UsageLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface DnsRecord {
  id: string;
  zoneId: string;
  recordType: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  data: Record<string, unknown> | null;
}

export interface DnsRecordInput {
  zoneId: string;
  zoneName: string;
  recordId: string | null;
  recordType: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  data: Record<string, unknown> | null;
}
