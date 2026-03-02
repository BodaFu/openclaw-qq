import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getQQRuntime } from "../runtime.js";
import { getCachedGroups } from "./group-cache.js";
import {
  loadAdminConfig,
  saveGlobalConfig,
  saveGroupOverride,
  resolveGroupAdmin,
  type AdminGlobalConfig,
  type AdminGroupOverride,
} from "./admin-store.js";
import { renderAdminPage } from "./page.js";

type GroupApiItem = {
  groupId: string;
  groupName: string;
  memberCount: number;
  enabled: boolean;
  requireMention: boolean;
  passiveGateEnabled: boolean;
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ── GET /qq/admin/api/config ──

async function handleGetConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = getQQRuntime();
  const cfg = runtime.config.loadConfig() as Record<string, unknown>;
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const qq = channels?.qq as Record<string, unknown> | undefined;
  const accounts = qq?.accounts as Record<string, unknown> | undefined;
  const defaultAccount = accounts?.default as Record<string, unknown> | undefined;
  const botQQ = (defaultAccount?.botQQ as string) ?? "";
  const botName = (defaultAccount?.botName as string) ?? "Bot";

  const adminCfg = await loadAdminConfig();
  const groups = getCachedGroups();

  const items: GroupApiItem[] = groups.map((g) => {
    const gid = String(g.group_id);
    const resolved = resolveGroupAdmin(adminCfg.global, adminCfg.groups, gid);
    return {
      groupId: gid,
      groupName: g.group_name,
      memberCount: g.member_count,
      enabled: resolved.enabled,
      requireMention: resolved.requireMention,
      passiveGateEnabled: resolved.passiveGateEnabled,
    };
  });

  sendJson(res, 200, {
    botQQ,
    botName,
    global: adminCfg.global,
    groups: items,
  });
}

// ── POST /qq/admin/api/global ──

async function handlePostGlobal(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Partial<AdminGlobalConfig>;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendError(res, 400, "Invalid JSON");
    return;
  }

  const allowed: (keyof AdminGlobalConfig)[] = [
    "dmPolicy", "groupPolicy", "requireMention",
    "passiveGateEnabled", "debounceMs", "historyLimit",
  ];
  const patch: Partial<AdminGlobalConfig> = {};
  for (const key of allowed) {
    if (key in body) {
      (patch as Record<string, unknown>)[key] = body[key];
    }
  }

  if (Object.keys(patch).length === 0) {
    sendError(res, 400, "No valid fields to update");
    return;
  }

  try {
    await saveGlobalConfig(patch);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, 500, `Failed to save: ${String(err)}`);
  }
}

// ── POST /qq/admin/api/group ──

async function handlePostGroup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { groupId?: string } & AdminGroupOverride;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendError(res, 400, "Invalid JSON");
    return;
  }

  const { groupId, ...override } = body;
  if (typeof groupId !== "string" || !groupId) {
    sendError(res, 400, "Missing groupId");
    return;
  }

  try {
    const adminCfg = await loadAdminConfig();
    const existing = adminCfg.groups[groupId] ?? {};
    const merged: AdminGroupOverride = { ...existing, ...override };
    await saveGroupOverride(groupId, merged);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, 500, `Failed to save: ${String(err)}`);
  }
}

export function registerQQAdminRoutes(api: OpenClawPluginApi): void {
  api.registerHttpRoute({
    path: "/qq/admin",
    handler: (_req, res) => {
      sendHtml(res, renderAdminPage());
    },
  });

  api.registerHttpRoute({
    path: "/qq/admin/api/config",
    handler: async (req, res) => {
      if (req.method === "GET") {
        await handleGetConfig(req, res);
      } else {
        sendError(res, 405, "Method Not Allowed");
      }
    },
  });

  api.registerHttpRoute({
    path: "/qq/admin/api/global",
    handler: async (req, res) => {
      if (req.method === "POST") {
        await handlePostGlobal(req, res);
      } else {
        sendError(res, 405, "Method Not Allowed");
      }
    },
  });

  api.registerHttpRoute({
    path: "/qq/admin/api/group",
    handler: async (req, res) => {
      if (req.method === "POST") {
        await handlePostGroup(req, res);
      } else {
        sendError(res, 405, "Method Not Allowed");
      }
    },
  });
}
