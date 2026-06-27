import fs from 'fs';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { maskValue, ENV_FILE } from './_shared.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const ENV_KEYS = [
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

const PROVIDER_KEY_MAP: Record<string, string> = {
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

// ─── Environment Variable Routes ─────────────────────────
export function registerEnvRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get('/api/env', async () => {
    const vars: Array<{ key: string; value: string; source: string }> = [];
    for (const key of ENV_KEYS) {
      const val = process.env[key] || '';
      vars.push({
        key,
        value: val ? maskValue(key, val) : '',
        source: val ? 'env' : 'unset',
      });
    }
    return { variables: vars };
  });

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

    const allowedPrefixes = ['FUSION_', 'TELEGRAM_', 'TAVILY_', 'PORT', 'NODE_ENV', 'DATABASE_URL'];
    const isAllowed = allowedPrefixes.some(p => key === p || key.startsWith(p)) ||
      key.endsWith('_API_KEY');

    if (!isAllowed) {
      reply.status(403);
      return { error: `Key '${key}' is not allowed to be modified via API.` };
    }

    try {
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
      process.env[key] = value;

      if (key.startsWith('FUSION_') || key.endsWith('_API_KEY')) {
        const providerId = PROVIDER_KEY_MAP[key];
        if (providerId && providerId in config.providerEnvKeys) {
          config.providerEnvKeys[providerId] = value;
        }
        if (key === 'TAVILY_API_KEY') {
          (config as Record<string, unknown>).tavilyApiKey = value;
        }
      }

      // Telegram: the polling loop reads this on every iteration (see
      // src/telegram/bot.ts), but we also propagate to config for callers
      // that read config.telegramBotToken directly (e.g. setTelegramWebhook).
      if (key === 'TELEGRAM_BOT_TOKEN') {
        (config as Record<string, unknown>).telegramBotToken = value;
      }

      logger.info(`Environment variable updated via API: ${key}`);
      return { success: true, key, maskedValue: maskValue(key, value) };
    } catch (error) {
      reply.status(500);
      return { error: `Failed to update ${key}: ${String(error)}` };
    }
  });
}
