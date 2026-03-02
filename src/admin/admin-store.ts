import { getDb } from "../store/connection.js";
import type { Collection } from "mongodb";

// ── Types ──

export type AdminGlobalConfig = {
  dmPolicy: "open" | "pairing" | "disabled";
  groupPolicy: "open" | "allowlist" | "disabled";
  requireMention: boolean;
  passiveGateEnabled: boolean;
  debounceMs: number;
  dmDebounceMs?: number;
  historyLimit: number;
};

export type AdminGroupOverride = {
  enabled?: boolean;
  requireMention?: boolean;
  passiveGateEnabled?: boolean;
};

export type AdminConfigDocument = {
  _key: "global";
  global: AdminGlobalConfig;
  groups: Record<string, AdminGroupOverride>;
  migratedFromJson?: boolean;
  updatedAt: Date;
};

const COLLECTION = "qq_admin_config";
const DOC_KEY = "global" as const;

function collection(): Collection<AdminConfigDocument> {
  return getDb().collection<AdminConfigDocument>(COLLECTION);
}

const DEFAULT_GLOBAL: AdminGlobalConfig = {
  dmPolicy: "open",
  groupPolicy: "open",
  requireMention: false,
  passiveGateEnabled: true,
  debounceMs: 3000,
  historyLimit: 25,
};

// ── Read ──

export async function loadAdminConfig(): Promise<AdminConfigDocument> {
  try {
    const doc = await collection().findOne({ _key: DOC_KEY });
    if (doc) return doc;
  } catch {
    // MongoDB unavailable — fall back to defaults
  }
  return {
    _key: DOC_KEY,
    global: { ...DEFAULT_GLOBAL },
    groups: {},
    updatedAt: new Date(),
  };
}

// ── Write: global ──

export async function saveGlobalConfig(patch: Partial<AdminGlobalConfig>): Promise<void> {
  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      setFields[`global.${k}`] = v;
    }
  }
  await collection().updateOne(
    { _key: DOC_KEY },
    { $set: setFields, $setOnInsert: { groups: {} } },
    { upsert: true },
  );
}

// ── Write: per-group ──

export async function saveGroupOverride(
  groupId: string,
  override: AdminGroupOverride,
): Promise<void> {
  await collection().updateOne(
    { _key: DOC_KEY },
    {
      $set: {
        [`groups.${groupId}`]: override,
        updatedAt: new Date(),
      },
      $setOnInsert: { global: { ...DEFAULT_GLOBAL } },
    },
    { upsert: true },
  );
}

// ── Resolve: merge global + per-group for runtime use ──

export type ResolvedGroupAdmin = {
  enabled: boolean;
  requireMention: boolean;
  passiveGateEnabled: boolean;
};

export function resolveGroupAdmin(
  global: AdminGlobalConfig,
  groups: Record<string, AdminGroupOverride>,
  groupId: string,
): ResolvedGroupAdmin {
  const override = groups[groupId];
  const wildcard = groups["*"];
  return {
    enabled: override?.enabled ?? wildcard?.enabled ?? true,
    requireMention: override?.requireMention ?? wildcard?.requireMention ?? global.requireMention,
    passiveGateEnabled: override?.passiveGateEnabled ?? wildcard?.passiveGateEnabled ?? global.passiveGateEnabled,
  };
}

// ── Migration: import groups config from openclaw.json (one-time) ──

export async function migrateFromJsonIfNeeded(
  jsonGroups: Record<string, { enabled?: boolean; requireMention?: boolean; passiveGate?: { enabled?: boolean } }>,
  globalDefaults: { dmPolicy?: string; groupPolicy?: string; requireMention?: boolean; passiveGateEnabled?: boolean; debounceMs?: number; historyLimit?: number },
): Promise<boolean> {
  const existing = await collection().findOne({ _key: DOC_KEY });
  if (existing?.migratedFromJson) return false;

  const groups: Record<string, AdminGroupOverride> = {};
  for (const [gid, gcfg] of Object.entries(jsonGroups)) {
    groups[gid] = {
      enabled: gcfg.enabled,
      requireMention: gcfg.requireMention,
      passiveGateEnabled: gcfg.passiveGate?.enabled,
    };
  }

  const global: AdminGlobalConfig = {
    dmPolicy: (globalDefaults.dmPolicy as AdminGlobalConfig["dmPolicy"]) ?? DEFAULT_GLOBAL.dmPolicy,
    groupPolicy: (globalDefaults.groupPolicy as AdminGlobalConfig["groupPolicy"]) ?? DEFAULT_GLOBAL.groupPolicy,
    requireMention: globalDefaults.requireMention ?? DEFAULT_GLOBAL.requireMention,
    passiveGateEnabled: globalDefaults.passiveGateEnabled ?? DEFAULT_GLOBAL.passiveGateEnabled,
    debounceMs: globalDefaults.debounceMs ?? DEFAULT_GLOBAL.debounceMs,
    historyLimit: globalDefaults.historyLimit ?? DEFAULT_GLOBAL.historyLimit,
  };

  await collection().updateOne(
    { _key: DOC_KEY },
    {
      $set: { global, groups, migratedFromJson: true, updatedAt: new Date() },
    },
    { upsert: true },
  );
  return true;
}

export async function ensureAdminIndexes(): Promise<void> {
  await collection().createIndex({ _key: 1 }, { unique: true });
}
