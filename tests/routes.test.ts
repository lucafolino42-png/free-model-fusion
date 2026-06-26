import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await createServer();
  app = server.fastify;
});

afterAll(async () => {
  await app.close();
});

describe('HTTP routes (in-process inject)', () => {
  it('GET /health -> 200 {status:"ok"}', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
  });

  it('GET / -> 200 and serves the HTML UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('html');
  });

  it('GET /favicon.ico -> 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /providers -> 200 with a providers array containing presets', async () => {
    const res = await app.inject({ method: 'GET', url: '/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.some((p: { isPreset: boolean }) => p.isPreset)).toBe(true);
    expect(body.providers.some((p: { id: string }) => p.id === 'groq')).toBe(true);
  });

  it('PATCH /providers/groq/toggle -> 200 (preset toggle, the A fix at the HTTP layer)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/providers/groq/toggle',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(false);

    // The override is reflected by a subsequent GET /providers.
    const after = await app.inject({ method: 'GET', url: '/providers' });
    const groq = after.json().providers.find((p: { id: string }) => p.id === 'groq');
    expect(groq.enabled).toBe(false);

    // Restore default for cleanliness.
    await app.inject({
      method: 'PATCH',
      url: '/providers/groq/toggle',
      payload: { enabled: true },
    });
  });

  it('PATCH /providers/unknown/toggle -> 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/providers/does-not-exist/toggle',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('sets security headers on responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('reflects a CORS allow-origin for requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    // CORS_ORIGIN defaults to '*' in the test setup env, so an allow-origin
    // header should be present on a request bearing an Origin header.
    const resWithOrigin = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(resWithOrigin.headers['access-control-allow-origin']).toBeDefined();
  });
});
