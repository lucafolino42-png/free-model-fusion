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
}

// ─── Run Judge ───────────────────────────────────────────
export async function runJudge(
  judgeModel: RegisteredModel,
  question: string,
  expertResponses: Array<{ modelId: string; content: string }>,
  webContext: string
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
      { maxTokens: config.judgeMaxTokens, temperature: 0.2 }
    );

    return {
      evaluation: result.content,
      modelUsed: judgeModel.id,
      success: true,
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
