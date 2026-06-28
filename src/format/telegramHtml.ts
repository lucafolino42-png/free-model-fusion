/**
 * Convert plain text to Telegram-compatible HTML.
 *
 * Strategy:
 * 1. First, apply structural formatting (section headers, sources, code blocks)
 * 2. Then escape remaining HTML and apply inline formatting
 * This ensures user content is safe but our tags remain valid.
 *
 * Visual hierarchy goals:
 * - Main answer content: bold section headers, key-value pairs, bullet lists
 * - Sources/references: <blockquote> with dimmer presentation
 * - URLs: show domain as label, keep scannable
 * - Numbered steps: bold numbers for clarity
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
  // Must start with a letter or emoji
  if (!/^[\p{L}\p{Emoji}]/u.test(line)) return false;
  const words = line.split(/\s+/).length;
  if (words < 1 || words > 8) return false;
  // Don't treat lines ending with punctuation as headers (those are sentences)
  if (/[.!?:]$/.test(line)) return false;
  // Skip lines with URLs, tags, markdown, commas, or semicolons
  if (/https?:\/\//.test(line)) return false;
  if (/<[^>]+>/.test(line)) return false;
  if (line.includes(',') || line.includes(';')) return false;
  if (line.includes('**') || line.includes('`')) return false;
  if (line.length > 70) return false;
  return true;
}

/**
 * Check if a line marks the start of a sources/references block. */
function isSourcesSectionHeader(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return (
    lower === 'sources' ||
    lower === 'sources:' ||
    lower === 'references' ||
    lower === 'references:' ||
    lower === 'source links' ||
    lower === 'source links:' ||
    lower === 'further reading' ||
    lower === 'further reading:' ||
    lower === 'links' ||
    lower === 'links:'
  );
}

/** Format a URL with a cleaner label (domain + path). */
function formatUrlLink(fullUrl: string): string {
  const escapedUrl = escapeUrlAttr(fullUrl);
  let label = fullUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
  // Truncate long paths but keep domain visible
  if (label.length > 65) {
    label = label.slice(0, 62) + '…';
  }
  return `<a href="${escapedUrl}">${label}</a>`;
}

