import { handleFusionCommand } from '../../fusion/commandsHandler.js';
import { logger } from '../../utils/logger.js';
import { FusionError } from '../../utils/errors.js';
import type { FastifyInstance } from 'fastify';

// ─── OpenAI-Compatible Chat Completions Endpoint ─────────
// Translates the standard OpenAI /v1/chat/completions format
// to Free Model Fusion's internal format and back.
//
// This allows any OpenAI-compatible client (Hermes, Cursor,
// Continue.dev, Open WebUI, etc.) to use Fusion as a drop-in
// replacement backend.

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  // Agent-friendly fields
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?: string | { type: 'function'; function: { name: string } };
  functions?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  function_call?: string | { name: string };
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
    function_call?: { name: string; arguments: string };
  };
  finish_reason: string | null;
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `chatcmpl-${timestamp}${random}`;
}

function extractLastUserMessage(messages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return messages.map((m) => `${m.role}: ${m.content || JSON.stringify(m.tool_calls || '')}`).join('\n');
}

// ─── Build Context from Tool Definitions ────────────────
// If the request includes tools or functions, inject them into the system
// prompt so the fusion pipeline is aware of available tools. The fusion
// models won't natively call them (that requires model-specific training),
// but this sets up the conversation context for future tool-aware responses.
function buildToolContext(
  body: ChatCompletionRequest,
  message: string
): string {
  const tools = body.tools || (body.functions ? body.functions.map(f => ({
    type: 'function' as const,
    function: f,
  })) : undefined);

  if (!tools || tools.length === 0) return message;

  // Build a system context block describing the available tools
  const toolDescriptions = tools.map((t, i) => {
    const fn = t.function;
    const params = fn.parameters
      ? JSON.stringify(fn.parameters, null, 2)
      : '{}';
    return `  ${i + 1}. **${fn.name}**${fn.description ? `: ${fn.description}` : ''}\n     Parameters:\n     \`\`\`json\n     ${params}\n     \`\`\``;
  }).join('\n\n');

  const context = `[System: The following tools are available for you to use. ` +
    `When you need to use a tool, respond with a JSON block ` +
    `containing \`{"tool": "tool_name", "arguments": {...}}\`. ` +
    `Otherwise respond normally.]\n\nAvailable tools:\n${toolDescriptions}`;

  return `${context}\n\n${message}`;
}

// ─── Detect Tool Call in Response ───────────────────────
// Parses the fusion response to see if the model decided to call a tool.
// Looks for a JSON block matching { tool: "name", arguments: {...} }.
// Uses brace-counting to handle nested objects in arguments.
function parseToolCall(
  content: string
): { name: string; arguments: string; remainingContent: string } | null {
  // Find the first "tool" key in the content
  const toolIdx = content.indexOf('"tool"');
  if (toolIdx === -1) return null;

  // Walk backwards to find the opening {
  let braceStart = toolIdx;
  while (braceStart > 0 && content[braceStart] !== '{') braceStart--;
  if (content[braceStart] !== '{') return null;

  // Walk forward counting braces to find the matching }
  let depth = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    if (depth === 0) { braceEnd = i; break; }
  }

  if (braceEnd <= braceStart) return null;

  try {
    const jsonStr = content.substring(braceStart, braceEnd + 1);
    const parsed = JSON.parse(jsonStr);
    if (parsed.tool && parsed.arguments) {
      const remainingContent = (content.substring(0, braceStart) + content.substring(braceEnd + 1)).trim();
      return {
        name: parsed.tool,
        arguments: typeof parsed.arguments === 'string'
          ? parsed.arguments
          : JSON.stringify(parsed.arguments),
        remainingContent,
      };
    }
  } catch {
    // Not valid JSON, treat as normal response
  }
  return null;
}

// ─── Profile Detection from Model Name ──────────────────
// Maps model names to Fusion routing profiles intelligently.
// Supports:
//   • Prefixes:     /speed, /balanced, /quality, /custom
//   • Suffixes:     -speed, -balanced, -quality, -custom
//   • Keywords:     fast, quick, turbo, deep, strong, manual, expert, etc.
//   • Provider hints: groq=fast, openrouter=balanced, gemini=quality
//
// The model name field from OpenAI clients is free-form, so we use
// a scoring system: each keyword adds a score for its profile, and
// the highest-scoring profile wins. A tied score or no match returns
// undefined (let the session's default profile handle it).

