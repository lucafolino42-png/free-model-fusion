import { readPublicFile } from './_shared.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ─── Static + Health Routes ──────────────────────────────
export function registerStaticRoutes(fastify: FastifyInstance): void {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            version: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    return { status: 'ok', uptime: process.uptime(), version: '1.0.0' };
  });

  f.get('/favicon.ico', async (_request, reply) => {
    const svg = readPublicFile('favicon.svg');
    if (svg) {
      reply.type('image/svg+xml').send(svg);
    } else {
      reply.status(404).send();
    }
  });

  // Serve JS modules from public/js/ (e.g. /js/utils.js). Guards against path
  // traversal: reject any segment containing '..' or a backslash.
  f.get('/js/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      reply.status(404).send();
      return;
    }
    const js = readPublicFile(`js/${filename}`);
    if (js) {
      reply.type('text/javascript').send(js);
    } else {
      reply.status(404).send();
    }
  });

  f.get('/', async (_request, reply) => {
    const html = readPublicFile('index.html');
    if (html) {
      reply.type('text/html').send(html);
      return;
    }
    // Fallback UI when public/index.html is missing.
    reply.status(200).send(`
<!DOCTYPE html><html><head><title>Free Model Fusion</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#fff}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px;text-align:center;max-width:420px}
h1{font-size:24px;margin:0 0 8px;background:linear-gradient(135deg,#818cf8,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#94a3b8;margin:0 0 24px}.badge{display:inline-block;background:#22c55e20;color:#4ade80;padding:4px 12px;border-radius:999px;font-size:13px}
</style></head><body><div class="card">
<h1>Free Model Fusion</h1>
<p>UI not found. Run the app from the <code>free-model-fusion</code> directory.</p>
<span class="badge">Server running</span>
</div></body></html>`);
  });
}
