import { getCredential } from './credentials.js';
import { logger } from '../utils/logger.js';
import { ProviderError } from '../utils/errors.js';
import { sanitizeErrorMessage } from '../utils/validateUrl.js';
import type { RegisteredProvider } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Chat Completion Response Extraction ─────────────────
function extractContent(response: unknown): string | null {
  const data = response as Record<string, unknown>;

  // OpenAI format: choices[0].message.content
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (choices && choices.length > 0) {
    const choice = choices[0];
    if (choice.message && typeof choice.message === 'object') {
      const content = (choice.message as Record<string, unknown>).content;
      if (typeof content === 'string') return content;
    }
    if (typeof choice.text === 'string') return choice.text;
  }

  // Gemini format: candidates[0].content.parts[].text
  const candidates = data.candidates as
    | Array<Record<string, unknown>>
    | undefined;
  if (candidates && candidates.length > 0) {
    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (content) {
      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (parts && parts.length > 0) {
        return parts.map((p) => p.text || '').join('');
      }
    }
  }

  // Alternative formats
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.message === 'string') return data.message;

  return null;
}

// ─── Finish Reason Extraction ────────────────────────────
function extractFinishReason(response: unknown): string | undefined {
  const data = response as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (choices && choices.length > 0) {
    return choices[0].finish_reason as string | undefined;
  }
  return undefined;
}

// ─── Call Provider Model ─────────────────────────────────
export async function callModel(
  provider: RegisteredProvider,
  modelId: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: {
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
  } = {}
): Promise<{
  content: string;
  finishReason?: string;
  model?: string;
}> {
  const apiKey = await getCredential(provider.credentialRef);

  if (!apiKey) {
    throw new ProviderError(
      `No API key found for provider: ${provider.label}`,
      provider.id
    );
  }

  const maxTokens = options.maxTokens ?? provider.maxOutputTokens;
  const temperature = options.temperature ?? 0.2;

  const body = {
    model: modelId,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  logger.debug(`Calling model ${modelId} via ${provider.label}`, {
    messagesCount: messages.length,
    maxTokens,
  });

  // AbortController with timeout (30s default)
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'free-model-fusion/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let parsedError: string;
      try {
        const errorJson = JSON.parse(errorText);
        parsedError =
          errorJson.error?.message || errorJson.message || errorText;
      } catch {
        parsedError = errorText;
      }

      // Sanitize error messages to prevent API key leakage
      const sanitizedError = sanitizeErrorMessage(parsedError);

      throw new ProviderError(
        `Provider ${provider.label} returned ${response.status}: ${sanitizedError}`,
        provider.id,
        response.status
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    const content = extractContent(data);
    if (content === null) {
      logger.warn(`Could not extract content from ${modelId} response`, {
        responseKeys: Object.keys(data),
      });
      throw new ProviderError(
        `Could not parse response from ${provider.label} model ${modelId}`,
        provider.id
      );
    }

    const finishReason = extractFinishReason(data);
    const model =
      (data.model as string | undefined) || modelId;

    return {
      content,
      finishReason,
      model,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // Sanitize error messages for network/abort errors
    const errorMsg = error instanceof Error ? error.message : String(error);
    const sanitized = sanitizeErrorMessage(errorMsg);
    throw new ProviderError(
      `Request to ${provider.label} (${modelId}) failed: ${sanitized}`,
      provider.id
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Call Multiple Models in Parallel ────────────────────
export async function callModelsParallel(
  calls: Array<{
    provider: RegisteredProvider;
    modelId: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    options?: { maxTokens?: number; temperature?: number; timeout?: number };
  }>
): Promise<
  Array<{
    success: boolean;
    modelId: string;
    providerId: string;
    content?: string;
    finishReason?: string;
    error?: string;
  }>
> {
  const results = await Promise.allSettled(
    calls.map((call) =>
      callModel(
        call.provider,
        call.modelId,
        call.messages,
        call.options
      ).then((result) => ({
        success: true,
        modelId: call.modelId,
        providerId: call.provider.id,
        content: result.content,
        finishReason: result.finishReason,
      }))
    )
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      success: false,
      modelId: calls[index].modelId,
      providerId: calls[index].provider.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}
