import { getAllProviders, addCustomProvider, deleteCustomProvider, setProviderEnabled, getProviderById } from '../../providers/registry.js';
import { validateProviderUrl } from '../../utils/validateUrl.js';
import { callModel } from '../../providers/modelClient.js';
import { logger } from '../../utils/logger.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── Provider Routes ─────────────────────────────────────
export function registerProviderRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get('/providers', async () => {
    const providers = await getAllProviders();
    return { providers };
  });

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

  f.delete('/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = await deleteCustomProvider(id);
    if (!success) {
      reply.status(404);
      return { error: `Provider ${id} not found` };
    }
    return { success: true };
  });

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

    // ─── Provider Health Check ─────────────────────────────────
    // Tests each provider's API key and endpoint with a minimal call.
    // Returns per-provider status, latency, and error details.
    f.get('/providers/health', async () => {
      const providers = await getAllProviders();
      const results = await Promise.all(
        providers.map(async (provider) => {
          const hasKey = await (await import('../../providers/credentials.js')).hasCredential(provider.credentialRef);
          if (!hasKey) {
            return {
              provider: provider.id,
              label: provider.label,
              status: 'no_key',
              latencyMs: null,
              error: 'No API key configured',
            };
          }

          // Get the first enabled model for this provider to test
          const models = await (await import('../../providers/registry.js')).getAllModels();
          const providerModels = models.filter(m => m.providerId === provider.id && m.enabled && m.hasCredential);
          if (providerModels.length === 0) {
            return {
              provider: provider.id,
              label: provider.label,
              status: 'no_models',
              latencyMs: null,
              error: 'No enabled models with credentials for this provider',
            };
          }

          const testModel = providerModels[0];
          const startTime = Date.now();

          try {
            const result = await callModel(provider, testModel.model, [
              { role: 'user', content: 'Say hello in one sentence.' }
            ], {
              maxTokens: 50,
              temperature: 0,
              timeout: 10000, // 10 second timeout for health checks
            });

            const latencyMs = Date.now() - startTime;
            return {
              provider: provider.id,
              label: provider.label,
              status: 'ok',
              latencyMs,
              modelTested: testModel.id,
              responsePreview: result.content.substring(0, 100),
            };
          } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
              provider: provider.id,
              label: provider.label,
              status: 'error',
              latencyMs,
              error: errorMessage,
              modelTested: testModel.id,
            };
          }
        })
      );

      return { providers: results };
    });
  }
