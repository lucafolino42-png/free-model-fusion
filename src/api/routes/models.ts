import { getAllModels } from '../../providers/registry.js';
import { db } from '../../db/client.js';
import { customModels } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── Model Routes ────────────────────────────────────────
export function registerModelRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get('/models', async () => {
    const models = await getAllModels();
    return { models };
  });

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

  f.delete('/models/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
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
}
