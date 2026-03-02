import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getQQRuntime } from "./runtime.js";
import { getActiveClient } from "./monitor/client-ref.js";
import { buildReplySegments } from "./utils/message-parser.js";
import { stripMarkdown } from "./utils/text-format.js";

function parseTarget(to: string): { type: "user" | "group"; id: number } | null {
  const userMatch = to.match(/^user:(\d+)$/);
  if (userMatch) return { type: "user", id: Number(userMatch[1]) };
  const groupMatch = to.match(/^group:(\d+)$/);
  if (groupMatch) return { type: "group", id: Number(groupMatch[1]) };
  const numMatch = to.match(/^(\d+)$/);
  if (numMatch) return { type: "user", id: Number(numMatch[1]) };
  return null;
}

export const qqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getQQRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 400,

  sendText: async ({ to, text }) => {
    const client = getActiveClient();
    if (!client || !to || !text?.trim()) return { channel: "qq", messageId: "" };

    const target = parseTarget(to);
    if (!target) return { channel: "qq", messageId: "" };

    const plainText = stripMarkdown(text);
    const segments = buildReplySegments(plainText);
    if (target.type === "group") {
      await client.sendGroupMsg(target.id, segments);
    } else {
      await client.sendPrivateMsg(target.id, segments);
    }
    return { channel: "qq", messageId: "" };
  },

  sendMedia: async ({ to, text, mediaUrl }) => {
    const client = getActiveClient();
    if (!client || !to) return { channel: "qq", messageId: "" };

    const target = parseTarget(to);
    if (!target) return { channel: "qq", messageId: "" };

    const imageUrls = mediaUrl ? [mediaUrl] : [];
    const plainText = stripMarkdown(text ?? "");
    const segments = buildReplySegments(plainText, undefined, undefined, imageUrls);
    if (target.type === "group") {
      await client.sendGroupMsg(target.id, segments);
    } else {
      await client.sendPrivateMsg(target.id, segments);
    }
    return { channel: "qq", messageId: "" };
  },
};
