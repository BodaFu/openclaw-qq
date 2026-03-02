import { chatMessages, chatArchives } from "./connection.js";
import type {
  ChatMessage,
  ChatDocument,
  ChatStoreConfig,
  CompactSummary,
} from "./types.js";

const CHARS_PER_TOKEN = 1.5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    let text = `${m.sender}: ${m.content}`;
    if (m.quotedContent) text += ` ${m.quotedContent}`;
    return sum + estimateTokens(text);
  }, 0);
}

export async function appendMessage(
  chatKey: string,
  message: ChatMessage,
  config: ChatStoreConfig,
): Promise<void> {
  const tokenDelta = estimateTokens(`${message.sender}: ${message.content}`);

  const result = await chatMessages().updateOne(
    { chatKey },
    {
      $push: { messages: message },
      $inc: { tokenCount: tokenDelta },
      $set: { updatedAt: new Date() },
      $setOnInsert: { compactCount: 0 },
    },
    { upsert: true },
  );

  if (result.acknowledged) {
    const doc = await chatMessages().findOne({ chatKey });
    if (doc && doc.tokenCount > config.tokenThreshold) {
      await performCompact(chatKey, config);
    }
  }
}

export async function getActiveMessages(
  chatKey: string,
): Promise<{ messages: ChatMessage[]; summary?: string }> {
  const doc = await chatMessages().findOne({ chatKey });
  if (!doc) return { messages: [] };
  return {
    messages: doc.messages,
    summary: doc.latestCompact?.summary,
  };
}

export async function isFirstConversation(chatKey: string): Promise<boolean> {
  const doc = await chatMessages().findOne(
    { chatKey },
    { projection: { _id: 1 } },
  );
  if (doc) return false;
  const archive = await chatArchives().findOne(
    { chatKey },
    { projection: { _id: 1 } },
  );
  return !archive;
}

export async function loadRecentMessages(
  chatKey: string,
  limit: number,
): Promise<ChatMessage[]> {
  const doc = await chatMessages().findOne({ chatKey });
  if (!doc) return [];
  return doc.messages.slice(-limit);
}

/**
 * 从 MongoDB 加载上次 bot 回复之后的所有消息。
 * 用于构建 agent 上下文，确保不遗漏 dispatch 期间到达的消息。
 * 如果没有 bot 回复记录，返回最近 limit 条消息。
 */
export async function loadMessagesSinceLastBot(
  chatKey: string,
  limit: number,
): Promise<{ messages: ChatMessage[]; summary?: string }> {
  const doc = await chatMessages().findOne({ chatKey });
  if (!doc) return { messages: [] };

  let lastBotIdx = -1;
  for (let i = doc.messages.length - 1; i >= 0; i--) {
    if (doc.messages[i].role === "bot") {
      lastBotIdx = i;
      break;
    }
  }

  const sinceMessages =
    lastBotIdx >= 0
      ? doc.messages.slice(lastBotIdx + 1)
      : doc.messages.slice(-limit);

  return {
    messages: sinceMessages,
    summary: doc.latestCompact?.summary,
  };
}

async function performCompact(
  chatKey: string,
  config: ChatStoreConfig,
): Promise<void> {
  const doc = await chatMessages().findOne({ chatKey });
  if (!doc || doc.messages.length <= config.compactKeepRecent) return;

  const keepCount = config.compactKeepRecent;
  const toArchive = doc.messages.slice(0, -keepCount);
  const toKeep = doc.messages.slice(-keepCount);

  let summary: string;
  try {
    summary = await generateCompactSummary(toArchive, doc.latestCompact?.summary, config);
  } catch {
    summary = buildFallbackSummary(toArchive, doc.latestCompact?.summary);
  }

  const compactIndex = doc.compactCount + 1;

  await chatArchives().insertOne({
    chatKey,
    compactIndex,
    messages: toArchive,
    summary,
    archivedAt: new Date(),
  });

  const latestCompact: CompactSummary = {
    summary,
    archivedAt: new Date(),
    messageCount: toArchive.length,
  };

  await chatMessages().updateOne(
    { chatKey },
    {
      $set: {
        messages: toKeep,
        tokenCount: estimateMessagesTokens(toKeep),
        compactCount: compactIndex,
        latestCompact,
        updatedAt: new Date(),
      },
    },
  );
}

async function generateCompactSummary(
  messages: ChatMessage[],
  previousSummary: string | undefined,
  config: ChatStoreConfig,
): Promise<string> {
  const msgLines = messages
    .map((m) => `[${m.sender}] ${m.content}`)
    .join("\n");

  let prompt = "请将以下聊天记录压缩为一段简洁的摘要，保留关键信息（人物、事件、结论、待办）。";
  prompt += "\n摘要应该是第三人称叙述，不超过 500 字。";
  if (previousSummary) {
    prompt += `\n\n之前的摘要（供参考上下文）：\n${previousSummary}`;
  }
  prompt += `\n\n需要压缩的聊天记录：\n${msgLines}`;

  const response = await fetch(config.compactApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.compactApiKey}`,
    },
    body: JSON.stringify({
      model: config.compactModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Compact LLM error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty compact summary from LLM");
  return content;
}

function buildFallbackSummary(
  messages: ChatMessage[],
  previousSummary: string | undefined,
): string {
  const parts: string[] = [];
  if (previousSummary) parts.push(`[之前的摘要] ${previousSummary}`);
  const senders = [...new Set(messages.map((m) => m.sender))];
  const firstTime = messages[0]?.timestamp;
  const lastTime = messages[messages.length - 1]?.timestamp;
  parts.push(
    `[截断] ${messages.length} 条消息被截断（参与者: ${senders.join(", ")}，` +
      `时间: ${firstTime ? new Date(firstTime).toLocaleString("zh-CN") : "?"} ~ ` +
      `${lastTime ? new Date(lastTime).toLocaleString("zh-CN") : "?"}）`,
  );
  return parts.join("\n");
}
