import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { WebSearchError } from '../utils/errors.js';
import type { WebSearchResult } from '../providers/types.js';

// ─── Auto-search trigger keywords ───────────────────────
const AUTO_SEARCH_TRIGGERS = [
  // Time-sensitive recency
  'latest',
  'today',
  'yesterday',
  'current',
  'recent',
  'now',
  'this week',
  'this month',
  'this year',

  // News & events
  'news',
  'headline',
  'breaking',
  'announce',
  'event',
  'fixture',
  'schedule',
  'upcoming',
  'calendar',
  'deadline',
  'countdown',

  // Sports
  'game',
  'match',
  'score',
  'tournament',
  'championship',
  'world cup',
  'league',
  'standings',
  'playoff',

  // Questions about timing
  'when',
  'next',
  'what time',
  'what date',
  'how long',
  'how many',
  'is there',
  'are there',
  'will there',

  // Weather / conditions
  'weather',
  'forecast',
  'temperature',

  // Prices & comparisons
  'price',
  'pricing',
  'cost',
  'deal',
  'discount',
  'sale',
  'compare',
  'vs',
  'versus',
  'best',

  // Tech / docs
  'docs',
  'documentation',
  'changelog',
  'release',
  'version',
  'error',
  'issue',
  'bug',
  'fix',

  // Resource terms
  'free',
  'credits',
  'api',
  'model',
  'limits',
  'quota',
  'benchmark',
  'uptime',
  'status',

  // Years (future-proofing: include current + next 3 years)
  '2025',
  '2026',
  '2027',
  '2028',
  '2029',
];

// ─── App-usage keywords that should NOT trigger web search ─
// When the user is asking about the app itself, skip the `?` auto-search
// to avoid wasting a Tavily call on questions like "How do I clear my session?"
const APP_USAGE_TRIGGERS = [
  'how do i',
  'how to',
  'how can i',
  'clear my session',
  'change profile',
  'switch profile',
  'add key',
  'delete key',
  'list keys',
  'add model',
  'remove model',
  'enable provider',
  'disable provider',
  'enable model',
  'disable model',
  'set judge',
  'set synthesis',
  'web search mode',
  'auto search',
  'show memory',
  'new chat',
  'reset',
  'wizard',
  'show stats',
  'set token',
  'token budget',
  'what commands',
  'available commands',
  'list commands',
  'command list',
  'help',
  '/profile',
  '/speed',
  '/balanced',
  '/quality',
  '/custom',
  '/models',
  '/providers',
  '/addkey',
  '/deletekey',
  '/listkeys',
  '/add',
  '/remove',
  '/web',
  '/search',
  '/memory',
  '/newchat',
  '/stats',
  '/tokens',
  '/wizard',
];

// ─── Should Auto-Search ──────────────────────────────────
export function shouldAutoSearch(message: string): boolean {
  const lower = message.toLowerCase();

  // Check for app-usage questions first — these should NOT trigger search
  // even if they contain a `?`.
  const isAppUsage = APP_USAGE_TRIGGERS.some((trigger) =>
    lower.includes(trigger)
  );
  if (isAppUsage) return false;

  // Any remaining message with a question mark is likely time-sensitive
  if (message.includes('?')) return true;

  return AUTO_SEARCH_TRIGGERS.some((trigger) => lower.includes(trigger));
}

// ─── Search Web ──────────────────────────────────────────
export async function searchWeb(
  query: string,
  maxResults: number = config.webMaxResults
): Promise<{
  results: WebSearchResult[];
  answer?: string;
}> {
  const apiKey = config.tavilyApiKey;

  if (!apiKey) {
    throw new WebSearchError(
      'Tavily API key not configured. Set TAVILY_API_KEY env var or use /addsearchkey command.'
    );
  }

  logger.info(`Searching web for: ${query}`);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: maxResults,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new WebSearchError(
        `Tavily search failed: ${response.status} ${errorText}`
      );
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null) {
      throw new WebSearchError('Tavily returned an unexpected response shape');
    }
    const root = data as Record<string, unknown>;
    const rawResults = Array.isArray(root.results) ? root.results : [];
    const results: WebSearchResult[] = [];
    for (const r of rawResults) {
      if (typeof r !== 'object' || r === null) continue;
      const row = r as Record<string, unknown>;
      if (typeof row.title === 'string' && typeof row.url === 'string' && typeof row.content === 'string') {
        results.push({
          title: row.title,
          url: row.url,
          content: row.content,
          score: typeof row.score === 'number' ? row.score : undefined,
        });
      }
    }
    const answer = typeof root.answer === 'string' ? root.answer : undefined;

    logger.debug(
      `Web search returned ${results.length} results in ${typeof root.response_time === 'number' ? root.response_time : '?'}ms`
    );

    return { results, answer };
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(`Web search failed: ${String(error)}`);
  }
}

// ─── Format Search Results for Context ───────────────────
export function formatSearchResults(
  results: WebSearchResult[],
  maxChars: number = config.webContextChars
): string {
  if (results.length === 0) return '';

  let context = '## Web Search Results\n\n';
  let remaining = maxChars;

  for (const result of results) {
    const header = `**${result.title}**\nSource: ${result.url}\n\n`;
    const content = result.content.slice(0, Math.min(result.content.length, remaining - header.length - 100));

    const entry = `${header}${content}\n\n`;
    if (entry.length > remaining) break;

    context += entry;
    remaining -= entry.length;
  }

  return context;
}
