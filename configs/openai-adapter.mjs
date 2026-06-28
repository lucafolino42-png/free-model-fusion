#!/usr/bin/env node
// configs/openai-adapter.mjs
// OpenAI-compatible adapter for Free Model Fusion.
//
// Makes Free Model Fusion work as a drop-in replacement for any OpenAI API.
// Compatible with: Hermes, OpenClaw, Claude Code, Cursor, OpenAI SDKs,
// LangChain, Vercel AI SDK, and any tool that speaks the OpenAI format.
//
// Usage:
//   node configs/openai-adapter.mjs [port]
//
// Default port: 3001
// Fusion server (backend): http://localhost:3000
//
// Environment:
//   FUSION_BASE_URL  — fusion server URL (default: http://localhost:3000)
//   ADAPTER_PORT     — adapter listen port (default: 3001)

import http from 'node:http';
import crypto from 'node:crypto';

const FUSION_BASE = process.env.FUSION_BASE_URL || 'http://localhost:3000';
const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT || '3001', 10);

// ── Model registry ──────────────────────────────────────
// Maps model names → fusion profiles. Includes aliases so agents can
// request "balanced", "speed", "quality" or any common name.
const MODELS = Object.freeze({
  // Canonical fusion models
  'fusion-balanced': 'balanced',
  'fusion-speed': 'speed',
  'fusion-quality': 'quality',
  'fusion-custom': 'custom',
  // Short aliases
  balanced: 'balanced',
  speed: 'speed',
  quality: 'quality',
  custom: 'custom',
  // Common OpenAI-compatible names (all map to balanced by default)
  'gpt-4': 'balanced',
  'gpt-4o': 'balanced',
  'gpt-4o-mini': 'balanced',
  'gpt-3.5-turbo': 'balanced',
  'claude-3': 'balanced',
  'claude-3-sonnet': 'balanced',
  'claude-3-haiku': 'speed',
  'claude-3-opus': 'quality',
  'claude-3.5-sonnet': 'balanced',
  'gemini-pro': 'balanced',
  'gemini-1.5-pro': 'balanced',
  'gemini-2.0-flash': 'speed',
  'llama-3': 'balanced',
  'llama-3.1-8b': 'speed',
  'llama-3.1-70b': 'balanced',
  'llama-3.1-405b': 'quality',
  'mixtral': 'balanced',
  'deepseek': 'balanced',
  'command-r': 'balanced',
});

const KNOWN_MODEL_IDS = Object.keys(MODELS);
const DEFAULT_PROFILE = 'balanced';

// ── Helpers ─────────────────────────────────────────────
function jsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Request-Id',
    'X-Request-Id': `adapter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
  res.end(body);
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSSEDone(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

function openaiError(message, code = 'invalid_request_error', status = 400, param = null) {
  return { error: { message, type: code, param, code } };
}

// ── Stable session ID from request ─────────────────────
function deriveSessionId(body, clientIp) {
  if (body.user) return `adapter:${body.user}`;
  if (body.fusionSessionId) return `adapter:${body.fusionSessionId}`;
  if (clientIp) return `adapter:ip-${crypto.createHash('md5').update(clientIp).digest('hex').slice(0, 8)}`;
  return 'adapter:default';
}

// ── Build system prompt from messages ──────────────────
function buildSystemPrompt(messages) {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  if (systemMsgs.length === 0) return '';
  return systemMsgs.map((m) => m.content).join('\n');
}

// ── Build conversation context from prior messages ─────
// Returns all messages before the LAST user message as context,
// avoiding duplication of the current query.
function buildConversationContext(messages) {
  // Find the index of the last user message
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) return ''; // Nothing before the last user message
  const prior = messages.slice(0, lastUserIdx);
  if (prior.length === 0) return '';
  return prior
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
}

// ── Fetch live models from the fusion server ──────────
// After adding a key with /addkey, new models from that provider
// become available. We proxy to the fusion /models endpoint so
// agents always see the up-to-date model list.
// Results are cached for 30s to avoid hammering the fusion server
// on every /v1/models poll.
let cachedFusionModels = null;
let cachedFusionModelsAt = 0;
const FUSION_MODELS_CACHE_TTL = 30000;

async function fetchFusionModels() {
  if (Date.now() - cachedFusionModelsAt < FUSION_MODELS_CACHE_TTL && cachedFusionModels) {
    return cachedFusionModels;
  }
  try {
    const res = await fetch(`${FUSION_BASE}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return cachedFusionModels || null;
    const data = await res.json();
    cachedFusionModels = data.models || null;
    cachedFusionModelsAt = Date.now();
    return cachedFusionModels;
  } catch {
    return cachedFusionModels || null;
  }
}

