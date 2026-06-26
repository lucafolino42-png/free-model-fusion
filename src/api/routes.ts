import { handleFusionCommand } from '../fusion/commandsHandler.js';
import { getAllProviders, getAllModels, addCustomProvider, deleteCustomProvider, setProviderEnabled } from '../providers/registry.js';
import { saveCredential, deleteCredential, listCredentials } from '../providers/credentials.js';
import { getSessionMessages } from '../fusion/memory.js';
import { getSetting, saveSetting } from '../db/settings.js';
import { db } from '../db/client.js';
import { customModels } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { FusionError } from '../utils/errors.js';
import { validateProviderUrl } from '../utils/validateUrl.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const ENV_FILE = path.resolve(__dirname, '../../.env');

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  // ─── Health Check ──────────────────────────────────────
  f.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            version: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: '1.0.0',
    };
  });

  // ─── Chat ──────────────────────────────────────────────
  f.post('/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 10000 },
          sessionId: { type: 'string', maxLength: 200 },
          profile: { type: 'string', enum: ['speed', 'balanced', 'quality', 'custom'] },
          web: { type: 'string', enum: ['on', 'off', 'auto'] },
          source: { type: 'string', enum: ['api', 'webhook'] },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      message: string;
      sessionId?: string;
      profile?: 'speed' | 'balanced' | 'quality' | 'custom';
      web?: 'on' | 'off' | 'auto';
      source?: 'api' | 'webhook';
    };

    try {
      const result = await handleFusionCommand(body.message, {
        sessionId: body.sessionId,
        source: body.source || 'api',
        profile: body.profile,
        web: body.web,
      });

      return result;
    } catch (error) {
      logger.error('Chat API error', { error: String(error) });

      if (error instanceof FusionError) {
        reply.status(error.statusCode);
        return {
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }

      reply.status(500);
      return {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
      };
    }
  });

  // ─── Webhook Chat ──────────────────────────────────────
  f.post('/webhook/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 10000 },
          sessionId: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { message: string; sessionId?: string };

    try {
      const result = await handleFusionCommand(body.message, {
        sessionId: body.sessionId,
        source: 'webhook',
      });

      return result;
    } catch (error) {
      logger.error('Webhook chat error', { error: String(error) });

      if (error instanceof FusionError) {
        reply.status(error.statusCode);
        return { error: { code: error.code, message: error.message } };
      }

      reply.status(500);
      return { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
    }
  });

  // ─── List Providers ────────────────────────────────────
  f.get('/providers', async () => {
    const providers = await getAllProviders();
    return { providers };
  });

  // ─── Add Provider ──────────────────────────────────────
  f.post('/providers', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'endpoint'],
        properties: {
          id: { type: 'string', maxLength: 100 },
          label: { type: 'string', maxLength: 200 },
          endpoint: { type: 'string', maxLength: 500 },
          speedClass: { type: 'string', maxLength: 20 },
          qualityClass: { type: 'string', maxLength: 20 },
          maxOutputTokens: { type: 'number', minimum: 1, maximum: 100000 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      id: string;
      label?: string;
      endpoint: string;
      speedClass?: string;
      qualityClass?: string;
      maxOutputTokens?: number;
    };

    try {
      // Validate URL for SSRF prevention
      validateProviderUrl(body.endpoint);

      await addCustomProvider({
        id: body.id,
        label: body.label || body.id,
        endpoint: body.endpoint,
        speedClass: body.speedClass,
        qualityClass: body.qualityClass,
        maxOutputTokens: body.maxOutputTokens,
      });
      reply.status(201);
      return { success: true, providerId: body.id };
    } catch (error) {
      reply.status(400);
      return { error: String(error) };
    }
  });

  // ─── Delete Provider ───────────────────────────────────
  f.delete('/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = await deleteCustomProvider(id);

    if (!success) {
      reply.status(404);
      return { error: `Provider ${id} not found` };
    }

    return { success: true };
  });

  // ─── Toggle Provider ───────────────────────────────────
  f.patch('/providers/:id/toggle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { enabled: boolean };

    const success = await setProviderEnabled(id, body.enabled);

    if (!success) {
      reply.status(404);
      return { error: `Provider ${id} not found or cannot be modified` };
    }

    return { success: true, enabled: body.enabled };
  });

  // ─── List Models ───────────────────────────────────────
  f.get('/models', async () => {
    const models = await getAllModels();
    return { models };
  });

  // ─── Add Model ─────────────────────────────────────────
  f.post('/models', {
    schema: {
      body: {
        type: 'object',
        required: ['provider', 'key', 'model'],
        properties: {
          provider: { type: 'string', maxLength: 100 },
          key: { type: 'string', maxLength: 100 },
          title: { type: 'string', maxLength: 200 },
          model: { type: 'string', maxLength: 200 },
          useAs: { type: 'array', items: { type: 'string', maxLength: 20 }, maxItems: 10 },
          speedClass: { type: 'string', maxLength: 20 },
          qualityClass: { type: 'string', maxLength: 20 },
          maxOutputTokens: { type: 'number', minimum: 1, maximum: 100000 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      provider: string;
      key: string;
      title?: string;
      model: string;
      useAs?: string[];
      speedClass?: string;
      qualityClass?: string;
      maxOutputTokens?: number;
    };

    try {
      await db.insert(customModels).values({
        id: body.key,
        providerId: body.provider,
        title: body.title || body.key,
        model: body.model,
        useAs: JSON.stringify(body.useAs || ['expert']),
        enabled: true,
        speedClass: body.speedClass || 'medium',
        qualityClass: body.qualityClass || 'good',
        maxOutputTokens: body.maxOutputTokens || 8192,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      reply.status(201);
      return { success: true, modelKey: body.key };
    } catch (error) {
      reply.status(400);
      return { error: String(error) };
    }
  });

  // ─── Delete Model ──────────────────────────────────────
  f.delete('/models/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const { eq } = await import('drizzle-orm');

    const result = await db
      .delete(customModels)
      .where(eq(customModels.id, key))
      .returning();

    if (result.length === 0) {
      reply.status(404);
      return { error: `Model ${key} not found` };
    }

    return { success: true };
  });

  // ─── Add API Key ───────────────────────────────────────
  f.post('/keys', {
    schema: {
      body: {
        type: 'object',
        required: ['providerId', 'apiKey'],
        properties: {
          providerId: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { providerId: string; apiKey: string };

    try {
      await saveCredential(body.providerId, body.apiKey);
      reply.status(201);
      return { success: true, providerId: body.providerId };
    } catch (error) {
      reply.status(400);
      return { error: String(error) };
    }
  });

  // ─── Add API Key schema (max length) ───────────────────
  // Provider IDs and API keys are validated in routes

  // ─── Delete API Key ────────────────────────────────────
  f.delete('/keys/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const success = await deleteCredential(providerId);

    if (!success) {
      reply.status(404);
      return { error: `Key for ${providerId} not found` };
    }

    return { success: true };
  });

  // ─── List API Keys ─────────────────────────────────────
  f.get('/keys', async () => {
    const keys = await listCredentials();
    return { keys };
  });

  // ─── Get Settings ──────────────────────────────────────
  f.get('/settings', async () => {
    const profile = await getSetting('profile');
    const webMode = await getSetting('webMode');
    const expertMaxTokens = await getSetting('expertMaxTokens');
    const judgeMaxTokens = await getSetting('judgeMaxTokens');
    const synthesisMaxTokens = await getSetting('synthesisMaxTokens');

    return {
      settings: {
        profile: profile || 'balanced',
        webMode: webMode || 'off',
        expertMaxTokens: expertMaxTokens ? parseInt(expertMaxTokens, 10) : 2500,
        judgeMaxTokens: judgeMaxTokens ? parseInt(judgeMaxTokens, 10) : 1800,
        synthesisMaxTokens: synthesisMaxTokens ? parseInt(synthesisMaxTokens, 10) : 5000,
      },
    };
  });

  // ─── Update Settings ───────────────────────────────────
  f.post('/settings', {
    schema: {
      body: {
        type: 'object',
        properties: {
          profile: { type: 'string', enum: ['speed', 'balanced', 'quality', 'custom'] },
          webMode: { type: 'string', enum: ['on', 'off', 'auto'] },
          expertMaxTokens: { type: 'number' },
          judgeMaxTokens: { type: 'number' },
          synthesisMaxTokens: { type: 'number' },
        },
      },
    },
  }, async (request) => {
    const body = request.body as Record<string, unknown>;

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        await saveSetting(key, String(value));
      }
    }

    return { success: true };
  });

  // ─── Memory ────────────────────────────────────────────
  f.get('/memory/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const messages = await getSessionMessages(sessionId);
    return { sessionId, messages };
  });

  // ─── Clear Memory ──────────────────────────────────────
  f.delete('/memory/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const { clearSessionMemory } = await import('../fusion/memory.js');
    await clearSessionMemory(sessionId);
    return { success: true };
  });

  // ─── Favicon ──────────────────────────────────────────
  f.get('/favicon.ico', async (request, reply) => {
    try {
      const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
      const svg = fs.readFileSync(faviconPath, 'utf-8');
      reply.type('image/svg+xml').send(svg);
    } catch {
      reply.status(404).send();
    }
  });

  // ─── UI Root ───────────────────────────────────────────
  f.get('/', async (request, reply) => {
    try {
      const htmlPath = path.join(PUBLIC_DIR, 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      reply.type('text/html').send(html);
    } catch {
      reply.status(200).send(`
<!DOCTYPE html><html><head><title>Free Model Fusion</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#fff}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px;text-align:center;max-width:420px}
h1{font-size:24px;margin:0 0 8px;background:linear-gradient(135deg,#818cf8,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#94a3b8;margin:0 0 24px}.badge{display:inline-block;background:#22c55e20;color:#4ade80;padding:4px 12px;border-radius:999px;font-size:13px}
</style></head><body><div class="card">
<h1>Free Model Fusion</h1>
<p>UI not found. Run the app from the <code>free-model-fusion</code> directory.</p>
<span class="badge">Server running</span>
</div></body></html>`);
    }
  });

  // ─── List Environment Variables (masked) ───────────────
  f.get('/api/env', async () => {
    const vars: Array<{ key: string; value: string; source: string }> = [];
    const envKeys = [
      'PORT', 'NODE_ENV', 'DATABASE_URL', 'FUSION_SECRET_KEY',
      'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_URL', 'TAVILY_API_KEY',
      'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY',
      'CEREBRAS_API_KEY', 'NVIDIA_NIM_API_KEY', 'TOGETHER_API_KEY',
      'FIREWORKS_API_KEY', 'DEEPINFRA_API_KEY', 'NOVITA_API_KEY',
      'HYPERBOLIC_API_KEY', 'SAMBANOVA_API_KEY', 'PERPLEXITY_API_KEY',
      'NEBIUS_API_KEY', 'FUSION_DEFAULT_PROFILE', 'FUSION_MAX_EXPERTS',
      'FUSION_EXPERT_MAX_TOKENS', 'FUSION_JUDGE_MAX_TOKENS',
      'FUSION_SYNTHESIS_MAX_TOKENS', 'FUSION_CONTINUATION_MAX_TOKENS',
    ];

    for (const key of envKeys) {
      const val = process.env[key] || '';
      vars.push({
        key,
        value: val ? maskValue(key, val) : '',
        source: val ? 'env' : 'unset',
      });
    }

    return { variables: vars };
  });

  // ─── Update Environment Variable ───────────────────────
  f.post('/api/env', {
    schema: {
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string', maxLength: 100 },
          value: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { key: string; value: string };
    const { key, value } = body;

    // Security: restrict to known env keys
    const allowedPrefixes = ['FUSION_', 'TELEGRAM_', 'TAVILY_', 'PORT', 'NODE_ENV', 'DATABASE_URL'];
    const isAllowed = allowedPrefixes.some(p => key === p || key.startsWith(p)) ||
      key.endsWith('_API_KEY');

    if (!isAllowed) {
      reply.status(403);
      return { error: `Key '${key}' is not allowed to be modified via API.` };
    }

    try {
      // Read existing .env
      let envContent = '';
      try {
        envContent = fs.readFileSync(ENV_FILE, 'utf-8');
      } catch {
        envContent = '';
      }

      const lines = envContent.split('\n');
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRegex = new RegExp('^' + escapedKey + '\\s*=');
      let found = false;
      const newLines = lines.map(line => {
        const trimmed = line.trim();
        if (keyRegex.test(trimmed)) {
          found = true;
          return `${key}=${value}`;
        }
        return line;
      });

      if (!found) {
        newLines.push(`${key}=${value}`);
      }

      fs.writeFileSync(ENV_FILE, newLines.join('\n') + '\n', 'utf-8');

      // Update current process env
      process.env[key] = value;

      // Also update in-memory config
      if (key.startsWith('FUSION_') || key.endsWith('_API_KEY')) {
        // Update provider env keys
        const providerMap: Record<string, string> = {
          OPENROUTER_API_KEY: 'openrouter',
          GROQ_API_KEY: 'groq',
          GEMINI_API_KEY: 'gemini',
          CEREBRAS_API_KEY: 'cerebras',
          NVIDIA_NIM_API_KEY: 'nvidia_nim',
          TOGETHER_API_KEY: 'together',
          FIREWORKS_API_KEY: 'fireworks',
          DEEPINFRA_API_KEY: 'deepinfra',
          NOVITA_API_KEY: 'novita',
          HYPERBOLIC_API_KEY: 'hyperbolic',
          SAMBANOVA_API_KEY: 'sambanova',
          PERPLEXITY_API_KEY: 'perplexity',
          NEBIUS_API_KEY: 'nebius',
        };
        const providerId = providerMap[key];
        if (providerId && providerId in config.providerEnvKeys) {
          (config.providerEnvKeys as Record<string, string>)[providerId] = value;
        }
        if (key === 'TAVILY_API_KEY') {
          (config as Record<string, unknown>).tavilyApiKey = value;
        }
      }

      logger.info(`Environment variable updated via API: ${key}`);
      return { success: true, key, maskedValue: maskValue(key, value) };
    } catch (error) {
      reply.status(500);
      return { error: `Failed to update ${key}: ${String(error)}` };
    }
  });
}

function maskValue(key: string, value: string): string {
  if (key.endsWith('_API_KEY') || key === 'FUSION_SECRET_KEY' || key === 'TELEGRAM_BOT_TOKEN') {
    if (value.length <= 8) return '***';
    return value.slice(0, 4) + '****' + value.slice(-4);
  }
  return value;
}