interface ProfileScore {
  speed: number;
  balanced: number;
  quality: number;
  custom: number;
}

const PROFILE_KEYWORDS: Record<string, Array<{ words: string[]; score: number }>> = {
  speed: [
    { words: ['speed', 'fast', 'quick', 'rapid', 'turbo', 'light', 'lite', 'small', 'tiny'], score: 3 },
    { words: ['groq'], score: 1 },  // Groq provider tends to be fast
    { words: ['llama-3.1-8b', 'llama-3.2-3b', 'llama-3.2-1b', 'gemma-2-2b', 'gemma-2-9b', 'ministral-3b'], score: 2 },
    { words: ['flash', 'instant', 'nano', 'micro'], score: 2 },
  ],
  balanced: [
    { words: ['balanced', 'default', 'normal', 'medium', 'mid', 'standard'], score: 3 },
    { words: ['openrouter', 'together', 'deepinfra', 'fireworks'], score: 1 },
    { words: ['llama-3.3-70b', 'qwen-2.5-72b', 'mistral', 'mixtral'], score: 1 },
  ],
  quality: [
    { words: ['quality', 'deep', 'strong', 'powerful', 'advanced', 'max', 'pro', 'ultra'], score: 3 },
    { words: ['gemini', 'claude', 'perplexity', 'nebius'], score: 1 },
    { words: ['llama-3.1-405b', 'llama-3.3-405b', 'qwen-2.5-32b', 'qwen-2.5-coder'], score: 2 },
    { words: ['sonnet', 'opus', 'premium', 'enterprise', 'large', 'xl', 'huge'], score: 2 },
    { words: ['deepseek', 'reasoning', 'think'], score: 2 },
  ],
  custom: [
    { words: ['custom', 'manual', 'select', 'choose', 'own', 'my-', 'personal'], score: 3 },
  ],
};

