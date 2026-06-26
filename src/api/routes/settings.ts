import { getSetting, saveSetting } from '../../db/settings.js';
import { getSessionMessages, clearSessionMemory } from '../../fusion/memory.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── Settings + Memory Routes ────────────────────────────
export function registerSettingsRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

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

  f.get('/memory/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const messages = await getSessionMessages(sessionId);
    return { sessionId, messages };
  });

  f.delete('/memory/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    await clearSessionMemory(sessionId);
    return { success: true };
  });
}
