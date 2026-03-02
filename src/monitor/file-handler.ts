import { readFile } from "fs/promises";
import { recordPendingHistoryEntryIfEnabled, type HistoryEntry } from "openclaw/plugin-sdk";
import type { OneBotClient } from "../onebot/client.js";
import type { OneBotNoticeEvent } from "../onebot/types.js";
import type { ResolvedQQAccount } from "../types.js";
import { appendMessage as appendToStore } from "../store/chat-store.js";
import type { ChatMessage, ChatStoreConfig } from "../store/types.js";
import { resolveMemberDisplayName, resolveUserDisplayName, getGroupMemberInfo } from "../utils/member-cache.js";

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".csv", ".xml", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".log",
  ".ts", ".js", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
  ".html", ".css", ".sql", ".sh", ".bash", ".zsh",
]);

const MAX_FILE_SIZE = 512 * 1024; // 512KB
const MAX_CONTENT_CHARS = 8000;

function isTextFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return [...TEXT_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

async function readFileContent(
  client: OneBotClient,
  fileId: string,
  fileName: string,
  log: (msg: string) => void,
): Promise<string | null> {
  if (!isTextFile(fileName)) return null;

  try {
    const fileInfo = await client.getFile(fileId);

    if (fileInfo.file_size && Number(fileInfo.file_size) > MAX_FILE_SIZE) {
      log(`[QQ] 文件过大，跳过读取: ${fileName} (${fileInfo.file_size} bytes)`);
      return null;
    }

    // NapCat returns a local file path or a URL
    const filePath = fileInfo.file || fileInfo.url;
    if (!filePath) return null;

    let content: string;
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      const resp = await fetch(filePath, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return null;
      content = await resp.text();
    } else {
      const buf = await readFile(filePath, "utf-8");
      content = buf;
    }

    if (content.length > MAX_CONTENT_CHARS) {
      content = content.slice(0, MAX_CONTENT_CHARS) + `\n\n[... 文件内容过长，已截断，共 ${content.length} 字符]`;
    }

    return content;
  } catch (err) {
    log(`[QQ] 文件读取失败 (${fileName}): ${String(err).slice(0, 150)}`);
    return null;
  }
}

export type HandleFileUploadParams = {
  event: OneBotNoticeEvent;
  client: OneBotClient;
  account: ResolvedQQAccount;
  chatHistories: Map<string, HistoryEntry[]>;
  historyLimit: number;
  log: (msg: string) => void;
};

export async function handleGroupFileUpload(params: HandleFileUploadParams): Promise<void> {
  const { event, client, account, chatHistories, historyLimit, log } = params;

  const groupId = event.group_id;
  const userId = event.user_id;
  const file = event.file as { id: string; name: string; size?: number } | undefined;
  if (!groupId || !userId || !file?.id || !file?.name) return;

  const groupIdStr = String(groupId);
  const senderIdStr = String(userId);
  const chatKey = `group:${groupIdStr}`;

  let senderName: string;
  try {
    const memberInfo = await getGroupMemberInfo(client, groupId, userId);
    senderName = resolveMemberDisplayName(memberInfo) ?? "";
    if (!senderName) {
      senderName = await resolveUserDisplayName(client, userId);
    }
  } catch {
    senderName = `QQ用户${userId}`;
  }

  const fileContent = await readFileContent(client, file.id, file.name, log);

  let messageContent: string;
  if (fileContent) {
    messageContent = `[文件: ${file.name}]\n\n${fileContent}`;
    log(`[QQ] 群文件已读取: ${file.name} (${fileContent.length} 字符)`);
  } else {
    messageContent = `[文件: ${file.name}]`;
  }

  const chatMsg: ChatMessage = {
    messageId: `file-${file.id}`,
    sender: senderName,
    senderId: senderIdStr,
    content: messageContent,
    timestamp: Date.now(),
    role: "user",
  };

  recordPendingHistoryEntryIfEnabled({
    historyMap: chatHistories,
    historyKey: groupIdStr,
    limit: historyLimit,
    entry: {
      sender: senderIdStr,
      body: `${senderName}: ${messageContent}`,
      timestamp: Date.now(),
      messageId: `file-${file.id}`,
    },
  });

  try {
    await appendToStore(chatKey, chatMsg, account.store);
  } catch (err) {
    log(`[QQ] 文件消息写入 MongoDB 失败: ${String(err).slice(0, 100)}`);
  }
}
