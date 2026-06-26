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
  webContext: string,
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
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
        ...history,
        {
          role: 'user',
          content: question,
        },
      ],
      { maxTokens: config.synthesisMaxTokens, temperature: 0.3 }
    );

    // Treat empty/whitespace-only content as a failure so the caller's
    // fallback (use the first successful expert response) kicks in instead of
    // returning a blank answer. Cheap models sometimes return empty content
    // for trivial prompts or certain refusals.
    const success = result.content.trim().length > 0;
    return {
      content: result.content,
      modelUsed: synthesisModel.id,
      finishReason: result.finishReason,
      success,
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
