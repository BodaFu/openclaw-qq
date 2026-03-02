import type { OneBotSegment } from "../onebot/types.js";

/**
 * Convert OneBot message segments to plain text.
 * At segments become @mentions, images become placeholders, etc.
 */
export function segmentsToText(
  segments: OneBotSegment[],
  resolveName?: (qq: string) => string | undefined,
): string {
  const parts: string[] = [];
  for (const seg of segments) {
    const d = seg.data as Record<string, string>;
    switch (seg.type) {
      case "text":
        parts.push(d.text ?? "");
        break;
      case "at": {
        const qq = d.qq ?? "";
        if (qq === "all") {
          parts.push("@全体成员");
        } else {
          const name = resolveName?.(qq);
          parts.push(name ? `@${name}` : `@${qq}`);
        }
        break;
      }
      case "face":
        parts.push("[表情]");
        break;
      case "image":
        parts.push(d.summary ?? "[图片]");
        break;
      case "record":
        parts.push("[语音]");
        break;
      case "video":
        parts.push("[视频]");
        break;
      case "reply":
        break;
      case "forward":
        parts.push("[合并转发]");
        break;
      case "file":
        parts.push(`[文件: ${d.name ?? d.file ?? "unknown"}]`);
        break;
      case "json":
        parts.push("[卡片消息]");
        break;
      default:
        parts.push(`[${seg.type}]`);
    }
  }
  return parts.join("").trim();
}

/**
 * Build OneBot message segments from plain text.
 * Supports embedding @mentions via `[at:qq]` syntax if needed.
 */
export function textToSegments(text: string): OneBotSegment[] {
  return [{ type: "text", data: { text } }];
}

/**
 * Build segments with optional @mentions prepended and image URLs appended.
 */
export function buildReplySegments(
  text: string,
  mentionQQs?: string[],
  replyToMessageId?: string,
  imageUrls?: string[],
): OneBotSegment[] {
  const segments: OneBotSegment[] = [];

  if (replyToMessageId) {
    segments.push({ type: "reply", data: { id: replyToMessageId } });
  }

  if (mentionQQs?.length) {
    for (const qq of mentionQQs) {
      segments.push({ type: "at", data: { qq } });
      segments.push({ type: "text", data: { text: " " } });
    }
  }

  if (text.trim()) {
    segments.push({ type: "text", data: { text } });
  }

  if (imageUrls?.length) {
    for (const url of imageUrls) {
      segments.push({ type: "image", data: { file: url } });
    }
  }

  return segments;
}

/**
 * Extract image URLs from message segments.
 */
export function extractImageUrls(segments: OneBotSegment[]): string[] {
  return segments
    .filter((s) => s.type === "image")
    .map((s) => {
      const d = s.data as Record<string, string>;
      return d.url ?? d.file ?? "";
    })
    .filter((u) => u.length > 0);
}

/**
 * Extract the reply message ID if the message is a reply.
 */
export function extractReplyId(segments: OneBotSegment[]): string | undefined {
  const reply = segments.find((s) => s.type === "reply");
  return reply ? (reply.data as { id: string }).id : undefined;
}
