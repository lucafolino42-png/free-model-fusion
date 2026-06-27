import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import { config } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await createServer();
  app = server.fastify;
});

afterAll(async () => {
  await app.close();
});

describe('POST /settings live-mutates config (F1 fix)', () => {
  beforeEach(() => {
    // Reset to known baseline.
    (config as Record<string, unknown>).expertMaxTokens = 2500;
    (config as Record<string, unknown>).judgeMaxTokens = 1800;
    (config as Record<string, unknown>).synthesisMaxTokens = 5000;
  });

  it('expertMaxTokens save updates config.expertMaxTokens immediately', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { expertMaxTokens: 4000 },
    });
    expect(res.statusCode).toBe(200);
    expect(config.expertMaxTokens).toBe(4000);
  });

  it('judgeMaxTokens save updates config.judgeMaxTokens immediately', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { judgeMaxTokens: 2500 },
    });
    expect(res.statusCode).toBe(200);
    expect(config.judgeMaxTokens).toBe(2500);
  });

  it('synthesisMaxTokens save updates config.synthesisMaxTokens immediately', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { synthesisMaxTokens: 6500 },
    });
    expect(res.statusCode).toBe(200);
    expect(config.synthesisMaxTokens).toBe(6500);
  });

  it('non-token settings (profile, webMode) still persist to DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { profile: 'speed', webMode: 'auto' },
    });
    expect(res.statusCode).toBe(200);
    // DB-backed: verify via GET /settings reflects the new value.
    const after = await app.inject({ method: 'GET', url: '/settings' });
    const s = after.json().settings;
    expect(s.profile).toBe('speed');
    expect(s.webMode).toBe('auto');
  });
});
