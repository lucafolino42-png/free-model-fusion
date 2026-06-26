import { getCredential } from './credentials.js';
import { logger } from '../utils/logger.js';
import { ProviderError } from '../utils/errors.js';
import { sanitizeErrorMessage } from '../utils/validateUrl.js';
import type { RegisteredProvider } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Chat Completion Response Extraction ─────────────────
type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function extractContent(response: unknown): string | null {
  if (!isObject(response)) return null;
  const data = response;

  // OpenAI format: choices[0].message.content
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (isObject(choice)) {
      if (isObject(choice.message)) {
        const content = choice.message.content;
        if (isString(content)) return content;
      }
      if (isString(choice.text)) return choice.text;
    }
  }

  // Gemini format: candidates[0].content.parts[].text
  const candidates = data.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const candidate = candidates[0];
    if (isObject(candidate) && isObject(candidate.content)) {
      const parts = candidate.content.parts;
      if (Array.isArray(parts) && parts.length > 0) {
        return parts
          .map((p) => (isObject(p) && isString(p.text) ? p.text : ''))
          .join('');
      }
    }
  }

  // Alternative formats
  if (isString(data.output_text)) return data.output_text;
  if (isString(data.text)) return data.text;
  if (isString(data.message)) return data.message;

  return null;
}

// ─── Finish Reason Extraction ────────────────────────────
function extractFinishReason(response: unknown): string | undefined {
  if (!isObject(response)) return undefined;
  const choices = response.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (isObject(choice) && isString(choice.finish_reason)) {
      return choice.finish_reason;
    }
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

    const data: unknown = await response.json();

    const content = extractContent(data);
    if (content === null) {
      logger.warn(`Could not extract content from ${modelId} response`, {
        responseKeys: isObject(data) ? Object.keys(data) : [],
      });
      throw new ProviderError(
        `Could not parse response from ${provider.label} model ${modelId}`,
        provider.id
      );
    }

    const finishReason = extractFinishReason(data);
    const model = (isObject(data) && isString(data.model) ? data.model : null) || modelId;

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
