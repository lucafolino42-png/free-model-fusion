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
  // CORS: configurable via CORS_ORIGIN (default '*' for dev; set to a specific
  // origin in production to lock down cross-origin access to the API).
  await fastify.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Rate limiting: configurable via FUSION_RATE_LIMIT_MAX env var.
  // Default 1000/min is well above any realistic single-operator workload but
  // keeps the safeguard active. Production deployments behind a reverse proxy
  // can set this lower (e.g. 100). The /chat and /webhook/chat routes have
  // their own stricter per-route 20/min limits (see api/routes/chat.ts).
  await fastify.register(rateLimit, {
    max: Number(process.env.FUSION_RATE_LIMIT_MAX) || 1000,
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

  // ─── Security Headers (onSend hook; no extra dependency) ─
  // The SPA uses inline <style> and <script>, so script-src/style-src require
  // 'unsafe-inline'. Fonts are self-hosted except the Google Fonts CDN link.
  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
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
      logger.info(`OpenAI-compatible: http://localhost:${config.port}/v1/chat/completions`);
      logger.info(`Agent models: http://localhost:${config.port}/v1/models`);
      logger.info(`Agent embeddings: http://localhost:${config.port}/v1/embeddings`);
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
