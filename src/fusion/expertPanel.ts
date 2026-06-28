import { getProviderById } from '../providers/registry.js';
import { callModelsParallel, callModelsWithRace } from '../providers/modelClient.js';
import { expertExpertPrompt } from './prompts.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RegisteredModel } from '../providers/types.js';

// ─── Expert Panel Result ─────────────────────────────────
export interface ExpertPanelResult {
  responses: Array<{
    modelId: string;
    provider: string;
    content: string;
    success: boolean;
  }>;
  errors: Array<{
    provider: string;
    model: string;
    error: string;
  }>;
  /**
   * Number of expert calls that were started but not waited for
   * (because minResponses was reached and we raced ahead with synthesis).
   * These calls continue in the background but their results are discarded.
   */
  racedAhead?: number;
}

/**
 * Expert perspectives for diversity (MoA-inspired).
 * Each expert gets a slightly different role so they cover different angles
 * rather than all producing the same generic answer.
 */
const EXPERT_PERSPECTIVES = [
  'a Technical',
  'a Practical',
  'an Analytical',
  'an Educational',
];

/**
 * Build the message array for an expert call.
 *
 * Note: the question is NOT included in the system prompt (expertExpertPrompt
 * no longer takes a question parameter) — it only appears once as the final
 * user message, eliminating the duplication bug.
 *
 * Experts are assigned diverse perspectives (MoA-style) so they cover different
 * angles: factual depth, practical usage, analytical reasoning, and
 * educational clarity. This produces more diverse, higher-quality responses
 * than giving every expert the same generic prompt.
 */
function buildExpertMessages(
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  question: string,
  expertIndex: number
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const perspective = EXPERT_PERSPECTIVES[expertIndex % EXPERT_PERSPECTIVES.length];

  return [
    {
      role: 'system',
      content: `${expertExpertPrompt()}

Focus on providing ${perspective.toLowerCase()} perspective.`,
    },
    ...history,
    { role: 'user', content: question },
  ];
}

// ─── Run Expert Panel ────────────────────────────────────
export async function runExpertPanel(
  experts: RegisteredModel[],
  question: string,
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
  options?: {
    /**
     * Minimum number of successful responses to wait for before proceeding.
     * If > 0, the panel uses a race mechanism: once minResponses experts have
     * replied, the function returns immediately with their responses. The
     * remaining calls continue in the background but are discarded.
     * Default: 0 (wait for all experts).
     */
    minResponses?: number;
    /** Reasoning effort level for expert models. */
    reasoningEffort?: string;
  }
): Promise<ExpertPanelResult> {
  if (experts.length === 0) {
    logger.warn('No experts available to call');
    return { responses: [], errors: [] };
  }

  const minResponses = options?.minResponses ?? 0;
  const useRace = minResponses > 0 && experts.length > minResponses;

  logger.info(
    `Running expert panel with ${experts.length} experts${useRace ? ` (racing after ${minResponses} responses)` : ''}`
  );

  // Build parallel calls with diverse expert perspectives (MoA-inspired).
  // Each expert gets a different angle so they cover more ground.
  const reasoningEffort = options?.reasoningEffort;
  const calls = await Promise.all(
    experts.map(async (model, index) => {
      const provider = await getProviderById(model.providerId);
      if (!provider || !provider.enabled) return null;

      return {
        provider,
        modelId: model.model,
        messages: buildExpertMessages(history, question, index),
        options: {
          maxTokens: config.expertMaxTokens,
          temperature: 0.3,
          reasoningEffort,
        },
      };
    })
  );

  const validCalls = calls.filter(
    (c): c is NonNullable<typeof c> => c !== null
  );

  if (validCalls.length === 0) {
    return { responses: [], errors: experts.map((m) => ({
      provider: m.providerId,
      model: m.id,
      error: 'No valid provider found',
    })) };
  }

  let racedAhead = 0;
  let results;

  if (useRace) {
    // Race mode: return as soon as minResponses succeed, discard the rest.
    const raceResult = await callModelsWithRace(validCalls, minResponses);
    results = raceResult.results;
    racedAhead = raceResult.discarded;
  } else {
    results = await callModelsParallel(validCalls);
  }

  const responses: ExpertPanelResult['responses'] = [];
  const errors: ExpertPanelResult['errors'] = [];

  for (const result of results) {
    if (result.success && result.content) {
      responses.push({
        modelId: result.modelId,
        provider: result.providerId,
        content: result.content,
        success: true,
      });
    } else {
      errors.push({
        provider: result.providerId,
        model: result.modelId,
        error: result.error || 'Unknown error',
      });
    }
  }

  logger.info(
    `Expert panel complete: ${responses.length} success, ${errors.length} failed${racedAhead > 0 ? `, ${racedAhead} raced ahead` : ''}`
  );

  return { responses, errors, racedAhead };
}