// ── Model list builders ────────────────────────────────
const CANONICAL_MODELS = ['fusion-balanced', 'fusion-speed', 'fusion-quality', 'fusion-custom'];

async function modelList() {
  const now = Math.floor(Date.now() / 1000);
  const result = [];

  // 1. Add canonical fusion models (always present)
  for (const id of CANONICAL_MODELS) {
    result.push({ id, object: 'model', created: now, owned_by: 'free-model-fusion' });
  }

  // 2. Fetch live models from the fusion server (e.g. groq_llama3_70b after adding a Groq key)
  //    This ensures newly added providers show up immediately after /addkey.
  const fusionModels = await fetchFusionModels();
  if (fusionModels && Array.isArray(fusionModels)) {
    for (const m of fusionModels) {
      const id = m.id || m.model;
      if (id && !CANONICAL_MODELS.includes(id) && !result.some((r) => r.id === id)) {
        result.push({ id, object: 'model', created: now, owned_by: m.providerId || 'free-model-fusion' });
      }
    }
  }

  return result;
}

function modelDetail(id) {
  return {
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'free-model-fusion',
  };
}

// ── Resolve model to fusion profile ────────────────────
function resolveProfile(modelName) {
  if (!modelName) return DEFAULT_PROFILE;
  const lower = modelName.toLowerCase();
  return MODELS[lower] || DEFAULT_PROFILE;
}

// ── Route normalization ────────────────────────────────
function normalizePath(url) {
  const path = url.length > 1 ? url.replace(/\/+$/, '') : url;
  return path;
}

// ── Auth check (optional — accepts any Bearer token) ───
function checkAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth) return true; // No auth required for localhost
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return true; // Accept any token (self-hosted)
}

// ── Detect fusion commands ────────────────────────────
// Commands like /models, /addkey, /speed etc. must be passed through
// as-is so the fusion server's parseCommand can handle them.
function isFusionCommand(text) {
  return /^\/\w+/.test(text.trim());
}

