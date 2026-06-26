import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { WebSearchError } from '../utils/errors.js';
import type { WebSearchResult } from '../providers/types.js';

// ─── Auto-search trigger keywords ───────────────────────
const AUTO_SEARCH_TRIGGERS = [
  'latest',
  'today',
  'yesterday',
  'current',
  'recent',
  'news',
  'price',
  'pricing',
  'docs',
  'documentation',
  'changelog',
  'release',
  'version',
  'error',
  'issue',
  'compare',
  'best',
  'free',
  'credits',
  'api',
  'model',
  'limits',
  'quota',
  'benchmark',
  '2025',
  '2026',
];

// ─── Should Auto-Search ──────────────────────────────────
export function shouldAutoSearch(message: string): boolean {
  const lower = message.toLowerCase();
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

    const data = (await response.json()) as {
      query: string;
      answer?: string;
      results: Array<{
        title: string;
        url: string;
        content: string;
        score?: number;
      }>;
      response_time?: number;
    };

    logger.debug(
      `Web search returned ${data.results?.length || 0} results in ${data.response_time || '?'}ms`
    );

    return {
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
      answer: data.answer,
    };
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
