import type { PassiveGateConfig } from "../types.js";

export type GateMessage = {
  senderName: string;
  text: string;
  timestamp: number;
  messageId: number;
};

export type PassiveGateResult = {
  shouldReply: boolean;
  reason: string;
};

const SYSTEM_PROMPT = `你是一个消息过滤器，负责判断 AI 助手是否需要回复当前群聊消息。

AI 助手被 @时必须回复（但这种情况不会到达你这里）。
当没有被 @时，请根据以下规则判断：

【必须回复】
1. 有人直接叫 AI 助手的名字或昵称
2. AI 助手刚刚回复过，后续消息是在延续那个话题（即使没叫名字）
3. 有人回复/引用了 AI 助手之前的消息
4. 有人在讨论 AI 助手本身（功能、表现、消耗、bug 等）

【倾向回复】
5. 有人提出问题，AI 助手能提供有价值的帮助
6. AI 助手之前参与过的话题出现了新进展（如之前讨论伊朗局势，现在有新消息）
7. 有人在评论 AI 助手刚才的回复内容（即使是间接的）
8. 群里只有少数人在聊，且话题和 AI 助手相关

【不应该回复】
1. 群友之间明确与 AI 助手无关的闲聊
2. 纯表情、纯图片、刷屏/重复消息
3. 群管理消息（进群、改名等）
4. 明确 @了其他人（非 AI 助手）的定向消息

【重要原则】
- AI 助手是群里的活跃成员，应该适度参与讨论，不要过于沉默
- 如果 AI 助手最近 5 分钟内回复过，对后续消息应该更倾向于回复
- 拿不准时，如果消息和 AI 助手最近的话题相关，倾向回复

你的输出必须严格是一个 JSON 对象，格式为 {"reply": true或false, "reason": "简短原因"}。不要输出任何其他内容。`;

function buildUserMessage(params: {
  botName: string;
  groupName: string;
  recentMessages: GateMessage[];
  lastBotMessage?: string;
}): string {
  const { botName, groupName, recentMessages, lastBotMessage } = params;
  const msgLines = recentMessages
    .map((m) => `[${m.senderName}] ${m.text}`)
    .join("\n");

  let prompt = `AI 助手名称: ${botName}\n群名: ${groupName}`;
  if (lastBotMessage) {
    prompt += `\n\n⚠️ ${botName} 刚刚在这个群回复过: "${lastBotMessage.slice(0, 200)}"`;
    prompt += `\n（如果后续消息是在回应 ${botName} 的这条回复，应该继续回复）`;
  }
  prompt += `\n\n最近的群消息:\n${msgLines}`;
  return prompt;
}

/**
 * Robustly extract {"reply": bool, "reason": string} from LLM output.
 * Handles: null content, truncated JSON, markdown wrapping, reasoning models
 * that put the answer in reasoning_content instead of content.
 */
function parseGateResponse(
  content: string | null | undefined,
  reasoning: string | null | undefined,
): PassiveGateResult | null {
  // Try each source in priority order: content first, then reasoning
  for (const raw of [content, reasoning]) {
    if (!raw) continue;
    const text = raw.trim();

    // Strategy 1: find a complete {"reply": ..., "reason": ...} JSON object
    const fullMatch = text.match(/\{\s*"reply"\s*:\s*(true|false)\s*,\s*"reason"\s*:\s*"([^"]*)"\s*\}/);
    if (fullMatch) {
      return {
        shouldReply: fullMatch[1] === "true",
        reason: fullMatch[2] || "no reason",
      };
    }

    // Strategy 2: find any JSON block (may be wrapped in markdown ```)
    const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1]) as { reply?: boolean; reason?: string };
        if (typeof parsed.reply === "boolean") {
          return { shouldReply: parsed.reply, reason: parsed.reason ?? "no reason" };
        }
      } catch { /* continue */ }
    }

    // Strategy 3: find any JSON-like object with "reply" key
    const looseMatch = text.match(/\{[^{}]*"reply"[^{}]*\}/);
    if (looseMatch) {
      try {
        const parsed = JSON.parse(looseMatch[0]) as { reply?: boolean; reason?: string };
        if (typeof parsed.reply === "boolean") {
          return { shouldReply: parsed.reply, reason: parsed.reason ?? "no reason" };
        }
      } catch { /* continue */ }
    }

    // Strategy 4: truncated content — look for "reply": true/false without complete JSON
    const partialMatch = text.match(/"reply"\s*:\s*(true|false)/);
    if (partialMatch) {
      const reasonMatch = text.match(/"reason"\s*:\s*"([^"]*)"/);
      return {
        shouldReply: partialMatch[1] === "true",
        reason: reasonMatch?.[1] ?? "parsed from truncated response",
      };
    }
  }

  return null;
}

/**
 * Heuristic fallback when the gate API is unreachable.
 * Returns true if the message text mentions the bot by name.
 */
