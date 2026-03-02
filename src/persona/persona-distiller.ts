import type { PassiveGateConfig } from "../types.js";
import type { UserPersona } from "../store/types.js";
import { savePersona } from "../store/persona-store.js";

function buildSystemPrompt(botName: string): string {
  return `你是一个人格分析器。你的任务是分析一轮对话，判断用户是否对 AI 助手（${botName}）的人格/风格/称呼提出了新的要求或隐含偏好。

分析维度：
1. 用户是否明确要求改变 ${botName} 的人格/角色（如"你以后傲娇一点""做我的猫娘""叫我哥哥"）
2. 用户是否隐式表达了偏好（如纠正称呼、嫌 ${botName} 太正经/太随意/太长）
3. 用户是否给 ${botName} 起了昵称，或要求 ${botName} 用特定方式称呼自己
4. 用户是否表达了角色扮演的意愿（如设定关系、场景、性格特征）

如果检测到变更信号，输出完整的更新后人格描述（融合已有人格 + 新变更）。
如果没有变更信号，直接返回 unchanged。

输出严格 JSON，不要输出其他内容：
- 无变更：{"changed":false}
- 有变更：{"changed":true,"persona":"完整人格描述（不超过500字）","reason":"变更原因","nickname":"用户希望被叫的称呼（可选）","botNickname":"用户给${botName}起的昵称（可选）","traits":["特征标签"]}

注意：
- persona 字段必须是完整描述，不是增量。如果用户已有人格，在其基础上融合新变更。
- 不要过度解读。普通闲聊不算人格变更。
- 用户说"好的""行""嗯"之类的不算变更。
- 只关注人格/风格/称呼相关的信号，忽略其他内容。`;
}

type DistillParams = {
  userId: string;
  senderName: string;
  botName: string;
  userMessage: string;
  botReply: string;
  currentPersona: UserPersona | null;
  config: Required<PassiveGateConfig>;
  log: (...args: unknown[]) => void;
};

type DistillResult = {
  changed: boolean;
  persona?: string;
  reason?: string;
  nickname?: string;
  botNickname?: string;
  traits?: string[];
};

function buildUserMessage(params: DistillParams): string {
  const parts: string[] = [];

  if (params.currentPersona) {
    parts.push(`[当前人格设定]`);
    parts.push(params.currentPersona.persona);
    if (params.currentPersona.nickname) {
      parts.push(`用户称呼: ${params.currentPersona.nickname}`);
    }
    if (params.currentPersona.likoNickname) {
      parts.push(`${params.botName} 昵称: ${params.currentPersona.likoNickname}`);
    }
  } else {
    parts.push(`[当前人格设定] 无（使用默认风格）`);
  }

  parts.push("");
  parts.push(`[本轮对话]`);
  parts.push(`${params.senderName}: ${params.userMessage}`);
  parts.push(`${params.botName}: ${params.botReply}`);

  return parts.join("\n");
}

function parseDistillResponse(
  content: string | null | undefined,
  reasoning: string | null | undefined,
): DistillResult | null {
  for (const raw of [content, reasoning]) {
    if (!raw) continue;
    const text = raw.trim();

    // Try to find JSON object with "changed" key
    const jsonMatch = text.match(/\{[^{}]*"changed"[^{}]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as DistillResult;
        if (typeof parsed.changed === "boolean") {
          return parsed;
        }
      } catch { /* continue */ }
    }

    // Try markdown-wrapped JSON
    const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (blockMatch) {
      try {
        const parsed = JSON.parse(blockMatch[1]) as DistillResult;
        if (typeof parsed.changed === "boolean") {
          return parsed;
        }
      } catch { /* continue */ }
    }
  }
  return null;
}

export async function distillPersona(params: DistillParams): Promise<void> {
  const { userId, config, log } = params;

  if (!config.apiKey || !config.apiUrl) {
    return;
  }

  // Skip very short messages that are unlikely to contain persona signals
  if (params.userMessage.length < 4) {
    return;
  }

  const userMessage = buildUserMessage(params);

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
          { role: "system", content: buildSystemPrompt(params.botName) },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!response.ok) {
      log(`[qq/persona-distill] API error: ${response.status}`);
      return;
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
    const result = parseDistillResponse(msg?.content, msg?.reasoning_content ?? msg?.reasoning);

    if (!result || !result.changed || !result.persona) {
      return;
    }

    log(`[qq/persona-distill] 检测到人格变更 userId=${userId} reason=${result.reason}`);

    await savePersona(userId, {
      persona: result.persona,
      nickname: result.nickname,
      likoNickname: result.botNickname,
      traits: result.traits,
      reason: result.reason ?? "auto-distill",
    });

    log(`[qq/persona-distill] 人格已更新 userId=${userId}`);
  } catch (err) {
    log(`[qq/persona-distill] error: ${String(err)}`);
  }
}
