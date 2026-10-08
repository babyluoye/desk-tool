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
}

export interface SyncResult {
  snapshot: AppSnapshot;
  warning: string | null;
}

export interface UpdateTokenGroupInput {
  tokenId: string;
  groupId: string;
}
