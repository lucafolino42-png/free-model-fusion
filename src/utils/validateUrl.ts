import { ValidationError } from './errors.js';

// ─── Private/Internal IP Ranges ──────────────────────────
const PRIVATE_CIDR = [
  { prefix: '10.', mask: null },
  { prefix: '172.', mask: /^172\.(1[6-9]|2\d|3[01])\./ },
  { prefix: '192.168.', mask: null },
  { prefix: '127.', mask: null },
  { prefix: '169.254.', mask: null },
  { prefix: '0.', mask: null },
  { prefix: '100.', mask: /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./ },
];

function isPrivateIP(hostname: string): boolean {
  // Check IPv4 private ranges
  for (const range of PRIVATE_CIDR) {
    if (range.mask) {
      if (range.mask.test(hostname)) return true;
    } else if (hostname.startsWith(range.prefix)) {
      return true;
    }
  }
  return false;
}

function isPrivateIPv6(hostname: string): boolean {
  // Only apply to literal IPv6 addresses (contain colons)
  // DNS hostnames like "fc-provider.example.com" must not be blocked
  if (!hostname.includes(':')) return false;
  const lower = hostname.toLowerCase();
  // ::1 (IPv6 loopback)
  if (lower === '::1') return true;
  // fc00::/7 (unique local), fe80::/10 (link-local)
  if (lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  if (lower.startsWith('::ffff:')) return isPrivateIP(lower.replace(/^::ffff:/, ''));
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  const reserved = [
    'localhost',
    'localhost.localdomain',
    'broadcasthost',
    'local',
    'docker.host.internal',
    'host.docker.internal',
    'gateway.docker.internal',
  ];
  if (reserved.includes(lower)) return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  return false;
}

// ─── Validate Provider Endpoint URL ──────────────────────
export function validateProviderUrl(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ValidationError(
      `Invalid provider endpoint URL: "${urlString}". Must be a valid URL.`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError(
      `Invalid provider endpoint URL scheme: "${parsed.protocol}". Only "https:" is allowed for provider endpoints.`
    );
  }

  const hostname = parsed.hostname;

  if (isPrivateIP(hostname)) {
    throw new ValidationError(
      `Provider endpoint URL cannot point to a private or internal IP address: "${hostname}". Use a public provider endpoint.`
    );
  }

  if (isPrivateIPv6(hostname)) {
    throw new ValidationError(
      `Provider endpoint URL cannot point to a private or internal IPv6 address: "${hostname}". Use a public provider endpoint.`
    );
  }

  if (isPrivateHostname(hostname)) {
    throw new ValidationError(
      `Provider endpoint URL cannot point to a reserved or internal hostname: "${hostname}". Use a public provider endpoint.`
    );
  }

  const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (ipPattern.test(hostname)) {
    throw new ValidationError(
      `Provider endpoint URL cannot use a raw IP address: "${hostname}". Use a hostname instead.`
    );
  }

  if (hostname.length < 3 || hostname.length > 253) {
    throw new ValidationError(
      `Invalid hostname length in provider endpoint URL.`
    );
  }
}

// ─── Sanitize error messages to remove API key patterns ──
const API_KEY_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(gsk_[a-zA-Z0-9]{20,})\b/g,
  /\b(AIza[A-Za-z0-9_-]{35,})\b/g,
  /\b(Authorization:\s*Bearer\s+)[^\s"]+/gi,
  /\b(nvapi-[a-zA-Z0-9_-]{10,})\b/g,         // NVIDIA NIM
  /\b(pplx-[a-zA-Z0-9_-]{10,})\b/g,           // Perplexity
  /\b(fir-[a-zA-Z0-9_-]{10,})\b/g,             // Fireworks
  /\b(di-[a-zA-Z0-9_-]{10,})\b/g,               // DeepInfra
  /\b(sk_[a-zA-Z0-9]{20,})\b/g,                // Custom format: sk_
  /["']api_key["']\s*:\s*["'][^"']+["']/gi,
  /["']key["']\s*:\s*["'][^"']{10,}["']/gi,
  /\b([a-zA-Z0-9_-]{30,})\b/g,                    // Generic catch-all for long tokens
];

export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of API_KEY_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, ..._args) => {
      if (match.length < 20) return match;
      const content = match.replace(/^(Authorization:\s*Bearer\s+)/i, '');
      const prefix = match.slice(0, match.length - content.length);
      return `${prefix}${content.slice(0, 6)}****${content.slice(-4)}`;
    });
  }
  return sanitized;
}