function heuristicShouldReply(botName: string, recentMessages: GateMessage[]): PassiveGateResult | null {
  const lastMsg = recentMessages[recentMessages.length - 1];
  if (!lastMsg) return null;
  const lower = lastMsg.text.toLowerCase();
  if (lower.includes(botName.toLowerCase())) {
    return { shouldReply: true, reason: `fallback: 消息中提及了 ${botName}` };
  }
  return null;
}

/**
 * Call LLM to decide if the bot should reply to a group message.
 * Falls back to heuristic name-matching when the API is unreachable.
 */
export async function evaluatePassiveGate(params: {
  config: Required<PassiveGateConfig>;
  botName: string;
  groupName: string;
  recentMessages: GateMessage[];
  lastBotMessage?: string;
}): Promise<PassiveGateResult> {
  const { config, botName, groupName, recentMessages, lastBotMessage } = params;

  if (!config.enabled || !config.apiKey) {
    return { shouldReply: false, reason: "gate disabled" };
  }

  const userMessage = buildUserMessage({ botName, groupName, recentMessages, lastBotMessage });

  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: config.temperature,
        max_tokens: 16384,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const fallback = heuristicShouldReply(botName, recentMessages);
      if (fallback) return fallback;
      return { shouldReply: false, reason: `gate API error: ${response.status} ${text.slice(0, 100)}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
        };
      }>;
    };

    const msg = data.choices?.[0]?.message;
    const gateResult = parseGateResponse(msg?.content, msg?.reasoning_content ?? msg?.reasoning);
    if (gateResult) return gateResult;

    const preview = (msg?.content ?? msg?.reasoning_content ?? msg?.reasoning ?? "").slice(0, 80);
    return { shouldReply: false, reason: `gate: unparseable response: ${preview}` };
  } catch (err) {
    const fallback = heuristicShouldReply(botName, recentMessages);
    if (fallback) return fallback;
    return { shouldReply: false, reason: `gate error: ${String(err).slice(0, 100)}` };
  }
}

/**
 * Per-group dispatch state for debounce and interruptibility.
 */
export type GroupDispatchState = {
  pendingMessages: GateMessage[];
  debounceTimer: NodeJS.Timeout | null;
  dispatchAbort: AbortController | null;
  dispatching: boolean;
  lastBotMessage?: string;
};

const groupStates = new Map<string, GroupDispatchState>();

export function getGroupDispatchState(groupId: string): GroupDispatchState {
  let state = groupStates.get(groupId);
  if (!state) {
    state = {
      pendingMessages: [],
      debounceTimer: null,
      dispatchAbort: null,
      dispatching: false,
    };
    groupStates.set(groupId, state);
  }
  return state;
}

export function setGroupLastBotMessage(groupId: string, text: string): void {
  const state = getGroupDispatchState(groupId);
  state.lastBotMessage = text;
}

/**
 * Enqueue a passive message and return a promise that resolves when the debounce
 * window closes with the accumulated messages (or null if gate decides no reply).
 *
 * Implements the "interruptibility" pattern:
 * - New messages reset the debounce timer
 * - If a dispatch is in-flight, new messages abort it and re-queue
 */
export function enqueuePassiveMessage(
  groupId: string,
  message: GateMessage,
  debounceMs: number,
  onReady: (messages: GateMessage[]) => void,
): void {
  const state = getGroupDispatchState(groupId);
  state.pendingMessages.push(message);

  // If dispatch is currently in-flight, abort it (interruptibility)
  if (state.dispatching && state.dispatchAbort) {
    state.dispatchAbort.abort();
    state.dispatchAbort = null;
    state.dispatching = false;
  }

  // Reset debounce timer
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    const messages = [...state.pendingMessages];
    state.pendingMessages = [];
    if (messages.length > 0) {
      onReady(messages);
    }
  }, debounceMs);
}

/**
 * Create an AbortController for the current dispatch and mark as dispatching.
 */
export function startGroupDispatch(groupId: string): AbortController {
  const state = getGroupDispatchState(groupId);
  const abort = new AbortController();
  state.dispatchAbort = abort;
  state.dispatching = true;
  return abort;
}

/**
 * Mark dispatch as complete.
 */
export function endGroupDispatch(groupId: string): void {
  const state = getGroupDispatchState(groupId);
  state.dispatchAbort = null;
  state.dispatching = false;
}

/**
 * Cancel any pending passive-gate debounce and abort in-flight dispatch.
 * Called when an @Bot message triggers a direct reply, to prevent the
 * passive-gate from also dispatching a duplicate reply.
 */
export function cancelPendingPassiveGate(groupId: string): void {
  const state = groupStates.get(groupId);
  if (!state) return;

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  state.pendingMessages = [];

  if (state.dispatching && state.dispatchAbort) {
    state.dispatchAbort.abort();
    state.dispatchAbort = null;
    state.dispatching = false;
  }
}
