import type { FastifyInstance } from 'fastify';

export function registerEmbeddingsRoutes(fastify: FastifyInstance): void {
  for (const path of ['/embeddings', '/v1/embeddings']) {
    fastify.post(path, {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const body = request.body as { model?: string; input: string | string[] } | undefined;
      if (!body || !body.input) {
        reply.status(400);
        return { error: { type: 'invalid_request_error', message: 'input is required.' } };
      }
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const model = body.model || 'fusion-embed';
      const data = inputs.map((text, index) => ({
        object: 'embedding' as const,
        index,
        embedding: generateEmbedding(text),
      }));
      return {
        object: 'list',
        data,
        model,
        usage: {
          prompt_tokens: inputs.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
          total_tokens: inputs.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        },
      };
    });
  }
}

const BASE_EMBEDDING = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1) * 0.1);

function generateEmbedding(text: string): number[] {
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = ((seed << 5) - seed) + text.charCodeAt(i);
  const emb = BASE_EMBEDDING.map((base, i) => {
    const hash = ((seed * (i + 1)) % 100) / 100;
    return Number((base + hash * 0.05 - 0.025).toFixed(6));
  });
  const mag = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? emb.map(v => Number((v / mag).toFixed(6))) : emb;
}
