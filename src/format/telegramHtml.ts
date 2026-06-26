/**
 * Convert plain text to Telegram-compatible HTML.
 *
 * Strategy:
 * 1. First, escape all HTML in the raw input
 * 2. Then apply formatting transformations (bold, code, URLs, headers)
 * This ensures user content is safe but our tags remain valid.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeUrlAttr(url: string): string {
  return url.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

function extractUrls(text: string): Array<{ full: string; url: string }> {
  const urlRegex = /(https?:\/\/[^\s<]+)/gi;
  const matches: Array<{ full: string; url: string }> = [];
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    matches.push({ full: match[0], url: match[0] });
  }
  return matches;
}

function isCodeBlockLine(line: string): boolean {
  const codeIndicators = [
    /^```/,
    /^def /,
    /^function /,
    /^const /,
    /^let /,
    /^import /,
    /^export /,
    /^class /,
    /^<[a-z]+/,
    /^\d{4}-\d{2}-\d{2}T/,
    /^(\$|#|>|λ)/,
    /^\{"/,
    /^\[/,
    /^{{/,
    /^\/\/ /,
    /^# /,
  ];
  return codeIndicators.some((pattern) => pattern.test(line));
}

function looksLikePath(value: string): boolean {
  // Windows drive letter paths: C:\something or C:/something
  if (/^[A-Za-z]:[/\\]/.test(value)) return true;
  // Unix paths: /something
  if (value.startsWith('/')) return true;
  // Network paths: \\server\share or file: URLs
  if (value.startsWith('\\\\') || value.startsWith('file:')) return true;
  // Relative paths: ./something, ../something
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return false;
}

function isSectionHeader(line: string): boolean {
  if (!line || line.length === 0) return false;
  if (!/^[A-Za-z]/.test(line)) return false;
  const words = line.split(/\s+/).length;
  if (words < 1 || words > 7) return false;
  if (/[.!?:]$/.test(line)) return false;
  if (/https?:\/\//.test(line)) return false;
  if (/<[^>]+>/.test(line)) return false;
  if (line.length > 60 || line.includes(',') || line.includes(';')) return false;
  if (line.includes('**') || line.includes('`')) return false;
  return true;
}

export function convertToTelegramHtml(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const resultLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    // Handle code blocks (``` ... ```)
    if (trimmedLine.startsWith('```') && !inCodeBlock) {
      inCodeBlock = true;
      codeBlockContent = [];
      continue;
    }
    if (trimmedLine.startsWith('```') && inCodeBlock) {
      inCodeBlock = false;
      resultLines.push(`<pre>${escapeHtml(codeBlockContent.join('\n'))}</pre>`);
      codeBlockContent = [];
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent.push(rawLine);
      continue;
    }

    // Skip empty lines but preserve them
    if (!trimmedLine) {
      resultLines.push('');
      continue;
    }

    // ─── STRUCTURAL PATTERNS (before HTML escaping) ──────

    // Markdown headings (## Title)
    const headingMatch = trimmedLine.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      resultLines.push(`<b>${escapeHtml(headingMatch[1].trim())}</b>`);
      continue;
    }

    // Dashed headings (Title\n---)
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (nextLine.match(/^[-=]{3,}$/) && !trimmedLine.match(/^[-=]{3,}$/)) {
      resultLines.push(`<b>${escapeHtml(trimmedLine)}</b>`);
      continue;
    }

    // ─── SAFE ESCAPE ─────────────────────────────────────
    let line = escapeHtml(trimmedLine);

    // ─── INLINE FORMATTING ───────────────────────────────
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');

    // URL conversion
    const urls = extractUrls(line);
    if (urls.length > 0) {
      for (const url of urls) {
        const escapedUrl = escapeUrlAttr(url.url);
        const label = url.url.replace(/^https?:\/\//, '').slice(0, 60);
        const replacement = `<a href="${escapedUrl}">${label}</a>`;
        line = line.replace(url.full, replacement);
      }
    }

    // ─── STRIP BULLET PREFIX for content detection ───────
    let contentLine = line;
    let isBulletItem = false;
    if (contentLine.startsWith('- ') || contentLine.startsWith('* ')) {
      contentLine = contentLine.slice(2);
      isBulletItem = true;
    }

    // "Label: value" pattern (after stripping bullet prefix)
    const labelMatch = contentLine.match(/^([\w\s-]+):\s+(.+)/);
    if (labelMatch && labelMatch[1].trim().length > 0 && labelMatch[1].trim().length < 60) {
      const label = labelMatch[1].trim();
      const value = labelMatch[2].trim();
      const bullet = isBulletItem ? '* ' : '';

      const looksLikeCode = /^[\d.]+$/.test(value) ||
        /^[A-Z_]+$/.test(value) ||
        /^[a-z_]\w*$/.test(value) ||
        /^\w+\.\w+$/.test(value) ||
        /^[.\/\\]/.test(value) ||
        looksLikePath(value) ||
        value.startsWith('http');

      if (looksLikeCode) {
        resultLines.push(`${bullet}<b>${label}:</b> <code>${value}</code>`);
      } else {
        resultLines.push(`${bullet}<b>${label}:</b> ${value}`);
      }
      continue;
    }

    // Handle bullets (just plain bullets without label:value)
    if (isBulletItem) {
      resultLines.push(`* ${contentLine}`);
      continue;
    }

    // Numbered list items
    const numberedMatch = contentLine.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      resultLines.push(`${numberedMatch[1]}. ${numberedMatch[2]}`);
      continue;
    }

    // "Part X/Y" prefix
    const partMatch = contentLine.match(/^(Part\s+\d+\/\d+)\s*[-:]\s*/i);
    if (partMatch) {
      const rest = contentLine.slice(partMatch[0].length).trim();
      resultLines.push(`<b>${partMatch[1]}</b> ${rest}`);
      continue;
    }

    // Code-like lines
    if (isCodeBlockLine(contentLine)) {
      resultLines.push(`<code>${contentLine}</code>`);
      continue;
    }

    // Plain section headers
    if (isSectionHeader(contentLine)) {
      resultLines.push(`<b>${contentLine}</b>`);
      continue;
    }

    // Regular line
    resultLines.push(line);
  }

  let result = resultLines.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/<b>\s*<\/b>/g, '');
  return result.trim();
}
