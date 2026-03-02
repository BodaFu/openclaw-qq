import { DEFAULT_ACCOUNT_ID, type ClawdbotConfig } from "openclaw/plugin-sdk";
import type { QQConfig, QQAccountConfig, ResolvedQQAccount } from "./types.js";

const DEFAULT_PASSIVE_GATE = {
  enabled: true,
  model: "qwen3.5-plus",
  apiUrl: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
  apiKey: "",
  debounceMs: 3000,
  temperature: 0.3,
  maxRecentMessages: 15,
} as const;

const DEFAULT_STORE = {
  mongoUri: "mongodb://127.0.0.1:27017",
  dbName: "openclaw_qq",
  tokenThreshold: 8000,
  compactKeepRecent: 10,
  compactModel: "qwen3.5-plus",
  compactApiUrl: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
  compactApiKey: "",
} as const;

function getQQConfig(cfg: ClawdbotConfig): QQConfig | undefined {
  return cfg.channels?.qq as QQConfig | undefined;
}

function getAccountConfig(cfg: ClawdbotConfig, accountId?: string): QQAccountConfig | undefined {
  const qqCfg = getQQConfig(cfg);
  if (!qqCfg) return undefined;

  const id = accountId ?? DEFAULT_ACCOUNT_ID;

  // Check named accounts first
  if (qqCfg.accounts?.[id]) return qqCfg.accounts[id];

  // For "default", use top-level qq config as the account
  if (id === DEFAULT_ACCOUNT_ID) {
    return qqCfg as unknown as QQAccountConfig;
  }

  return undefined;
}

export function resolveQQAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
}): ResolvedQQAccount {
  const { cfg, accountId } = params;
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const raw = getAccountConfig(cfg, id);
  const qqCfg = getQQConfig(cfg);
  const accounts = qqCfg?.accounts ?? {};
  const accountRaw = accounts[id] ?? (raw as QQAccountConfig | undefined);

  return {
    accountId: id,
    configured: Boolean(accountRaw?.wsUrl && accountRaw?.botQQ),
    enabled: accountRaw?.enabled !== false && qqCfg?.enabled !== false,
    botQQ: accountRaw?.botQQ ?? "",
    botName: accountRaw?.botName ?? "Bot",
    ownerQQ: accountRaw?.ownerQQ ?? "",
    ownerName: accountRaw?.ownerName ?? "",
    wsUrl: accountRaw?.wsUrl ?? "ws://127.0.0.1:7900",
    token: accountRaw?.token ?? "",
    dmPolicy: accountRaw?.dmPolicy ?? "open",
    groupPolicy: accountRaw?.groupPolicy ?? "open",
    groupAllowFrom: accountRaw?.groupAllowFrom ?? [],
    allowFrom: accountRaw?.allowFrom ?? [],
    requireMention: accountRaw?.requireMention ?? false,
    historyLimit: accountRaw?.historyLimit ?? 25,
    textChunkLimit: accountRaw?.textChunkLimit ?? 4000,
    passiveGate: {
      ...DEFAULT_PASSIVE_GATE,
      ...(accountRaw?.passiveGate ?? {}),
    },
    groups: accountRaw?.groups ?? {},
    store: {
      ...DEFAULT_STORE,
      compactApiKey: accountRaw?.store?.compactApiKey
        ?? accountRaw?.passiveGate?.apiKey
        ?? DEFAULT_STORE.compactApiKey,
      ...(accountRaw?.store ?? {}),
    },
    config: accountRaw ?? {},
  };
}

export function listQQAccountIds(cfg: ClawdbotConfig): string[] {
  const qqCfg = getQQConfig(cfg);
  if (!qqCfg) return [];
  if (qqCfg.accounts && Object.keys(qqCfg.accounts).length > 0) {
    return Object.keys(qqCfg.accounts);
  }
  // If no named accounts but qq config exists, treat as "default"
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultQQAccountId(cfg: ClawdbotConfig): string {
  const ids = listQQAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
