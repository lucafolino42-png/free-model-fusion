import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { initializeDatabase, closeDatabase } from './db/client.js';
import { registerRoutes } from './api/routes/index.js';
import { initTelegramBot } from './telegram/bot.js';

// ─── Create Server ───────────────────────────────────────
export async function createServer() {
  const fastify = Fastify({
    logger: false, // We use our own logger
  });

  // ─── Plugins ───────────────────────────────────────────
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Rate limiting: 100 requests per minute per IP by default
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => {
      return {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. You are limited to ${context.max} requests per ${context.after}.`,
        },
      };
    },
  });

  // ─── Error Handler ─────────────────────────────────────
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    logger.error('Fastify error', {
      error: err.message,
      stack: err.stack,
      url: request.url,
      method: request.method,
    });

    const statusCode = err.statusCode || 500;
    reply.status(statusCode).send({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : err.message,
      },
    });
  });

  // ─── Initialize Database ───────────────────────────────
  await initializeDatabase();

  // ─── Register Routes ───────────────────────────────────
  await registerRoutes(fastify);

  // ─── Initialize Telegram Bot ───────────────────────────
  await initTelegramBot(fastify);

  // ─── Start ─────────────────────────────────────────────
  const start = async () => {
    try {
      await fastify.listen({
        port: config.port,
        host: '0.0.0.0',
      });
      logger.info(`Server listening on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Chat API: http://localhost:${config.port}/chat`);
      logger.info(`Health: http://localhost:${config.port}/health`);
    } catch (error) {
      logger.error('Failed to start server', { error: String(error) });
      process.exit(1);
    }
  };

  // ─── Graceful Shutdown ─────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await closeDatabase();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { fastify, start, shutdown };
}
