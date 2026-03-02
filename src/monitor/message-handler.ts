import {
  type ClawdbotConfig,
  type RuntimeEnv,
  type HistoryEntry,
  type AgentMediaPayload,
  recordPendingHistoryEntryIfEnabled,
  buildAgentMediaPayload,
} from "openclaw/plugin-sdk";
import type { OneBotClient } from "../onebot/client.js";
import type { OneBotMessageEvent, OneBotGroupMessageEvent } from "../onebot/types.js";
import type { ResolvedQQAccount } from "../types.js";
import { getQQRuntime } from "../runtime.js";
import { segmentsToText, buildReplySegments, extractReplyId, extractImageUrls } from "../utils/message-parser.js";
import { isBotMentioned } from "../utils/mention.js";
import { getGroupMemberInfo, resolveMemberDisplayName, resolveUserDisplayName, isEffectivelyEmpty } from "../utils/member-cache.js";
import { resolveQQMediaList } from "../utils/media.js";
import { stripThinkingTags, stripMarkdown, splitLongText } from "../utils/text-format.js";
import {
  evaluatePassiveGate,
  enqueuePassiveMessage,
  startGroupDispatch,
  endGroupDispatch,
  setGroupLastBotMessage,
  getGroupDispatchState,
  cancelPendingPassiveGate,
  type GateMessage,
} from "./passive-gate.js";
import {
  enqueueDmMessage,
  startDmDispatch,
  endDmDispatch,
  hasPendingDmMessages,
  DM_DEBOUNCE_MS_DEFAULT,
  type DmPendingMessage,
} from "./dm-gate.js";
import { appendMessage as appendToStore, isFirstConversation, loadMessagesSinceLastBot } from "../store/chat-store.js";
import type { ChatMessage, ChatStoreConfig } from "../store/types.js";
import { loadAdminConfig, resolveGroupAdmin } from "../admin/admin-store.js";
import { loadPersona } from "../store/persona-store.js";
import { distillPersona } from "../persona/persona-distiller.js";

const DEFAULT_HISTORY_LIMIT = 25;

// ── Message deduplication (handles NapCat reconnect replays) ──
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 2000;
const processedMessageIds = new Map<number, number>();

function isMessageDuplicate(messageId: number): boolean {
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.set(messageId, Date.now());
  // Periodic cleanup
  if (processedMessageIds.size > DEDUP_MAX_SIZE) {
    const now = Date.now();
    for (const [id, ts] of processedMessageIds) {
      if (now - ts > DEDUP_TTL_MS) processedMessageIds.delete(id);
    }
  }
  return false;
}

function persistMessageAsync(
  chatKey: string,
  msg: ChatMessage,
  storeConfig: ChatStoreConfig,
  log: (msg: string) => void,
): void {
  appendToStore(chatKey, msg, storeConfig).catch((err) => {
    log(`[QQ] MongoDB 写入失败 (${chatKey}): ${String(err).slice(0, 100)}`);
  });
}

function toChatMessage(params: {
  messageId: string | number;
  sender: string;
  senderId: string;
  content: string;
  role: "user" | "bot";
  mediaUrls?: string[];
  quotedContent?: string;
}): ChatMessage {
  return {
    messageId: String(params.messageId),
    sender: params.sender,
    senderId: params.senderId,
    content: params.content,
    timestamp: Date.now(),
    role: params.role,
    mediaUrls: params.mediaUrls,
    quotedContent: params.quotedContent,
  };
}

function collectMediaUrls(payload: { mediaUrl?: string; mediaUrls?: string[] }): string[] {
  const urls: string[] = [];
  if (payload.mediaUrls?.length) {
    urls.push(...payload.mediaUrls);
  } else if (payload.mediaUrl) {
    urls.push(payload.mediaUrl);
  }
  return urls.filter((u) => u.length > 0);
}

type HandleMessageParams = {
  cfg: ClawdbotConfig;
  event: OneBotMessageEvent;
  client: OneBotClient;
  account: ResolvedQQAccount;
  runtime: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
};

