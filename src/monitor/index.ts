import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { OneBotClient } from "../onebot/client.js";
import type { OneBotMessageEvent, OneBotNoticeEvent } from "../onebot/types.js";
import type { ResolvedQQAccount } from "../types.js";
import { handleQQMessage } from "./message-handler.js";
import { handleGroupFileUpload } from "./file-handler.js";
import { setCachedGroups } from "../admin/group-cache.js";
import { setActiveClient } from "./client-ref.js";
import { connectMongo, disconnectMongo } from "../store/connection.js";
import { loadRecentMessages, appendMessage } from "../store/chat-store.js";
import { segmentsToText } from "../utils/message-parser.js";
import type { ChatMessage } from "../store/types.js";
import { ensureAdminIndexes, migrateFromJsonIfNeeded, loadAdminConfig } from "../admin/admin-store.js";

export type MonitorQQOpts = {
  config: ClawdbotConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  accountId: string;
  account: ResolvedQQAccount;
};

export async function monitorQQProvider(opts: MonitorQQOpts): Promise<void> {
  const { config, runtime, abortSignal, account } = opts;
  const log = runtime.log ?? console.log;

  log(`[QQ] 启动 Monitor: bot=${account.botQQ} ws=${account.wsUrl}`);

  // Connect to MongoDB for message persistence + admin config
  try {
    await connectMongo(account.store.mongoUri, account.store.dbName);
    log(`[QQ] MongoDB 已连接: ${account.store.dbName}`);

    await ensureAdminIndexes();

    // One-time migration: import groups config from openclaw.json → MongoDB
    const migrated = await migrateFromJsonIfNeeded(
      account.groups ?? {},
      {
        dmPolicy: account.dmPolicy,
        groupPolicy: account.groupPolicy,
        requireMention: account.requireMention,
        passiveGateEnabled: account.passiveGate.enabled,
        debounceMs: account.passiveGate.debounceMs,
        historyLimit: account.historyLimit,
      },
    );
    if (migrated) log("[QQ] 已从 openclaw.json 迁移群配置到 MongoDB");
  } catch (err) {
    log(`[QQ] MongoDB 连接失败，将仅使用内存存储: ${String(err)}`);
  }

  const client = new OneBotClient(account.wsUrl, account.token, log);

  // Per-group chat history buffers for pending messages
  const chatHistories = new Map<string, HistoryEntry[]>();

  // Handle incoming messages
  client.on("message", (event: OneBotMessageEvent) => {
    handleQQMessage({
      cfg: config,
      event,
      client,
      account,
      runtime,
      chatHistories,
    }).catch((err) => {
      log(`[QQ] 消息处理错误: ${String(err)}`);
    });
  });

  client.on("notice", (event: OneBotNoticeEvent) => {
    log(`[QQ] Notice: ${JSON.stringify(event).slice(0, 200)}`);

    if (event.notice_type === "group_upload") {
      loadAdminConfig().then((adminCfg) => {
        const historyLimit = adminCfg.global.historyLimit ?? 25;
        handleGroupFileUpload({
          event,
          client,
          account,
          chatHistories,
          historyLimit,
          log,
        }).catch((err) => {
          log(`[QQ] 文件处理错误: ${String(err)}`);
        });
      }).catch((err) => {
        log(`[QQ] 加载管理配置失败: ${String(err)}`);
      });
    }
  });

  client.on("disconnected", () => {
    log("[QQ] WebSocket 断开，等待自动重连...");
  });

  // Connect to NapCat
  try {
    await client.connect();
    setActiveClient(client);

    const loginInfo = await client.getLoginInfo();
    log(`[QQ] 已登录: ${loginInfo.nickname} (${loginInfo.user_id})`);

    try {
      const groups = await client.getGroupList();
      setCachedGroups(groups);
      log(`[QQ] 群列表: ${groups.map((g) => `${g.group_name}(${g.group_id})`).join(", ")}`);

      // Restore recent messages from MongoDB into memory Map
      for (const group of groups) {
        const chatKey = `group:${group.group_id}`;
        try {
          const recent = await loadRecentMessages(chatKey, account.historyLimit);
          if (recent.length > 0) {
            const entries: HistoryEntry[] = recent.map((m) => ({
              sender: m.senderId,
              body: `${m.sender}: ${m.content}`,
              timestamp: m.timestamp,
              messageId: m.messageId,
            }));
            chatHistories.set(String(group.group_id), entries);
          }
        } catch {
          // Non-critical: memory map starts empty for this group
        }
      }
      const restored = [...chatHistories.values()].reduce((s, e) => s + e.length, 0);
      if (restored > 0) log(`[QQ] 从 MongoDB 恢复 ${restored} 条历史消息`);

      // Backfill offline messages from QQ history API
      let totalBackfilled = 0;
      for (const group of groups) {
        try {
          const groupIdStr = String(group.group_id);
          const chatKey = `group:${groupIdStr}`;
          const existing = chatHistories.get(groupIdStr) ?? [];
          const existingIds = new Set(existing.map((e) => e.messageId).filter(Boolean));

          const historyResp = await client.getGroupMsgHistory(group.group_id, 0, 30);
          const qqMessages = historyResp?.messages ?? [];

          const botQQNum = Number(account.botQQ);
          let backfilled = 0;
          for (const msg of qqMessages) {
            if (!("message_id" in msg)) continue;
            const ev = msg as OneBotMessageEvent;
            if (ev.user_id === botQQNum) continue;
            const msgIdStr = String(ev.message_id);
            if (existingIds.has(msgIdStr)) continue;

            const senderName = ev.sender?.nickname ?? `QQ用户${ev.user_id}`;
            const content = segmentsToText(ev.message);
            if (!content.trim()) continue;

            const chatMsg: ChatMessage = {
              messageId: msgIdStr,
              sender: senderName,
              senderId: String(ev.user_id),
              content,
              timestamp: (ev.time ?? Math.floor(Date.now() / 1000)) * 1000,
              role: "user",
            };
            await appendMessage(chatKey, chatMsg, account.store);
            existing.push({
              sender: String(ev.user_id),
              body: `${senderName}: ${content}`,
              timestamp: chatMsg.timestamp,
              messageId: msgIdStr,
            });
            backfilled++;
          }
          if (backfilled > 0) {
            chatHistories.set(groupIdStr, existing);
            totalBackfilled += backfilled;
          }
        } catch {
          // Non-critical: some groups may not support history API
        }
      }
      if (totalBackfilled > 0) log(`[QQ] 从 QQ 历史补齐 ${totalBackfilled} 条离线消息`);
    } catch (err) {
      log(`[QQ] 获取群列表失败: ${String(err)}`);
    }
  } catch (err) {
    log(`[QQ] 连接 NapCat 失败: ${String(err)}`);
    throw err;
  }

  // Keep monitor alive until abort signal fires
  return new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      client.disconnect().catch(() => {});
      resolve();
      return;
    }
    abortSignal.addEventListener("abort", () => {
      log("[QQ] Monitor 收到停止信号");
      setActiveClient(null);
      Promise.all([
        client.disconnect(),
        disconnectMongo(),
      ]).then(() => resolve()).catch(() => resolve());
    });
  });
}
