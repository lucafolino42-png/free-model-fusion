// ─── Normalized Input ────────────────────────────────────
export interface NormalizedInput {
  original: string;
  cleaned: string;
  sessionId: string;
  source: 'telegram' | 'api' | 'webhook';
  profile?: 'speed' | 'balanced' | 'quality' | 'custom';
  web?: 'on' | 'off' | 'auto';
}

// ─── Normalize Input ─────────────────────────────────────
export function normalizeInput(
  message: string,
  options: {
    sessionId?: string;
    source?: 'telegram' | 'api' | 'webhook';
    profile?: 'speed' | 'balanced' | 'quality' | 'custom';
    web?: 'on' | 'off' | 'auto';
  } = {}
): NormalizedInput {
  const cleaned = message
    .trim()
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize Unicode
    .normalize('NFKC')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Remove control characters except newlines
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Generate temp session ID if not provided
  let sessionId = options.sessionId || '';
  if (!sessionId) {
    sessionId = `temp:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }

  // Determine source
  const source = options.source || 'api';

  return {
    original: message,
    cleaned,
    sessionId,
    source,
    profile: options.profile,
    web: options.web,
  };
}
