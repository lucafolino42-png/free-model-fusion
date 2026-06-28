import { saveCredential, deleteCredential, listCredentials } from '../../providers/credentials.js';
import { config } from '../../config.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── API Key Routes ──────────────────────────────────────
export function registerKeyRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

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
      // Tavily key needs to be live-updated in config so web search works immediately
      // and GET /settings reflects it via tavilyKeyConfigured.
      if (body.providerId === 'tavily') {
        Object.assign(config, { tavilyApiKey: body.apiKey });
      }
      reply.status(201);
      return { success: true, providerId: body.providerId };
    } catch (error) {
      reply.status(400);
      return { error: String(error) };
    }
  });

  f.delete('/keys/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const success = await deleteCredential(providerId);
    if (!success) {
      reply.status(404);
      return { error: `Key for ${providerId} not found` };
    }
    // Clear in-memory config for Tavily so warnings reappear.
    if (providerId === 'tavily') {
      Object.assign(config, { tavilyApiKey: '' });
    }
    return { success: true };
  });

  f.get('/keys', async () => {
    const keys = await listCredentials();
    return { keys };
  });
}
