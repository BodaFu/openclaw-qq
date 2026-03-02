import type { OneBotSegment } from "../onebot/types.js";
import { getQQRuntime } from "../runtime.js";

export type QQMediaInfo = {
  path: string;
  contentType?: string | null;
};

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function guessContentType(url: string): string {
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "image/jpeg";
}

/**
 * Download images from OneBot message segments and save to openclaw media store.
 * Returns a list of { path, contentType } suitable for buildAgentMediaPayload.
 */
export async function resolveQQMediaList(params: {
  segments: OneBotSegment[];
  maxImages?: number;
  maxBytes?: number;
  log?: (msg: string) => void;
}): Promise<QQMediaInfo[]> {
  const { segments, maxImages = 8, maxBytes = 30 * 1024 * 1024, log } = params;
  const imageSegments = segments.filter((s) => s.type === "image");
  if (imageSegments.length === 0) return [];

  const core = getQQRuntime();
  const results: QQMediaInfo[] = [];

  for (const seg of imageSegments.slice(0, maxImages)) {
    const d = seg.data as Record<string, string>;
    const url = d.url ?? d.file ?? "";
    if (!url || !url.startsWith("http")) continue;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        log?.(`[QQ] 图片下载失败 HTTP ${response.status}: ${url.slice(0, 80)}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const headerContentType = response.headers.get("content-type") ?? undefined;
      const contentType = headerContentType?.startsWith("image/")
        ? headerContentType
        : guessContentType(url);

      const saved = await core.channel.media.saveMediaBuffer(
        buffer,
        contentType,
        "inbound",
        maxBytes,
      );

      results.push({ path: saved.path, contentType: saved.contentType });
      log?.(`[QQ] 图片已保存: ${saved.path} (${(buffer.byteLength / 1024).toFixed(1)}KB)`);
    } catch (err) {
      log?.(`[QQ] 图片下载失败: ${String(err).slice(0, 120)}`);
    }
  }

  return results;
}
