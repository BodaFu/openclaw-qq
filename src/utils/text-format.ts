/**
 * QQ 文本格式化工具。
 *
 * QQ 不支持 markdown 渲染，所有格式符号会原样显示为纯文本，
 * 这里将 LLM 输出的 markdown 转换为 QQ 友好的纯文本格式。
 */

/**
 * 将 markdown 格式文本转换为 QQ 友好的纯文本。
 * 保留语义结构（换行、列表层级），去除所有 markdown 语法标记。
 */
export function stripMarkdown(text: string): string {
  if (!text) return text;

  let result = text;

  // 代码围栏：保留内容，去掉 ``` 标记和语言标识
  result = result.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    return code.trimEnd();
  });

  // 行内代码：去掉反引号
  result = result.replace(/`([^`]+)`/g, "$1");

  // 图片：![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // 链接：[text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // 标题：### text → text（保留换行）
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // 粗斜体（先处理三星号）：***text*** → text
  result = result.replace(/\*{3}(.+?)\*{3}/g, "$1");

  // 粗体：**text** 或 __text__ → text
  result = result.replace(/\*{2}(.+?)\*{2}/g, "$1");
  result = result.replace(/_{2}(.+?)_{2}/g, "$1");

  // 斜体：*text* 或 _text_ → text（避免误匹配列表项和下划线变量名）
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, "$1");
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "$1");

  // 删除线：~~text~~ → text
  result = result.replace(/~~(.+?)~~/g, "$1");

  // 引用块：> text → text
  result = result.replace(/^>\s?/gm, "");

  // 无序列表：- item 或 * item → · item（保留缩进层级）
  result = result.replace(/^(\s*)[-*]\s+/gm, "$1· ");

  // 水平分割线：--- / *** / ___ → 空行
  result = result.replace(/^[-*_]{3,}\s*$/gm, "");

  // 清理多余空行（超过 2 个连续空行压缩为 2 个）
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * 将长文本拆分为多条适合 QQ 发送的消息。
 *
 * 拆分策略：
 * 1. 按双换行（段落）拆分
 * 2. 单段超长时按单换行拆分
 * 3. 仍然超长时按句子拆分
 * 4. 相邻短段落合并，避免过度碎片化
 */
export function splitLongText(
  text: string,
  maxLength: number = 400,
): string[] {
  if (!text?.trim()) return [];
  if (text.length <= maxLength) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 当前段落本身就超长，需要进一步拆分
    if (trimmed.length > maxLength) {
      // 先把 buffer 中已有的内容推出去
      if (buffer.trim()) {
        chunks.push(buffer.trim());
        buffer = "";
      }
      // 按单换行拆分
      const lines = trimmed.split(/\n/);
      let lineBuffer = "";
      for (const line of lines) {
        if (lineBuffer && lineBuffer.length + line.length + 1 > maxLength) {
          chunks.push(lineBuffer.trim());
          lineBuffer = line;
        } else {
          lineBuffer = lineBuffer ? `${lineBuffer}\n${line}` : line;
        }
      }
      // lineBuffer 仍然超长，按句子拆分
      if (lineBuffer.length > maxLength) {
        const sentences = splitBySentence(lineBuffer);
        let sentBuffer = "";
        for (const sent of sentences) {
          if (sentBuffer && sentBuffer.length + sent.length > maxLength) {
            chunks.push(sentBuffer.trim());
            sentBuffer = sent;
          } else {
            sentBuffer = sentBuffer ? sentBuffer + sent : sent;
          }
        }
        if (sentBuffer.trim()) chunks.push(sentBuffer.trim());
      } else if (lineBuffer.trim()) {
        chunks.push(lineBuffer.trim());
      }
      continue;
    }

    // 尝试合并到 buffer
    const merged = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    if (merged.length <= maxLength) {
      buffer = merged;
    } else {
      if (buffer.trim()) chunks.push(buffer.trim());
      buffer = trimmed;
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());

  return chunks.length > 0 ? chunks : [text];
}

function splitBySentence(text: string): string[] {
  // 中文句号、问号、感叹号、英文句号+空格 作为断句点
  const parts = text.split(/(?<=[。！？；\n])|(?<=\.\s)/);
  return parts.filter((p) => p.trim().length > 0);
}
