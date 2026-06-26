import { getProviderById } from '../providers/registry.js';
import { callModel } from '../providers/modelClient.js';
import { synthesisSystemPrompt } from './prompts.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RegisteredModel } from '../providers/types.js';

// ─── Synthesis Result ────────────────────────────────────
export interface SynthesisResult {
  content: string;
  modelUsed: string;
  finishReason?: string;
  success: boolean;
}

// ─── Run Synthesis ───────────────────────────────────────
export async function runSynthesis(
  synthesisModel: RegisteredModel,
  question: string,
  expertResponses: Array<{ modelId: string; content: string }>,
  judgeEvaluation: string,
  webContext: string
): Promise<SynthesisResult> {
  const provider = await getProviderById(synthesisModel.providerId);
  if (!provider || !provider.enabled) {
    return {
      content: '',
      modelUsed: synthesisModel.id,
      success: false,
    };
  }

  logger.info(`Running synthesis with ${synthesisModel.id}`);

  try {
    const result = await callModel(
      provider,
      synthesisModel.model,
      [
        {
          role: 'system',
          content: synthesisSystemPrompt(
            question,
            expertResponses,
            judgeEvaluation,
            webContext
          ),
        },
        {
          role: 'user',
          content: question,
        },
      ],
      { maxTokens: config.synthesisMaxTokens, temperature: 0.3 }
    );

    return {
      content: result.content,
      modelUsed: synthesisModel.id,
      finishReason: result.finishReason,
      success: true,
    };
  } catch (error) {
    logger.warn(
      `Synthesis model ${synthesisModel.id} failed: ${String(error)}`
    );
    return {
      content: '',
      modelUsed: synthesisModel.id,
      success: false,
    };
  }
}
