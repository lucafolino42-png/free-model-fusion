import { listSessions } from '../../fusion/memory.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export function registerSessionsRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get('/sessions', async () => {
    const sessions = await listSessions();
    return { sessions };
  });
}
