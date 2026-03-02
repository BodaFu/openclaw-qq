import type { OneBotSegment } from "../onebot/types.js";

export type QQMentionTarget = {
  qq: string;
  name?: string;
};

/**
 * Check if the bot was mentioned (@) in the message segments.
 */
export function isBotMentioned(segments: OneBotSegment[], botQQ: string): boolean {
  return segments.some(
    (seg) => seg.type === "at" && seg.data.qq === botQQ,
  );
}

/**
 * Check if the bot's name appears in the text content (without @).
 */
export function isBotNamedInText(text: string, botName: string): boolean {
  if (!botName) return false;
  const lower = text.toLowerCase();
  const name = botName.toLowerCase();
  return lower.includes(name);
}

/**
 * Extract mention targets (users who were @'d, excluding the bot).
 */
export function extractMentionTargets(
  segments: OneBotSegment[],
  botQQ: string,
  resolveName?: (qq: string) => string | undefined,
): QQMentionTarget[] {
  return segments
    .filter(
      (seg) =>
        seg.type === "at" &&
        seg.data.qq !== botQQ &&
        seg.data.qq !== "all",
    )
    .map((seg) => ({
      qq: (seg.data as { qq: string }).qq,
      name: resolveName?.((seg.data as { qq: string }).qq),
    }));
}

/**
 * Strip bot @mention from text to get clean message content.
 */
export function stripBotMention(text: string, botName: string): string {
  if (!botName) return text;
  return text.replace(new RegExp(`@${botName}\\s*`, "gi"), "").trim();
}

/**
 * Remove bot @mention segments from the message array,
 * so the text passed to the agent is clean (e.g. "在吗" instead of "@Bot 在吗").
 */
export function stripBotMentionSegments(segments: OneBotSegment[], botQQ: string): OneBotSegment[] {
  const result: OneBotSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.type === "at" && seg.data.qq === botQQ) {
      // Also skip trailing whitespace text segment (e.g. " " after @mention)
      const next = segments[i + 1];
      if (next?.type === "text") {
        const text = (next.data as { text: string }).text;
        if (/^\s+$/.test(text)) {
          i++; // skip trailing space
          continue;
        }
      }
      continue;
    }
    result.push(seg);
  }
  return result;
}
