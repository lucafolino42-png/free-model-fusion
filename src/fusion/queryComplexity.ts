/**
 * Query complexity analysis — lightweight classifier that suggests a routing
 * profile based on the structure and content of the user's question.
 *
 * Classification criteria:
 * - Simple/factual queries of few words → speed
 * - Multi-step reasoning or code-heavy queries → quality
 * - Everything else → undefined (let the caller's default apply)
 */

// Keywords that indicate a simple factual question
const SIMPLE_INDICATORS = [
  'what is', 'who is', 'where is', 'when is', 'define',
  'meaning of', 'capital of', 'population of',
  'how many', 'how much', 'what time', 'what date',
  'who created', 'who invented', 'who wrote',
  'spell', 'translate', 'convert', 'calculate',
  'tell me a', 'tell me about',
];

// Keywords that indicate complex/multi-step reasoning
const COMPLEX_INDICATORS = [
  'explain', 'how does', 'how do', 'why does', 'why is',
  'compare', 'contrast', 'analyze', 'evaluate', 'discuss',
  'advantages and disadvantages', 'pros and cons',
  'difference between', 'relationship between',
  'write', 'create', 'build', 'design', 'implement',
  'refactor', 'optimize', 'debug', 'troubleshoot',
  'step by step', 'walk through', 'break down',
  'generate', 'synthesize', 'derive', 'prove',
  'architecture', 'design pattern', 'algorithm',
  'complexity analysis', 'performance',
];

export type ComplexityClass = 'simple' | 'complex' | 'balanced';

/**
 * Analyze a query and suggest a complexity class.
 * Returns undefined if no strong signal — the caller's profile default applies.
 */
export function analyzeQueryComplexity(
  query: string
): ComplexityClass | undefined {
  const lower = query.toLowerCase().trim();
  const normalized = lower.replace(/\s+/g, ' ');
  const wordCount = normalized.split(/\s+/).length;

  // ── Code-heavy query detection ───────────────────────────
  // If the query contains code blocks or significant code, treat as complex
  if (
    /```|[{}=>]=>|=>|function\s*\(|class\s+\w|import\s+\w/.test(normalized)
  ) {
    return 'complex';
  }

  // ── Complex reasoning check ───────────────────────────────
  const isComplex = COMPLEX_INDICATORS.some(
    (indicator) => normalized.startsWith(indicator) || normalized.includes(indicator)
  );
  if (isComplex) return 'complex';

  // ── Simple factual check ──────────────────────────────────
  const isSimple = SIMPLE_INDICATORS.some(
    (indicator) => normalized.startsWith(indicator) || normalized.includes(indicator)
  );
  if (isSimple) {
    if (wordCount <= 10) return 'simple';
    return 'simple';
  }

  // ── Length-based heuristic ────────────────────────────────
  if (wordCount <= 4 && /[?]$/.test(normalized)) return 'simple';

  // Multi-sentence queries are likely complex
  const sentenceCount = (normalized.match(/[.!?]+/g) || []).length;
  if (sentenceCount >= 3) return 'complex';

  // ── No strong signal ──────────────────────────────────────
  return undefined;
}
