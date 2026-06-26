import { getProviderById } from '../providers/registry.js';
import { callModelsParallel } from '../providers/modelClient.js';
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
}

// ─── Run Expert Panel ────────────────────────────────────
export async function runExpertPanel(
  experts: RegisteredModel[],
  question: string
): Promise<ExpertPanelResult> {
  if (experts.length === 0) {
    logger.warn('No experts available to call');
    return { responses: [], errors: [] };
  }

  logger.info(`Running expert panel with ${experts.length} experts`);

  // Build parallel calls
  const calls = await Promise.all(
    experts.map(async (model) => {
      const provider = await getProviderById(model.providerId);
      if (!provider || !provider.enabled) return null;

      return {
        provider,
        modelId: model.model,
        messages: [
          { role: 'system' as const, content: expertExpertPrompt(question) },
          { role: 'user' as const, content: question },
        ],
        options: {
          maxTokens: config.expertMaxTokens,
          temperature: 0.3,
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

  const results = await callModelsParallel(validCalls);

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
    `Expert panel complete: ${responses.length} success, ${errors.length} failed`
  );

  return { responses, errors };
}