export async function handleQQMessage(params: HandleMessageParams): Promise<void> {
  const { cfg, event, client, account, runtime } = params;
  const log = runtime.log ?? console.log;
  const isGroup = event.message_type === "group";

  // Skip self messages
  if (String(event.user_id) === account.botQQ) return;

  // Deduplicate (NapCat replays messages on reconnect)
  if (isMessageDuplicate(event.message_id)) return;

  const senderId = String(event.user_id);
  const messageId = event.message_id;

  // Resolve sender display name (multiple fallback sources)
  let senderName: string;
  if (isGroup) {
    const groupEvent = event as OneBotGroupMessageEvent;
    const memberInfo = await getGroupMemberInfo(client, groupEvent.group_id, event.user_id);
    senderName = resolveMemberDisplayName(memberInfo) ?? "";
    if (isEffectivelyEmpty(senderName)) {
      senderName = await resolveUserDisplayName(client, event.user_id, event.sender.nickname);
    }
  } else {
    senderName = await resolveUserDisplayName(client, event.user_id, event.sender.nickname);
  }

  const replyToId = extractReplyId(event.message);
  const wasMentioned = isGroup
    ? isBotMentioned(event.message, account.botQQ)
    : false;

  // Build name resolver: bot QQ → botName
  const resolveName = (qq: string): string | undefined => {
    if (qq === account.botQQ) return account.botName;
    return undefined;
  };

  // Fetch quoted message content if this is a reply
  let quotedContent: string | undefined;
  if (replyToId) {
    try {
      const quotedMsg = await client.getMsg(Number(replyToId));
      const quotedText = segmentsToText(quotedMsg.message, resolveName);
      const quotedSender = quotedMsg.sender?.nickname ?? `QQ用户${quotedMsg.sender?.user_id}`;
      quotedContent = `[引用 ${quotedSender}: ${quotedText.slice(0, 200)}]`;
    } catch {
      // Quoted message may be expired or deleted
    }
  }

  // Keep @mentions in text (converted to @Name) so agent sees addressing intent
  let messageText = segmentsToText(event.message, resolveName);

  // Download images from message segments
  const hasImages = event.message.some((s) => s.type === "image");
  let mediaPayload: AgentMediaPayload | undefined;
  if (hasImages) {
    try {
      const mediaList = await resolveQQMediaList({
        segments: event.message,
        log: log,
      });
      if (mediaList.length > 0) {
        mediaPayload = buildAgentMediaPayload(mediaList);
        log(`[QQ] 收到 ${mediaList.length} 张图片`);
      }
    } catch (err) {
      log(`[QQ] 图片处理失败: ${String(err).slice(0, 100)}`);
    }
    if (!messageText.trim()) {
      messageText = `[图片×${mediaPayload?.MediaPaths?.length ?? 1}]`;
    }
  }

  if (isGroup) {
    await handleGroupMessage({
      ...params,
      groupId: (event as OneBotGroupMessageEvent).group_id,
      senderId,
      senderName,
      messageText,
      messageId,
      replyToId,
      wasMentioned,
      mediaPayload,
      quotedContent,
    });
  } else {
    await handlePrivateMessage({
      ...params,
      senderId,
      senderName,
      messageText,
      messageId,
      replyToId,
      mediaPayload,
      quotedContent,
    });
  }
}

// ── Private message: always dispatch to agent ──

type PrivateMessageParams = HandleMessageParams & {
  senderId: string;
  senderName: string;
  messageText: string;
  messageId: number;
  replyToId?: string;
  mediaPayload?: AgentMediaPayload;
  quotedContent?: string;
};

async function handlePrivateMessage(params: PrivateMessageParams): Promise<void> {
  const { cfg, account, runtime, client, senderId, senderName, messageText, messageId, replyToId, mediaPayload, quotedContent } =
    params;
  const log = runtime.log ?? console.log;

  const adminCfg = await loadAdminConfig();
  if (adminCfg.global.dmPolicy === "disabled") return;

  log(`[QQ] 私聊消息 ${senderName}(${senderId}): ${messageText.slice(0, 100)}`);

  const chatKey = `private:${senderId}`;

  // First conversation greeting
  let isFirst = false;
  try {
    isFirst = await isFirstConversation(chatKey);
  } catch {
    // Non-critical
  }

  persistMessageAsync(
    chatKey,
    toChatMessage({
      messageId,
      sender: senderName,
      senderId,
      content: messageText,
      role: "user",
      mediaUrls: mediaPayload?.MediaUrls as string[] | undefined,
      quotedContent,
    }),
    account.store,
    log,
  );

  if (isFirst) {
    log(`[QQ] 首次私聊 ${senderName}(${senderId})`);
    try {
      const greeting = `你好呀 ${senderName}！我是 ${account.botName}，很高兴认识你 😊`;
      await client.sendPrivateMsg(Number(senderId), buildReplySegments(greeting));
      persistMessageAsync(
        chatKey,
        toChatMessage({
          messageId: "bot-greeting",
          sender: account.botName,
          senderId: account.botQQ,
          content: greeting,
          role: "bot",
        }),
        account.store,
        log,
      );
    } catch (err) {
      log(`[QQ] 首次问候发送失败: ${String(err)}`);
    }
  }

  const debounceMs = adminCfg.global.dmDebounceMs ?? DM_DEBOUNCE_MS_DEFAULT;

  enqueueDmMessage(
    senderId,
    { senderName, text: messageText, timestamp: Date.now(), messageId },
    debounceMs,
    (accumulatedMessages) => {
      const lastMsg = accumulatedMessages[accumulatedMessages.length - 1]!;
      void dispatchDmReply({
        cfg,
        account,
        runtime,
        client,
        senderId,
        senderName: lastMsg.senderName,
        messageText: lastMsg.text,
        messageId: lastMsg.messageId,
        replyToId,
        mediaPayload,
        quotedContent,
        isFirst,
      });
    },
  );
}