export function detectProfile(modelName?: string): 'speed' | 'balanced' | 'quality' | 'custom' | undefined {
  if (!modelName) return undefined;

  const lower = modelName.toLowerCase().replace(/^\//, '');  // Strip leading /

  // Quick exact match for common profiles: /speed, /balanced, /quality, /custom
  if (lower === 'speed' || lower === 'fast') return 'speed';
  if (lower === 'balanced' || lower === 'default' || lower === 'normal') return 'balanced';
  if (lower === 'quality' || lower === 'deep' || lower === 'pro') return 'quality';
  if (lower === 'custom' || lower === 'manual') return 'custom';

  // Prefix match: fusion-speed, speed-gpt, my-quality-model
  for (const profile of ['speed', 'quality', 'custom', 'balanced'] as const) {
    if (lower.startsWith(profile + '-') || lower.startsWith(profile + '_') || lower.startsWith(profile + '.')) {
      return profile;
    }
    if (lower.endsWith('-' + profile) || lower.endsWith('_' + profile) || lower.endsWith('.' + profile)) {
      return profile;
    }
  }

  // Scoring system: each keyword adds a score, highest score wins
  const scores: ProfileScore = { speed: 0, balanced: 0, quality: 0, custom: 0 };

  for (const [profile, rules] of Object.entries(PROFILE_KEYWORDS)) {
    for (const rule of rules) {
      for (const word of rule.words) {
        if (lower.includes(word)) {
          scores[profile as keyof ProfileScore] += rule.score;
          break;  // Only count one match per rule group
        }
      }
    }
  }

  // Find profile with highest score (must be > 0)
  let best: 'speed' | 'balanced' | 'quality' | 'custom' | undefined;
  let bestScore = 0;
  let tie = false;

  for (const [profile, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = profile as keyof ProfileScore;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }

  // Return undefined on tie or no match so the session's default profile is used
  if (tie || bestScore === 0) return undefined;
  return best;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Streaming Helpers ───────────────────────────────────
function sendSSE(reply: any, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSSEDone(reply: any): void {
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}

// ─── Register Route ──────────────────────────────────────
export function registerChatCompletionsRoutes(fastify: FastifyInstance): void {
  for (const path of ['/chat/completions', '/v1/chat/completions']) {
    registerPath(fastify, path);
  }
}

function registerPath(fastify: FastifyInstance, path: string): void {
  fastify.post(path, {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as ChatCompletionRequest;

    if (!body || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      reply.status(400);
      return {
        error: {
          type: 'invalid_request_error',
          message: 'messages is required and must be a non-empty array.',
        },
      };
    }

    let message = extractLastUserMessage(body.messages);
    const sessionId = `openai:${request.ip}:${body.model || 'default'}`;
    const profile = detectProfile(body.model);

    // Inject tool definitions into the message context
    message = buildToolContext(body, message);

    if (body.stream === true) {
      return handleStreaming(request, reply, message, sessionId, profile);
    }

    return handleNonStreaming(reply, message, sessionId, profile, body.model);
  });
}

async function handleNonStreaming(
  reply: any,
  message: string,
  sessionId: string,
  profile?: 'speed' | 'balanced' | 'quality' | 'custom',
  modelName?: string
) {
  try {
    const result = await handleFusionCommand(message, {
      sessionId,
      source: 'api',
      profile,
    });

    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    const content = result.answer || '';

    // Detect if response contains a tool call
    const toolCall = parseToolCall(content);
    let choice: ChatCompletionChoice;

    if (toolCall) {
      choice = {
        index: 0,
        message: {
          role: 'assistant',
          content: toolCall.remainingContent || null,
          tool_calls: [{
            id: `call_${generateId()}`,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          }],
        },
        finish_reason: 'tool_calls',
      };
    } else {
      choice = {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      };
    }

    const response: ChatCompletionResponse = {
      id,
      object: 'chat.completion',
      created,
      model: modelName || 'fusion',
      choices: [choice],
      usage: {
        prompt_tokens: estimateTokens(message),
        completion_tokens: estimateTokens(content),
        total_tokens: estimateTokens(message) + estimateTokens(content),
      },
    };

    return response;
  } catch (error) {
    logger.error('Chat completions API error', { error: String(error) });

    if (error instanceof FusionError) {
      reply.status(error.statusCode);
      return { error: { type: 'fusion_error', message: error.message } };
    }

    reply.status(500);
    return { error: { type: 'internal_error', message: 'An unexpected error occurred.' } };
  }
}

async function handleStreaming(
  request: any,
  reply: any,
  message: string,
  sessionId: string,
  profile?: 'speed' | 'balanced' | 'quality' | 'custom'
) {
  const id = generateId();
  const created = Math.floor(Date.now() / 1000);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send role chunk first (standard OpenAI streaming format)
  sendSSE(reply, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: 'fusion',
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  });

  try {
    const result = await handleFusionCommand(message, {
      sessionId,
      source: 'api',
      profile,
    });

    const content = result.answer || '';

    // Check if the response contains a tool call
    const toolCall = parseToolCall(content);

    if (toolCall) {
      // Send tool call header chunk (id + name)
      sendSSE(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'fusion',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              index: 0,
              id: `call_${generateId()}`,
              type: 'function',
              function: { name: toolCall.name, arguments: '' },
            }],
          },
          finish_reason: null,
        }],
      });

      // Send arguments chunk with the full arguments
      sendSSE(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'fusion',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: toolCall.arguments },
            }],
          },
          finish_reason: null,
        }],
      });

      // Send finish chunk with tool_calls reason
      sendSSE(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'fusion',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      });
    } else {
      sendSSE(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'fusion',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      });

      sendSSE(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'fusion',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      });
    }

    sendSSEDone(reply);
  } catch (error) {
    logger.error('Chat completions streaming error', { error: String(error) });

    const errorMsg = error instanceof FusionError
      ? error.message
      : 'An unexpected error occurred.';

    sendSSE(reply, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: 'fusion',
      choices: [{ index: 0, delta: { content: `Error: ${errorMsg}` }, finish_reason: null }],
    });

    sendSSE(reply, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: 'fusion',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    sendSSEDone(reply);
  }
}