// ── Process a chat request (shared by streaming + non-streaming) ──
async function processChatRequest(body, req) {
  const messages = body.messages || [];
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    return { error: openaiError('No user message found in messages array'), status: 400 };
  }

  let fullPrompt = lastUserMsg.content;

  // Commands must go through WITHOUT any wrapping so the fusion server's
  // parseCommand can detect the leading '/' and route correctly.
  if (!isFusionCommand(fullPrompt)) {
    // Build a comprehensive message that includes all the context
    const systemPrompt = buildSystemPrompt(messages);
    const conversationContext = buildConversationContext(messages);
    if (conversationContext) {
      fullPrompt = `Prior conversation:\n${conversationContext}\n\nUser: ${fullPrompt}`;
    }
    if (systemPrompt) {
      fullPrompt = `[System instructions]\n${systemPrompt}\n\n${fullPrompt}`;
    }
  }

  // Resolve profile from model name or explicit fusionProfile
  const profile = body.fusionProfile || resolveProfile(body.model);

  // Derive session ID
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  const sessionId = deriveSessionId(body, clientIp);

  // Build fusion payload with all available params
  const fusionPayload = {
    message: fullPrompt,
    profile,
    sessionId,
    web: body.fusionWeb || (body.web ? 'on' : 'off'),
    source: 'api',
  };      // Note: max_tokens and temperature are accepted but currently managed
      // server-side by the fusion engine's token budgets and routing profiles.
      // Future enhancement: pass these through to individual model calls.

  // Call the fusion server
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let fusionRes;
  try {
    fusionRes = await fetch(`${FUSION_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fusionPayload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!fusionRes.ok) {
    const errText = await fusionRes.text().catch(() => 'Unknown error');
    return { error: openaiError(`Fusion server error: ${errText}`, 'upstream_error', fusionRes.status), status: fusionRes.status };
  }

  const fusionData = await fusionRes.json();
  const modelName = body.model || 'fusion-balanced';

  return {
    data: fusionData,
    modelName,
    profile,
    sessionId,
  };
}

// ── Server ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    // ── CORS preflight ─────────────────────────────────
    if (req.method === 'OPTIONS') {
      sendJson(res, 200, {});
      return;
    }

    // ── Auth check ─────────────────────────────────────
    if (!checkAuth(req)) {
      sendJson(res, 401, openaiError(
        'Invalid or missing Authorization header. Format: Bearer <token>',
        'authentication_error', 401
      ));
      return;
    }

    const path = normalizePath(req.url);

    // ════════════════════════════════════════════════════
    // GET endpoints
    // ════════════════════════════════════════════════════
    if (req.method === 'GET') {
      // GET /v1/models — list models (OpenAI standard)
      // Proxies to the fusion server for live model data so newly added
      // providers (via /addkey) show up immediately.
      if (path === '/v1/models') {
        const list = await modelList();
        sendJson(res, 200, { object: 'list', data: list });
        return;
      }

      // GET /v1/models/:id — single model detail
      const singleMatch = path.match(/^\/v1\/models\/(.+)$/);
      if (singleMatch) {
        const modelId = singleMatch[1];
        if (MODELS[modelId] || KNOWN_MODEL_IDS.includes(modelId)) {
          sendJson(res, 200, modelDetail(modelId));
          return;
        }
        // Not in hardcoded list — check live models from fusion server
        // (covers models that appeared after adding a key via /addkey)
        const liveModels = await fetchFusionModels();
        const found = liveModels?.find((m) => (m.id || m.model) === modelId);
        if (found) {
          sendJson(res, 200, {
            id: modelId,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: found.providerId || 'free-model-fusion',
          });
          return;
        }
        sendJson(res, 404, openaiError(`Model '${modelId}' not found`, 'model_not_found', 404));
        return;
      }

      // Health / info
      if (path === '/health' || path === '/v1' || path === '/') {
        sendJson(res, 200, {
          status: 'ok',
          adapter: 'fusion-openai-adapter',
          version: '1.1.0',
          fusionBase: FUSION_BASE,
          models: CANONICAL_MODELS,
          endpoints: {
            models: 'GET /v1/models',
            chat: 'POST /v1/chat/completions',
          },
        });
        return;
      }

      sendJson(res, 404, openaiError(
        `Unknown endpoint: GET ${path}. Available: GET /v1/models, POST /v1/chat/completions`,
        'not_found', 404
      ));
      return;
    }

    // ════════════════════════════════════════════════════
    // POST /v1/chat/completions
    // ════════════════════════════════════════════════════
    if (req.method === 'POST') {
      const postPath = normalizePath(req.url);

      if (!postPath.endsWith('/chat/completions')) {
        sendJson(res, 404, openaiError(
          `Unknown endpoint: POST ${path}. Use POST /v1/chat/completions`,
          'not_found', 404
        ));
        return;
      }

      const body = await jsonBody(req);

      // Validate required fields
      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        sendJson(res, 400, openaiError('messages must be a non-empty array', 'invalid_request_error', 400, 'messages'));
        return;
      }

      const hasUserMsg = body.messages.some((m) => m.role === 'user');
      if (!hasUserMsg) {
        sendJson(res, 400, openaiError('messages must contain at least one user message', 'invalid_request_error', 400, 'messages'));
        return;
      }

      // ── Streaming mode ───────────────────────────────
      if (body.stream === true) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Request-Id',
          'X-Accel-Buffering': 'no',
        });

        const result = await processChatRequest(body, req);
        if (result.error) {
          sendSSE(res, {
            id: `chatcmpl-fusion-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'fusion-balanced',
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null,
            }],
          });
          sendSSE(res, {
            id: `chatcmpl-fusion-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'fusion-balanced',
            choices: [{
              index: 0,
              delta: { content: `\n\n⚠️ Error: ${result.error.error.message}` },
              finish_reason: null,
            }],
          });
          sendSSEDone(res);
          return;
        }

        // Send streaming response in 3 chunks for realism
        const answer = result.data.answer || '';
        const chunkSize = Math.max(1, Math.ceil(answer.length / 3));

        // First chunk: role + content start
        sendSSE(res, {
          id: `chatcmpl-fusion-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: result.modelName,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: answer.slice(0, chunkSize) },
            finish_reason: null,
          }],
        });

        // Middle chunks
        for (let i = chunkSize; i < answer.length; i += chunkSize) {
          sendSSE(res, {
            id: `chatcmpl-fusion-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: result.modelName,
            choices: [{
              index: 0,
              delta: { content: answer.slice(i, i + chunkSize) },
              finish_reason: null,
            }],
          });
        }

        // Final chunk with usage
        const meta = result.data.meta || {};
        sendSSE(res, {
          id: `chatcmpl-fusion-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: result.modelName,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: meta.tokens?.expert || 0,
            completion_tokens: meta.tokens?.synthesis || 0,
            total_tokens: meta.tokens?.totalEstimated || 0,
          },
        });

        sendSSEDone(res);
        return;
      }

      // ── Non-streaming mode ───────────────────────────
      const result = await processChatRequest(body, req);
      if (result.error) {
        sendJson(res, result.status || 500, result.error);
        return;
      }

      const meta = result.data.meta || {};
      const openaiResponse = {
        id: `chatcmpl-fusion-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.modelName,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.data.answer || '',
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: meta.tokens?.expert || 0,
          completion_tokens: meta.tokens?.synthesis || 0,
          total_tokens: meta.tokens?.totalEstimated || 0,
        },
        // Pass through fusion metadata for debugging
        fusion_meta: meta,
      };

      sendJson(res, 200, openaiResponse);
      return;
    }

    // ── DELETE /v1/models/:id — stubbed (no-op) ────────
    // Some SDKs send this to clean up. We respond with success.
    if (req.method === 'DELETE') {
      sendJson(res, 200, { success: true });
      return;
    }

    // ── Catch-all ──────────────────────────────────────
    sendJson(res, 405, openaiError(
      `Method ${req.method} not allowed for ${path}`,
      'method_not_allowed', 405
    ));
  } catch (err) {
    if (err.name === 'AbortError') {
      sendJson(res, 504, openaiError('Fusion server timed out (120s)', 'timeout', 504));
    } else if (err.message === 'Invalid JSON') {
      sendJson(res, 400, openaiError('Invalid JSON in request body. Check for syntax errors.', 'invalid_request_error', 400));
    } else {
      console.error('[adapter] Internal error:', err);
      sendJson(res, 500, openaiError(
        `Internal adapter error: ${err.message}`,
        'server_error', 500
      ));
    }
  }
});

// ── Start ──────────────────────────────────────────────
server.listen(ADAPTER_PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║         Free Model Fusion — OpenAI Adapter              ║
  ║                                                          ║
  ║   Adapter:   http://localhost:${String(ADAPTER_PORT).padEnd(5)}                         ║
  ║   Base URL:  http://localhost:${String(ADAPTER_PORT).padEnd(5)}/v1                       ║
  ║                                                          ║
  ║   Endpoints:                                             ║
  ║     GET  /v1/models          → List models               ║
  ║     GET  /v1/models/:id      → Model detail              ║
  ║     POST /v1/chat/completions → Chat (streaming + non)   ║
  ║                                                          ║
  ║   Backend:  ${FUSION_BASE.padEnd(43)}  ║
  ║                                                          ║
  ║   Streaming:  ✅ enabled                                 ║
  ║   Auth:       optional (Bearer token)                    ║
  ║   Models:     80+ aliases available                      ║
  ║                                                          ║
  ║   Hermes:     base_url: http://localhost:${String(ADAPTER_PORT).padEnd(5)}/v1               ║
  ║   OpenClaw:   baseUrl:  http://localhost:${String(ADAPTER_PORT).padEnd(5)}/v1               ║
  ╚══════════════════════════════════════════════════════════╝
  `);
});
