export type QQConfig = {
  enabled?: boolean;
  accounts?: Record<string, QQAccountConfig>;
};

export type QQAccountConfig = {
  enabled?: boolean;
  botQQ?: string;
  botName?: string;
  ownerQQ?: string;
  ownerName?: string;
  wsUrl?: string;
  token?: string;
  dmPolicy?: "open" | "pairing" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
  allowFrom?: string[];
  requireMention?: boolean;
  historyLimit?: number;
  textChunkLimit?: number;
  passiveGate?: PassiveGateConfig;
  groups?: Record<string, QQGroupConfig>;
  store?: QQStoreConfig;
};

export type QQStoreConfig = {
  mongoUri?: string;
  dbName?: string;
  tokenThreshold?: number;
  compactKeepRecent?: number;
  compactModel?: string;
  compactApiUrl?: string;
  compactApiKey?: string;
};

export type QQGroupConfig = {
  enabled?: boolean;
  requireMention?: boolean;
  passiveGate?: Partial<PassiveGateConfig>;
  historyLimit?: number;
};

export type PassiveGateConfig = {
  enabled?: boolean;
  model?: string;
  apiUrl?: string;
  apiKey?: string;
  debounceMs?: number;
  temperature?: number;
  maxRecentMessages?: number;
};

export type ResolvedQQStoreConfig = {
  mongoUri: string;
  dbName: string;
  tokenThreshold: number;
  compactKeepRecent: number;
  compactModel: string;
  compactApiUrl: string;
  compactApiKey: string;
};

export type ResolvedQQAccount = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
  botQQ: string;
  botName: string;
  ownerQQ: string;
  ownerName: string;
  wsUrl: string;
  token: string;
  dmPolicy: "open" | "pairing" | "disabled";
  groupPolicy: "open" | "allowlist" | "disabled";
  groupAllowFrom: string[];
  allowFrom: string[];
  requireMention: boolean;
  historyLimit: number;
  textChunkLimit: number;
  passiveGate: Required<PassiveGateConfig>;
  groups: Record<string, QQGroupConfig>;
  store: ResolvedQQStoreConfig;
  config: QQAccountConfig;
};
