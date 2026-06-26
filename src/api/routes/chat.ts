import { handleFusionCommand } from '../../fusion/commandsHandler.js';
import { logger } from '../../utils/logger.js';
import { FusionError } from '../../utils/errors.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── Chat + Webhook Chat Routes ──────────────────────────
export function registerChatRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

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
        return { error: { code: error.code, message: error.message } };
      }

      reply.status(500);
      return { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
    }
  });

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
}
