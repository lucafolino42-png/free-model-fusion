import type { FastifyInstance } from 'fastify';
import { registerStaticRoutes } from './static.js';
import { registerChatRoutes } from './chat.js';
import { registerProviderRoutes } from './providers.js';
import { registerModelRoutes } from './models.js';
import { registerKeyRoutes } from './keys.js';
import { registerSettingsRoutes } from './settings.js';
import { registerEnvRoutes } from './env.js';
import { registerSessionsRoutes } from './sessions.js';
import { registerChatCompletionsRoutes } from './chatCompletions.js';
import { registerEmbeddingsRoutes } from './embeddings.js';

// ─── Register All Routes ─────────────────────────────────
// Composes the focused route modules. Public API unchanged from the
// pre-split routes.ts: server.ts imports { registerRoutes } from here.
export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  registerStaticRoutes(fastify);
  registerChatRoutes(fastify);
  registerChatCompletionsRoutes(fastify);
  registerEmbeddingsRoutes(fastify);
  registerProviderRoutes(fastify);
  registerModelRoutes(fastify);
  registerKeyRoutes(fastify);
  registerSettingsRoutes(fastify);
  registerEnvRoutes(fastify);
  registerSessionsRoutes(fastify);
}
