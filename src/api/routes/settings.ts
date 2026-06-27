import { getSetting, saveSetting } from '../../db/settings.js';
import {
  getSessionMessages,
  clearSessionMemory,
  getOrCreateSession,
  updateSessionSettings,
} from '../../fusion/memory.js';
import { config } from '../../config.js';
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
      if (value === undefined) continue;
      await saveSetting(key, String(value));

      // Live-mutate config so token budgets and similar take effect on the
      // next request (no server restart). Mirrors the pattern from the
      // Telegram fix (see src/api/routes/env.ts).
      if (key === 'expertMaxTokens') {
        (config as Record<string, unknown>).expertMaxTokens = Number(value);
      } else if (key === 'judgeMaxTokens') {
        (config as Record<string, unknown>).judgeMaxTokens = Number(value);
      } else if (key === 'synthesisMaxTokens') {
        (config as Record<string, unknown>).synthesisMaxTokens = Number(value);
      } else if (key === 'continuationMaxTokens') {
        (config as Record<string, unknown>).continuationMaxTokens = Number(value);
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

  // ─── Session custom-experts (F3 fix) ──────────────────────
  // Lets users pick which models participate in the expert panel without
  // knowing chat commands. Sets the array and switches profile to 'custom'
  // when non-empty (leaves profile alone when clearing — user controls it
  // via the profile dropdown).
  f.get('/session/:sessionId/preferredExperts', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await getOrCreateSession(sessionId, 'api');
    return {
      sessionId,
      preferredExperts: session.preferredExperts,
      profile: session.profile,
    };
  });

  f.put('/session/:sessionId/preferredExperts', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { preferredExperts: unknown };

    // Runtime validation: must be an array of strings (max 32 models).
    if (!Array.isArray(body.preferredExperts)) {
      reply.status(400);
      return { error: 'preferredExperts must be an array of model ids' };
    }
    if (!body.preferredExperts.every((m) => typeof m === 'string')) {
      reply.status(400);
      return { error: 'preferredExperts must be an array of strings' };
    }
    const list = body.preferredExperts as string[];
    if (list.length > 32) {
      reply.status(400);
      return { error: 'preferredExperts exceeds 32 items' };
    }

    // Ensure the session exists so we can update it.
    await getOrCreateSession(sessionId, 'api');

    // Switching profile to 'custom' when picking a custom combo, so the
    // router actually honors preferredExperts. When clearing, leave the
    // current profile in place.
    const updates: { preferredExperts: string[]; profile?: 'custom' } = {
      preferredExperts: list,
    };
    if (list.length > 0) {
      updates.profile = 'custom';
    }
    await updateSessionSettings(sessionId, updates);

    const session = await getOrCreateSession(sessionId, 'api');
    return {
      sessionId,
      preferredExperts: session.preferredExperts,
      profile: session.profile,
    };
  });
}