export function convertToTelegramHtml(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');

  // ── Pass 1: Detect sources block boundaries ────────────
  // Find the last occurrence of a "Sources:" section header.
  // Everything from that line onward is treated as a sources block.
  let sourcesBlockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSourcesSectionHeader(lines[i])) {
      sourcesBlockStart = i;
    }
  }

  // ── Pass 2: Process each line ──────────────────────────
  const resultLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inSourcesBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    // ── Sources block ────────────────────────────────────
    if (sourcesBlockStart >= 0 && i >= sourcesBlockStart) {
      if (!inSourcesBlock) {
        // Emit the sources section header + opening blockquote
        inSourcesBlock = true;
        // Insert a blank line as separator before sources block
        resultLines.push('');
        resultLines.push('<i>Sourced from:</i>');
        continue;
      }

      // Skip empty lines within sources block
      if (!trimmedLine) {
        continue;
      }

      // Format source entry: bullet source URL or text
      const escaped = escapeHtml(trimmedLine);

      // Remove leading bullet markers
      let content = escaped.replace(/^[-*+]\s*/, '');

      // Extract and bold the title BEFORE URL replacement,
      // so the URL is still present in the text for detection.
      // Pattern: "Title — https://..." or "Title - https://..."
      const urlInContent = extractUrls(content);
      let titlePart = '';
      let urlPart = '';
      if (urlInContent.length > 0) {
        const firstUrl = urlInContent[0].full;
        const fullUrlIndex = content.indexOf(firstUrl);
        // Extract title from text before the URL, stripping connectors
        titlePart = content.slice(0, fullUrlIndex).replace(/\s*[—–\-:]\s*$/, '').trim();
        urlPart = content.slice(fullUrlIndex);
      }

      // Format URLs in the source line
      for (const url of urlInContent) {
        const link = formatUrlLink(url.url);
        content = content.replace(url.full, link);
        urlPart = urlPart.replace(url.full, link);
      }

      if (titlePart && titlePart.length < 120) {
        // Also handle [N] citation prefix within the title
        const refMatch = titlePart.match(/^(\[\d+\])\s*(.+)/);
        if (refMatch) {
          content = `<code>${refMatch[1]}</code> <b>${refMatch[2]}</b>\n  ${urlPart}`;
        } else {
          content = `<b>${titlePart}</b>\n  ${urlPart}`;
        }
      } else if (urlInContent.length === 0) {
        // No URL — plain reference like "[1] Title"
        const refMatch = content.match(/^(\[\d+\])\s*(.+)/);
        if (refMatch) {
          content = `<code>${refMatch[1]}</code> ${refMatch[2]}`;
        }
      }

      resultLines.push(`  • ${content}`);
      continue;
    }

    // ── Normal content block ──────────────────────────────

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

    // ── STRUCTURAL PATTERNS (before HTML escaping) ──────

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

    // ── SAFE ESCAPE ─────────────────────────────────────
    let line = escapeHtml(trimmedLine);

    // ── INLINE FORMATTING ───────────────────────────────
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');

    // URL conversion — use cleaner labels
    const urls = extractUrls(line);
    if (urls.length > 0) {
      for (const url of urls) {
        const link = formatUrlLink(url.url);
        line = line.replace(url.full, link);
      }
    }

    // ── STRIP BULLET PREFIX for content detection ───────
    let contentLine = line;
    let isBulletItem = false;
    if (contentLine.startsWith('- ') || contentLine.startsWith('* ')) {
      contentLine = contentLine.slice(2);
      isBulletItem = true;
    }

    // ── Numbered list items (before label:value check) ──
    const numberedMatch = contentLine.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch && !isBulletItem) {
      resultLines.push(`<b>${numberedMatch[1]}.</b> ${numberedMatch[2]}`);
      continue;
    }

    // ── "Label: value" pattern (after stripping bullet prefix) ──
    const labelMatch = contentLine.match(/^([\w\s-]+):\s+(.+)/);
    if (labelMatch && labelMatch[1].trim().length > 0 && labelMatch[1].trim().length < 60) {
      const label = labelMatch[1].trim();
      const value = labelMatch[2].trim();
      const bullet = isBulletItem ? '* ' : '';

      const looksLikeCode =
        /^[\d.]+$/.test(value) ||
        /^[A-Z_]+$/.test(value) ||
        /^[a-z_]\w*$/.test(value) ||
        /^\w+\.\w+$/.test(value) ||
        /^[.\\/]/.test(value) ||
        looksLikePath(value) ||
        value.startsWith('http') ||
        value.startsWith('<a href');

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

    // ── "Part X/Y" prefix ───────────────────────────────
    const partMatch = contentLine.match(/^(Part\s+\d+\/\d+)\s*[-:]\s*/i);
    if (partMatch) {
      const rest = contentLine.slice(partMatch[0].length).trim();
      resultLines.push(`<b>${partMatch[1]}</b> ${rest}`);
      continue;
    }

    // ── Inline source citations like [1], [source: ...] ──
    // Must come BEFORE isCodeBlockLine check because ^[ is a code indicator
    const citeMatch = contentLine.match(/^\[(\d+|[a-z]+(?:\s+\d+)?)\]\s*/i);
    if (citeMatch) {
      const rest = contentLine.slice(citeMatch[0].length).trim();
      resultLines.push(`<code>[${citeMatch[1]}]</code> ${rest}`);
      continue;
    }

    // ── Code-like lines ──────────────────────────────────
    if (isCodeBlockLine(contentLine)) {
      resultLines.push(`<code>${contentLine}</code>`);
      continue;
    }

    // ── Plain section headers ────────────────────────────
    if (isSectionHeader(contentLine)) {
      resultLines.push(`<b>${contentLine}</b>`);
      continue;
    }

    // Regular line — unchanged
    resultLines.push(line);
  }

  let result = resultLines.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/<b>\s*<\/b>/g, '');
  return result.trim();
}
