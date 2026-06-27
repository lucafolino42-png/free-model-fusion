import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import { initializeDatabase } from '../src/db/client.js';
import { saveCredential } from '../src/providers/credentials.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  await initializeDatabase();
  const server = await createServer();
  app = server.fastify;
});

afterAll(async () => {
  await app.close();
});

describe('GET /secrets (F4/F5 merge)', () => {
  it('returns provider keys (with masked value + source) and env vars', async () => {
    // Save one DB key so we have a non-env entry.
    await saveCredential('fireworks', 'fir-test-key-1234567890');

    const res = await app.inject({ method: 'GET', url: '/secrets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.providerKeys)).toBe(true);
    expect(Array.isArray(body.envVars)).toBe(true);

    // Provider keys: must include the one we just saved (with masked key, source=db).
    const saved = body.providerKeys.find((k: { providerId: string }) => k.providerId === 'fireworks');
    expect(saved).toBeDefined();
    expect(saved.source).toBe('db');
    expect(saved.maskedKey).toContain('****');
    expect(saved.maskedKey).not.toContain('fir-test-key-1234567890');

    // Env vars: must include the common set (GROQ_API_KEY set in setup.ts).
    const envKeys = body.envVars.map((e: { key: string }) => e.key);
    expect(envKeys).toContain('GROQ_API_KEY');
    expect(envKeys).toContain('TELEGRAM_BOT_TOKEN');
    expect(envKeys).toContain('TAVILY_API_KEY');

    // Env var shape: each has source/maskedValue.
    const groq = body.envVars.find((e: { key: string }) => e.key === 'GROQ_API_KEY');
    expect(groq.source).toBe('env'); // setup.ts sets it
    expect(groq.maskedValue).toContain('****');
  });

  it('envVars never include raw API key values', async () => {
    const res = await app.inject({ method: 'GET', url: '/secrets' });
    const body = res.json();
    // Defensive: even if masking had a bug, the response shouldn't contain
    // any of the known test API key strings as plaintext.
    const dump = JSON.stringify(body);
    expect(dump).not.toContain('fir-test-key-1234567890');
  });
});
