import { getProviderById } from '../providers/registry.js';
import { callModel } from '../providers/modelClient.js';
import { judgeSystemPrompt } from './prompts.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RegisteredModel } from '../providers/types.js';

// ─── Judge Result ────────────────────────────────────────
export interface JudgeResult {
  evaluation: string;
  modelUsed: string;
  success: boolean;
  /** Per-expert quality scores (1-10), keyed by modelId.
   *  Extracted from the judge's evaluation text.
   *  Higher = better quality / more relevant. */
  scores?: Record<string, number>;
}

/**
 * Parse per-expert scores from the judge's evaluation text.
 * Expected format lines:
 *   Score <modelId>: 8/10
 *   Score: modelId → 7
 */
function parseScores(
  evaluation: string,
  expertResponses: Array<{ modelId: string; content: string }>
): Record<string, number> | undefined {
  const scores: Record<string, number> = {};
  let found = false;

  for (const expert of expertResponses) {
    // Pattern: Score modelId: N/10  or  Score: modelId → N  or  modelId: N/10
    const patterns = [
      new RegExp(`Score\\s+${escapeRegex(expert.modelId)}\\s*[:\\-→]\\s*(\\d+)(?:/\\d+)?`, 'i'),
      new RegExp(`${escapeRegex(expert.modelId)}\\s*[:\\-→]\\s*(\\d+)\\s*/\\s*10`, 'i'),
      new RegExp(`score.*?${escapeRegex(expert.modelId)}.*?(\\d+)\\s*/\\s*10`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = evaluation.match(pattern);
      if (match) {
        const score = parseInt(match[1], 10);
        if (score >= 1 && score <= 10) {
          scores[expert.modelId] = score;
          found = true;
        }
        break;
      }
    }
  }

  return found ? scores : undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Run Judge ───────────────────────────────────────────
export async function runJudge(
  judgeModel: RegisteredModel,
  question: string,
  expertResponses: Array<{ modelId: string; content: string }>,
  webContext: string,
  reasoningEffort?: string
): Promise<JudgeResult> {
  const provider = await getProviderById(judgeModel.providerId);
  if (!provider || !provider.enabled) {
    return {
      evaluation: '',
      modelUsed: judgeModel.id,
      success: false,
    };
  }

  logger.info(`Running judge with ${judgeModel.id}`);

  try {
    const result = await callModel(
      provider,
      judgeModel.model,
      [
        {
          role: 'system',
          content: judgeSystemPrompt(question, expertResponses, webContext),
        },
        {
          role: 'user',
          content: 'Evaluate the expert responses for this question.',
        },
      ],
      { maxTokens: config.judgeMaxTokens, temperature: 0.2, reasoningEffort }
    );

    // Parse confidence scores from evaluation text
    const scores = parseScores(result.content, expertResponses);

    return {
      evaluation: result.content,
      modelUsed: judgeModel.id,
      success: true,
      scores,
    };
  } catch (error) {
    logger.warn(`Judge model ${judgeModel.id} failed: ${String(error)}`);

    // Fallback: use a simple evaluation
    return {
      evaluation:
        'Judge evaluation failed. Using expert responses directly.',
      modelUsed: judgeModel.id,
      success: false,
    };
  }
}