// ── Dispatch private reply to openclaw agent ──

type DispatchDmReplyParams = {
  cfg: ClawdbotConfig;
  account: ResolvedQQAccount;
  runtime: RuntimeEnv;
  client: OneBotClient;
  senderId: string;
  senderName: string;
  messageText: string;
  messageId: number;
  replyToId?: string;
  mediaPayload?: AgentMediaPayload;
  quotedContent?: string;
  isFirst: boolean;
};

async function dispatchDmReply(params: DispatchDmReplyParams): Promise<void> {
  const {
    cfg, account, runtime, client,
    senderId, senderName, messageText, messageId,
    replyToId, quotedContent, isFirst,
  } = params;
  let { mediaPayload } = params;
  const log = runtime.log ?? console.log;
  const core = getQQRuntime();
  const chatKey = `private:${senderId}`;

  const abortController = startDmDispatch(senderId);
  const abortSignal = abortController.signal;

  try {
    const qqFrom = `qq:${senderId}`;
    const qqTo = `user:${senderId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "qq",
      accountId: account.accountId,
      peer: { kind: "direct", id: senderId },
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const messageBody = quotedContent
      ? `${quotedContent}\n${senderName}: ${messageText}`
      : `${senderName}: ${messageText}`;
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "QQ",
      from: senderId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: messageBody,
    });

    const userPersona = await loadPersona(senderId).catch(() => null);
    const botName = account.botName;
    const personaBlock = userPersona
      ? [
          `[该用户的专属 ${botName} 人格设定]`,
          userPersona.persona,
          ...(userPersona.nickname ? [`用户称呼: ${userPersona.nickname}`] : []),
          ...(userPersona.likoNickname ? [`${botName} 昵称: ${userPersona.likoNickname}`] : []),
        ].join("\n")
      : [
          `[${botName} 默认 QQ 风格]`,
          `你在 QQ 上是好友/搭子，不是助手。聊天风格口语化、随意，像朋友之间发消息。`,
          `直接、自然、有温度，不装客服腔，不说废话，但也不冷冰冰。`,
        ].join("\n");
    const envContext = [
      "[QQ 会话信息]",
      "平台: QQ（本条消息来自 QQ，不是小红书或其他平台。禁止对 QQ 消息使用小红书相关工具。）",
      "聊天类型: 私聊",
      `对方昵称: ${senderName}`,
      `对方QQ: ${senderId}`,
      ...(isFirst ? ["首次对话: 是"] : []),
      "",
      personaBlock,
    ].join("\n");

    let finalBody = body;
    let inboundHistory: Array<{ sender: string; body: string; timestamp?: number }> | undefined;
    let aggregatedMediaPayload = mediaPayload;
    try {
      const { messages: recentMsgs, summary } = await loadMessagesSinceLastBot(chatKey, 15);

      if (!aggregatedMediaPayload) {
        const now = Date.now();
        const MEDIA_WINDOW_MS = 60_000;
        const recentMediaPaths: string[] = [];
        for (let i = recentMsgs.length - 1; i >= 0; i--) {
          const m = recentMsgs[i]!;
          if (now - m.timestamp > MEDIA_WINDOW_MS) break;
          if (m.mediaUrls?.length) {
            recentMediaPaths.push(...m.mediaUrls);
          }
        }
        if (recentMediaPaths.length > 0) {
          aggregatedMediaPayload = buildAgentMediaPayload(
            recentMediaPaths.map((p) => ({ path: p })),
          );
          log(`[QQ] 从历史消息聚合 ${recentMediaPaths.length} 张图片`);
        }
      }

      const historyMessages = recentMsgs
        .filter((m) => String(m.messageId) !== String(messageId))
        .map((m) => {
          const mediaTag = m.mediaUrls?.length ? ` [图片×${m.mediaUrls.length}]` : "";
          return core.channel.reply.formatAgentEnvelope({
            channel: "QQ",
            from: m.senderId,
            timestamp: m.timestamp,
            body: `${m.sender}: ${m.content}${mediaTag}`,
            envelope: envelopeOptions,
          });
        });

      if (historyMessages.length > 0) {
        finalBody = [
          "[Chat messages since your last reply - for context]",
          ...historyMessages,
          "",
          "[Current message]",
          body,
        ].join("\n");
      }

      if (summary) {
        finalBody = `[历史摘要] ${summary}\n\n${finalBody}`;
      }

      inboundHistory = recentMsgs.map((m) => ({
        sender: m.senderId,
        body: `${m.sender}: ${m.content}`,
        timestamp: m.timestamp,
      }));
    } catch {
      // Fallback: proceed with just the current message
    }

    finalBody = `${envContext}\n\n${finalBody}`;

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: finalBody,
      BodyForAgent: messageBody,
      InboundHistory: inboundHistory,
      RawBody: messageText,
      CommandBody: messageText,
      From: qqFrom,
      To: qqTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      SenderName: senderName,
      SenderId: senderId,
      Provider: "qq" as const,
      Surface: "qq" as const,
      MessageSid: String(messageId),
      ReplyToId: replyToId,
      Timestamp: Date.now(),
      WasMentioned: false,
      OriginatingChannel: "qq" as const,
      OriginatingTo: qqTo,
      ...aggregatedMediaPayload,
    });

    const dmCollectedBotReplies: string[] = [];

    const { dispatcher, replyOptions, markDispatchIdle } =
      core.channel.reply.createReplyDispatcherWithTyping({
        humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
        deliver: async (payload, info) => {
          if (info.kind === "tool") return;
          if (abortSignal.aborted) return;

          // 发送前检查：用户是否在 agent 思考期间补充了新消息
          if (hasPendingDmMessages(senderId)) {
            log(`[QQ] 私聊 ${senderId} 发送前检测到新消息，放弃当前回复`);
            abortController.abort();
            return;
          }

          const rawText = stripThinkingTags(payload.text ?? "");
          const mediaUrls = collectMediaUrls(payload);
          if (!rawText.trim() && mediaUrls.length === 0) return;

          const plainText = stripMarkdown(rawText);
          dmCollectedBotReplies.push(plainText);
          const textChunks = splitLongText(plainText);

          try {
            for (let i = 0; i < textChunks.length; i++) {
              if (abortSignal.aborted) return;
              if (hasPendingDmMessages(senderId)) {
                log(`[QQ] 私聊 ${senderId} chunk 发送前检测到新消息，放弃剩余回复`);
                abortController.abort();
                return;
              }

              const isFirstChunk = i === 0;
              const isLast = i === textChunks.length - 1;
              const chunkMediaUrls = isLast ? mediaUrls : [];
              const segments = buildReplySegments(textChunks[i]!, undefined, undefined, chunkMediaUrls);
              const sendResult = await client.sendPrivateMsg(Number(senderId), segments);

              if (sendResult?.message_id) {
                try {
                  await client.getMsg(sendResult.message_id);
                } catch {
                  log(`[QQ] 私聊消息疑似被风控吞没 ${senderId} (msgId=${sendResult.message_id})`);
                  if (isFirstChunk) {
                    persistMessageAsync(
                      chatKey,
                      toChatMessage({
                        messageId: "bot-blocked",
                        sender: account.botName,
                        senderId: account.botQQ,
                        content: `[疑似被风控] ${plainText.slice(0, 200)}`,
                        role: "bot",
                      }),
                      account.store,
                      log,
                    );
                  }
                  return;
                }
              }

              if (!isLast) {
                await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
              }
            }

            if (textChunks.length === 0 && mediaUrls.length > 0) {
              const segments = buildReplySegments("", undefined, undefined, mediaUrls);
              await client.sendPrivateMsg(Number(senderId), segments);
            }

            persistMessageAsync(
              chatKey,
              toChatMessage({
                messageId: "bot",
                sender: account.botName,
                senderId: account.botQQ,
                content: plainText,
                role: "bot",
                mediaUrls,
              }),
              account.store,
              log,
            );
          } catch (err) {
            log(`[QQ] 私聊发送失败: ${String(err)}`);
            persistMessageAsync(
              chatKey,
              toChatMessage({
                messageId: "bot-failed",
                sender: account.botName,
                senderId: account.botQQ,
                content: `[发送失败] ${plainText.slice(0, 200)}`,
                role: "bot",
              }),
              account.store,
              log,
            );
            throw err;
          }
        },
        onError: async (error) => {
          log(`[QQ] 私聊回复错误: ${String(error)}`);
        },
        onIdle: async () => {
          if (abortSignal.aborted) return;
          const botReply = dmCollectedBotReplies.join("\n").trim();
          if (botReply) {
            void distillPersona({
              userId: senderId,
              senderName,
              botName: account.botName,
              userMessage: messageText,
              botReply,
              currentPersona: userPersona,
              config: account.passiveGate,
              log,
            });
          }
        },
        onCleanup: () => {},
      });

    log(`[QQ] 分发私聊到 Agent (session=${route.sessionKey}, user=${senderId})`);

    await core.channel.reply.withReplyDispatcher({
      dispatcher,
      onSettled: () => markDispatchIdle(),
      run: () =>
        core.channel.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg,
          dispatcher,
          replyOptions,
        }),
    });

    if (abortSignal.aborted) {
      log(`[QQ] 私聊 ${senderId} 回复已被打断（用户发送了新消息）`);
    }
  } finally {
    endDmDispatch(senderId);
  }
}

// ── Group message: mention gating + passive gate ──

type GroupMessageParams = HandleMessageParams & {
  groupId: number;
  senderId: string;
  senderName: string;
  messageText: string;
  messageId: number;
  replyToId?: string;
  wasMentioned: boolean;
  mediaPayload?: AgentMediaPayload;
  quotedContent?: string;
};

async function handleGroupMessage(params: GroupMessageParams): Promise<void> {
  const {
    cfg,
    account,
    runtime,
    client,
    chatHistories,
    groupId,
    senderId,
    senderName,
    messageText,
    messageId,
    replyToId,
    wasMentioned,
  } = params;
  const log = runtime.log ?? console.log;
  const groupIdStr = String(groupId);

  // Load admin config from MongoDB (runtime-mutable)
  const adminCfg = await loadAdminConfig();
  if (adminCfg.global.groupPolicy === "disabled") return;
  const groupAdmin = resolveGroupAdmin(adminCfg.global, adminCfg.groups, groupIdStr);
  if (!groupAdmin.enabled) return;

  const historyLimit = adminCfg.global.historyLimit ?? DEFAULT_HISTORY_LIMIT;

  log(
    `[QQ] 群消息 ${groupIdStr} ${senderName}(${senderId}): ${messageText.slice(0, 80)}${wasMentioned ? " [@Bot]" : ""}`,
  );

  const groupChatKey = `group:${groupIdStr}`;

  if (wasMentioned) {
    // Cancel any pending passive-gate debounce to prevent duplicate replies
    cancelPendingPassiveGate(groupIdStr);

    // Record @Bot message to history so passive gate sees the full conversation
    recordPendingHistoryEntryIfEnabled({
      historyMap: chatHistories,
      historyKey: groupIdStr,
      limit: historyLimit,
      entry: {
        sender: senderId,
        body: `${senderName}: ${messageText}`,
        timestamp: Date.now(),
        messageId: String(messageId),
      },
    });
    persistMessageAsync(
      groupChatKey,
      toChatMessage({
        messageId,
        sender: senderName,
        senderId,
        content: messageText,
        role: "user",
        mediaUrls: params.mediaPayload?.MediaUrls as string[] | undefined,
        quotedContent: params.quotedContent,
      }),
      account.store,
      log,
    );

    await dispatchGroupReply({
      cfg,
      account,
      runtime,
      client,
      chatHistories,
      groupId,
      senderId,
      senderName,
      messageText,
      messageId,
      replyToId,
      wasMentioned: true,
      historyLimit,
      mediaPayload: params.mediaPayload,
      quotedContent: params.quotedContent,
    });
    return;
  }

  // Not @Bot → record to history buffer, then evaluate passive gate
  recordPendingHistoryEntryIfEnabled({
    historyMap: chatHistories,
    historyKey: groupIdStr,
    limit: historyLimit,
    entry: {
      sender: senderId,
      body: `${senderName}: ${messageText}`,
      timestamp: Date.now(),
      messageId: String(messageId),
    },
  });
  persistMessageAsync(
    groupChatKey,
    toChatMessage({
      messageId,
      sender: senderName,
      senderId,
      content: messageText,
      role: "user",
      mediaUrls: params.mediaPayload?.MediaUrls as string[] | undefined,
      quotedContent: params.quotedContent,
    }),
    account.store,
    log,
  );

  // requireMention: if enabled and not mentioned, skip entirely (no passive gate)
  if (groupAdmin.requireMention) return;

  // Passive gate with debounce + interruptibility
  if (!groupAdmin.passiveGateEnabled) return;

  const gateConfig = {
    ...account.passiveGate,
    debounceMs: adminCfg.global.debounceMs ?? account.passiveGate.debounceMs,
  } as Required<typeof account.passiveGate>;

  const gateMessage: GateMessage = {
    senderName,
    text: messageText,
    timestamp: Date.now(),
    messageId,
  };

  enqueuePassiveMessage(
    groupIdStr,
    gateMessage,
    gateConfig.debounceMs,
    async (accumulatedMessages) => {
      // Debounce window closed, evaluate gate with all accumulated messages
      let groupName = groupIdStr;
      try {
        const info = await client.getGroupInfo(groupId);
        groupName = info.group_name || groupIdStr;
      } catch {
        // Use group ID as fallback
      }

      const recentHistory = chatHistories.get(groupIdStr) ?? [];
      const recentForGate: GateMessage[] = recentHistory
        .slice(-gateConfig.maxRecentMessages)
        .map((h) => ({
          senderName: h.body.split(":")[0] ?? "unknown",
          text: h.body,
          timestamp: h.timestamp ?? Date.now(),
          messageId: 0,
        }));

      const dispatchState = getGroupDispatchState(groupIdStr);
      const gateResult = await evaluatePassiveGate({
        config: gateConfig,
        botName: account.botName,
        groupName,
        recentMessages: [...recentForGate, ...accumulatedMessages],
        lastBotMessage: dispatchState.lastBotMessage,
      });

      log(
        `[QQ] 旁听门控 群${groupIdStr}: reply=${gateResult.shouldReply}, reason="${gateResult.reason}"`,
      );

      if (!gateResult.shouldReply) return;

      // Gate says reply → dispatch with last accumulated message as trigger
      const lastMsg = accumulatedMessages[accumulatedMessages.length - 1]!;
      const abortController = startGroupDispatch(groupIdStr);

      try {
        await dispatchGroupReply({
          cfg,
          account,
          runtime,
          client,
          chatHistories,
          groupId,
          senderId,
          senderName: lastMsg.senderName,
          messageText: lastMsg.text,
          messageId: lastMsg.messageId,
          replyToId: undefined,
          wasMentioned: false,
          historyLimit,
          abortSignal: abortController.signal,
        });
      } finally {
        endGroupDispatch(groupIdStr);
      }
    },
  );
}

// ── Dispatch group reply to openclaw agent ──

type DispatchGroupReplyParams = {
  cfg: ClawdbotConfig;
  account: ResolvedQQAccount;
  runtime: RuntimeEnv;
  client: OneBotClient;
  chatHistories: Map<string, HistoryEntry[]>;
  groupId: number;
  senderId: string;
  senderName: string;
  messageText: string;
  messageId: number;
  replyToId?: string;
  wasMentioned: boolean;
  historyLimit: number;
  abortSignal?: AbortSignal;
  mediaPayload?: AgentMediaPayload;
  quotedContent?: string;
};

async function dispatchGroupReply(params: DispatchGroupReplyParams): Promise<void> {
  const {
    cfg,
    account,
    runtime,
    client,
    chatHistories,
    groupId,
    senderId,
    senderName,
    messageText,
    messageId,
    replyToId,
    wasMentioned,
    historyLimit,
    abortSignal,
    mediaPayload,
    quotedContent,
  } = params;
  const log = runtime.log ?? console.log;
  const core = getQQRuntime();
  const groupIdStr = String(groupId);

  const qqFrom = `qq:${senderId}`;
  const qqTo = `group:${groupIdStr}`;

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "qq",
    accountId: account.accountId,
    peer: { kind: "group", id: groupIdStr },
  });

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const messageBody = quotedContent
    ? `${quotedContent}\n${senderName}: ${messageText}`
    : `${senderName}: ${messageText}`;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: `${groupIdStr}:${senderId}`,
    timestamp: new Date(),
    envelope: envelopeOptions,
    body: messageBody,
  });

  // Resolve group name for environment context
  let groupName = groupIdStr;
  try {
    const info = await client.getGroupInfo(groupId);
    groupName = info.group_name || groupIdStr;
  } catch {
    // Use group ID as fallback
  }

  const senderPersona = await loadPersona(senderId).catch(() => null);
  const grpBotName = account.botName;
  const personaBlock = senderPersona
    ? [
        `[当前发言人 ${senderName} 的专属 ${grpBotName} 人格设定]（仅限回复此人时使用，回复其他人时切换回对应人格或默认风格）`,
        senderPersona.persona,
        ...(senderPersona.nickname ? [`用户称呼: ${senderPersona.nickname}`] : []),
        ...(senderPersona.likoNickname ? [`${grpBotName} 昵称: ${senderPersona.likoNickname}`] : []),
      ].join("\n")
    : [
        `[当前发言人 ${senderName} 无专属人格，使用 ${grpBotName} 默认 QQ 风格]`,
        `你在 QQ 上是好友/搭子，不是助手。聊天风格口语化、随意，像朋友之间发消息。`,
        `直接、自然、有温度，不装客服腔，不说废话，但也不冷冰冰。`,
      ].join("\n");
  const envContext = [
    "[QQ 会话信息]",
    "平台: QQ（本条消息来自 QQ，不是小红书或其他平台。禁止对 QQ 消息使用小红书相关工具。）",
    "聊天类型: 群聊",
    `群名: ${groupName}`,
    `群号: ${groupIdStr}`,
    `当前发言人: ${senderName} (QQ: ${senderId})`,
    "",
    personaBlock,
  ].join("\n");

  // Build history context from MongoDB (authoritative source, no race conditions)
  let combinedBody = body;
  let inboundHistory: Array<{ sender: string; body: string; timestamp?: number }> | undefined;
  let aggregatedMediaPayload = mediaPayload;
  try {
    const { messages: recentMsgs, summary } = await loadMessagesSinceLastBot(
      `group:${groupIdStr}`,
      historyLimit,
    );

    // Aggregate images from recent history messages (within 60s window)
    // so that "send image" + "@Bot comment" split across two messages still works
    if (!aggregatedMediaPayload) {
      const now = Date.now();
      const MEDIA_WINDOW_MS = 60_000;
      const recentMediaPaths: string[] = [];
      for (let i = recentMsgs.length - 1; i >= 0; i--) {
        const m = recentMsgs[i]!;
        if (now - m.timestamp > MEDIA_WINDOW_MS) break;
        if (m.mediaUrls?.length) {
          recentMediaPaths.push(...m.mediaUrls);
        }
      }
      if (recentMediaPaths.length > 0) {
        aggregatedMediaPayload = buildAgentMediaPayload(
          recentMediaPaths.map((p) => ({ path: p })),
        );
        log(`[QQ] 从历史消息聚合 ${recentMediaPaths.length} 张图片`);
      }
    }

    const historyMessages = recentMsgs
      .filter((m) => String(m.messageId) !== String(messageId))
      .map((m) => {
        const mediaTag = m.mediaUrls?.length ? ` [图片×${m.mediaUrls.length}]` : "";
        return core.channel.reply.formatAgentEnvelope({
          channel: "QQ",
          from: `${groupIdStr}:${m.senderId}`,
          timestamp: m.timestamp,
          body: `${m.sender}: ${m.content}${mediaTag}`,
          envelope: envelopeOptions,
        });
      });

    if (historyMessages.length > 0) {
      combinedBody = [
        "[Chat messages since your last reply - for context]",
        ...historyMessages,
        "",
        "[Current message]",
        body,
      ].join("\n");
    }

    if (summary) {
      combinedBody = `[历史摘要] ${summary}\n\n${combinedBody}`;
    }

    inboundHistory = recentMsgs.map((m) => ({
      sender: m.senderId,
      body: `${m.sender}: ${m.content}`,
      timestamp: m.timestamp,
    }));
  } catch {
    // Fallback: proceed with just the current message
  }

  combinedBody = `${envContext}\n\n${combinedBody}`;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: combinedBody,
    BodyForAgent: messageBody,
    InboundHistory: inboundHistory,
    RawBody: messageText,
    CommandBody: messageText,
    From: qqFrom,
    To: qqTo,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    GroupSubject: groupName,
    SenderName: senderName,
    SenderId: senderId,
    Provider: "qq" as const,
    Surface: "qq" as const,
    MessageSid: String(messageId),
    ReplyToId: replyToId,
    Timestamp: Date.now(),
    WasMentioned: wasMentioned,
    OriginatingChannel: "qq" as const,
    OriginatingTo: qqTo,
    ...aggregatedMediaPayload,
  });

  const collectedBotReplies: string[] = [];

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
      deliver: async (payload, info) => {
        if (info.kind === "tool") return;
        if (abortSignal?.aborted) return;

        const rawText = stripThinkingTags(payload.text ?? "");
        const mediaUrls = collectMediaUrls(payload);
        if (!rawText.trim() && mediaUrls.length === 0) return;

        const plainText = stripMarkdown(rawText);
        collectedBotReplies.push(plainText);
        const textChunks = splitLongText(plainText);
        const groupChatKey = `group:${groupIdStr}`;

        try {
          for (let i = 0; i < textChunks.length; i++) {
            if (abortSignal?.aborted) return;
            const isFirst = i === 0;
            const isLast = i === textChunks.length - 1;
            const replyId = isFirst ? String(messageId) : undefined;
            const chunkMediaUrls = isLast ? mediaUrls : [];
            const segments = buildReplySegments(textChunks[i]!, undefined, replyId, chunkMediaUrls);
            const sendResult = await client.sendGroupMsg(groupId, segments);

            if (sendResult?.message_id) {
              try {
                await client.getMsg(sendResult.message_id);
              } catch {
                log(`[QQ] 群消息疑似被风控吞没 ${groupIdStr} (msgId=${sendResult.message_id})`);
                if (isFirst) {
                  persistMessageAsync(
                    groupChatKey,
                    toChatMessage({
                      messageId: "bot-blocked",
                      sender: account.botName,
                      senderId: account.botQQ,
                      content: `[疑似被风控] ${plainText.slice(0, 200)}`,
                      role: "bot",
                    }),
                    account.store,
                    log,
                  );
                }
                return;
              }
            }

            if (!isLast) {
              await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
            }
          }

          if (textChunks.length === 0 && mediaUrls.length > 0) {
            const segments = buildReplySegments("", undefined, String(messageId), mediaUrls);
            await client.sendGroupMsg(groupId, segments);
          }

          setGroupLastBotMessage(groupIdStr, plainText);
          recordPendingHistoryEntryIfEnabled({
            historyMap: chatHistories,
            historyKey: groupIdStr,
            limit: historyLimit,
            entry: {
              sender: account.botQQ,
              body: `${account.botName}: ${plainText}`,
              timestamp: Date.now(),
              messageId: "bot",
            },
          });
          persistMessageAsync(
            groupChatKey,
            toChatMessage({
              messageId: "bot",
              sender: account.botName,
              senderId: account.botQQ,
              content: plainText,
              role: "bot",
              mediaUrls,
            }),
            account.store,
            log,
          );
        } catch (err) {
          log(`[QQ] 群消息发送失败 ${groupIdStr}: ${String(err)}`);
          persistMessageAsync(
            groupChatKey,
            toChatMessage({
              messageId: "bot-failed",
              sender: account.botName,
              senderId: account.botQQ,
              content: `[发送失败] ${plainText.slice(0, 200)}`,
              role: "bot",
            }),
            account.store,
            log,
          );
          throw err;
        }
      },
      onError: async (error) => {
        log(`[QQ] 群回复错误 ${groupIdStr}: ${String(error)}`);
      },
      onIdle: async () => {
        const botReply = collectedBotReplies.join("\n").trim();
        if (botReply) {
          void distillPersona({
            userId: senderId,
            senderName,
            botName: account.botName,
            userMessage: messageText,
            botReply,
            currentPersona: senderPersona,
            config: account.passiveGate,
            log,
          });
        }
      },
      onCleanup: () => {},
    });

  log(`[QQ] 分发到 Agent (session=${route.sessionKey}, group=${groupIdStr})`);

  const { counts } = await core.channel.reply.withReplyDispatcher({
    dispatcher,
    onSettled: () => markDispatchIdle(),
    run: () =>
      core.channel.reply.dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions,
      }),
  });

  log(`[QQ] 群${groupIdStr} 回复完成 (replies=${counts.final})`);
}
