import { getProviderById } from '../providers/registry.js';
import { callModel } from '../providers/modelClient.js';
import { CONTINUATION_PROMPT } from './prompts.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RegisteredModel } from '../providers/types.js';

// ─── Continuation Result ─────────────────────────────────
export interface ContinuationResult {
  fullContent: string;
  continued: boolean;
  continuationContent?: string;
  finishReason?: string;
}

// ─── Check if Response is Truncated ──────────────────────
export function isTruncated(finishReason?: string): boolean {
  return (
    finishReason === 'length' || finishReason === 'max_tokens'
  );
}

// ─── Continue Truncated Response ─────────────────────────
export async function continueResponse(
  originalContent: string,
  model: RegisteredModel,
  finishReason?: string
): Promise<ContinuationResult> {
  if (!config.enableContinuation) {
    return {
      fullContent: originalContent,
      continued: false,
    };
  }

  if (!isTruncated(finishReason)) {
    return {
      fullContent: originalContent,
      continued: false,
    };
  }

  const provider = await getProviderById(model.providerId);
  if (!provider || !provider.enabled) {
    return {
      fullContent: originalContent,
      continued: false,
    };
  }

  logger.info('Response truncated, requesting continuation');

  try {
    const result = await callModel(
      provider,
      model.model,
      [
        { role: 'user', content: originalContent },
        { role: 'assistant', content: CONTINUATION_PROMPT },
      ],
      { maxTokens: config.continuationMaxTokens, temperature: 0.3 }
    );

    // Don't append empty/whitespace continuation content — it would only add
    // a stray blank line to the answer.
    if (result.content.trim().length === 0) {
      return {
        fullContent: originalContent,
        continued: false,
        continuationContent: result.content,
        finishReason: result.finishReason,
      };
    }

    return {
      fullContent: originalContent + '\n\n' + result.content,
      continued: true,
      continuationContent: result.content,
      finishReason: result.finishReason,
    };
  } catch (error) {
    logger.warn('Continuation failed, returning truncated response', {
      error: String(error),
    });
    return {
      fullContent: originalContent,
      continued: false,
    };
  }
}
