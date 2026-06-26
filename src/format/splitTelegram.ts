import { config } from '../config.js';

// ─── Split Telegram Message ──────────────────────────────
export function splitTelegramMessage(
  text: string,
  maxLength: number = config.telegramChunkSize
): string[] {
  if (!text) return [];

  // Remove null characters
  text = text.replace(/\0/g, '');

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const totalParts = Math.ceil(text.length / maxLength);

  let start = 0;
  let partNum = 1;

  while (start < text.length) {
    let end = start + maxLength;

    // Don't split in the last part
    if (end >= text.length) {
      const part = text.slice(start);
      const prefix = `<b>Part ${partNum}/${totalParts}</b>\n\n`;
      if (partNum === 1) {
        chunks.push(part);
      } else {
        chunks.push(prefix + part);
      }
      break;
    }

    // Try to split on paragraph break first
    const paragraphBreak = text.lastIndexOf('\n\n', end);
    if (paragraphBreak > start && paragraphBreak > end - 500) {
      end = paragraphBreak;
    } else {
      // Try line break
      const lineBreak = text.lastIndexOf('\n', end);
      if (lineBreak > start && lineBreak > end - 300) {
        end = lineBreak;
      } else {
        // Try space
        const space = text.lastIndexOf(' ', end);
        if (space > start && space > end - 200) {
          end = space;
        }
      }
    }

    // Ensure we don't split in the middle of an HTML tag
    let part = text.slice(start, end);

    // Check for unclosed HTML tags
    const openTags: string[] = [];
    const tagRegex = /<\/?([a-zA-Z]+)[^>]*>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(part)) !== null) {
      if (tagMatch[0].startsWith('</')) {
        // Closing tag
        const idx = openTags.lastIndexOf(tagMatch[1]);
        if (idx >= 0) openTags.splice(idx, 1);
      } else if (!tagMatch[0].endsWith('/>')) {
        // Opening tag
        openTags.push(tagMatch[1]);
      }
    }

    // If we have unclosed tags, find a better split point
    if (openTags.length > 0) {
      // Try to find the last safe break before the unclosed tag starts
      const lastOpenTag = Math.max(
        ...openTags.map((tag) => part.lastIndexOf(`<${tag}`))
      );
      if (lastOpenTag > start + 100) {
        // Try splitting before the unclosed tag
        const betterEnd = text.lastIndexOf('\n', start + lastOpenTag - 1);
        if (betterEnd > start) {
          part = text.slice(start, betterEnd);
          end = betterEnd;
        }
      }
    }

    const prefix =
      partNum > 1 ? `<b>Part ${partNum}/${totalParts}</b>\n\n` : '';
    chunks.push(prefix + part.trim());
    start = end;
    partNum++;

    // Safety: prevent infinite loop
    if (partNum > 100) break;
  }

  return chunks;
}
