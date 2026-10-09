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
  screenshotShortcut: string;
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

export type TranslationProvider = "google_free" | "openai";
export interface TranslationSettings {
  provider: TranslationProvider;
  sourceLanguage: string;
  targetLanguage: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  customProxy: string;
  fontScale: number;
  consent: boolean;
}
export interface OcrRegion {
  id: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OcrDocument { width: number; height: number; regions: OcrRegion[] }
export interface TranslationOutput {
  document: OcrDocument;
  translations: string[];
  provider: TranslationProvider;
  targetLanguage: string;
}
export interface TranslationJob {
  id: string;
  status: "queued" | "recognizing" | "translating" | "success" | "error" | "cancelled";
  error: string | null;
  document: OcrDocument | null;
  output: TranslationOutput | null;
}
