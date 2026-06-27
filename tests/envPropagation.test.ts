import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from '../src/server.js';
import { config } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

// Tests verify the LIVE mutation contract that makes /api/env updates take
// effect without restarting the server: when /api/env writes a new value
// for TELEGRAM_BOT_TOKEN (or *_API_KEY, or TAVILY_API_KEY), the corresponding
// `config.*` field is mutated in-process so polling loops and send.ts pick
// it up on their next read.
//
// We mock fs.readFileSync/writeFileSync at the env-file path used by the
// route so the test never touches the developer's real .env file.

let app: FastifyInstance;
let tmpEnvFile: string;
const realReadFileSync = fs.readFileSync;
const realWriteFileSync = fs.writeFileSync;

beforeAll(async () => {
  // Temp env file the route will read/write.
  tmpEnvFile = path.join(os.tmpdir(), `fmf-env-test-${Date.now()}.env`);
  fs.writeFileSync(tmpEnvFile, '# test env\n', 'utf-8');

  // Spy on fs to redirect .env lookups to our temp file.
  vi.spyOn(fs, 'readFileSync').mockImplementation(((
    pathLike: fs.PathLike | string,
    ...rest: unknown[]
  ) => {
    const p = String(pathLike);
    if (p.endsWith('.env') && !p.includes(os.tmpdir())) {
      return realReadFileSync(tmpEnvFile, ...(rest as []));
    }
    return realReadFileSync(pathLike as fs.PathLike, ...(rest as []));
  }) as typeof fs.readFileSync);
  vi.spyOn(fs, 'writeFileSync').mockImplementation(((
    pathLike: fs.PathLike | string,
    data: unknown,
    ...rest: unknown[]
  ) => {
    const p = String(pathLike);
    if (p.endsWith('.env') && !p.includes(os.tmpdir())) {
      return realWriteFileSync(tmpEnvFile, data as string, ...(rest as []));
    }
    return realWriteFileSync(pathLike as fs.PathLike, data as string, ...(rest as []));
  }) as typeof fs.writeFileSync);

  const server = await createServer();
  app = server.fastify;
});

afterAll(async () => {
  await app.close();
  try { fs.unlinkSync(tmpEnvFile); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

describe('POST /api/env live-mutates config (no restart needed)', () => {
  beforeEach(() => {
    // Reset config + env to known baseline.
    config.telegramBotToken = '';
    config.tavilyApiKey = '';
    config.providerEnvKeys.groq = '';
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TAVILY_API_KEY = '';
    process.env.GROQ_API_KEY = '';
  });

  it('TELEGRAM_BOT_TOKEN -> config.telegramBotToken (no restart)', async () => {
    const newToken = 'tg_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await app.inject({
      method: 'POST',
      url: '/api/env',
      payload: { key: 'TELEGRAM_BOT_TOKEN', value: newToken },
    });
    expect(res.statusCode).toBe(200);
    expect(config.telegramBotToken).toBe(newToken);
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe(newToken);
  });

  it('TAVILY_API_KEY -> config.tavilyApiKey (no restart)', async () => {
    const newKey = 'tvly_live_bbbbbbbbbb';
    const res = await app.inject({
      method: 'POST',
      url: '/api/env',
      payload: { key: 'TAVILY_API_KEY', value: newKey },
    });
    expect(res.statusCode).toBe(200);
    expect(config.tavilyApiKey).toBe(newKey);
    expect(process.env.TAVILY_API_KEY).toBe(newKey);
  });

  it('GROQ_API_KEY -> config.providerEnvKeys.groq (no restart)', async () => {
    const newKey = 'gsk_live_cccccccc';
    const res = await app.inject({
      method: 'POST',
      url: '/api/env',
      payload: { key: 'GROQ_API_KEY', value: newKey },
    });
    expect(res.statusCode).toBe(200);
    expect(config.providerEnvKeys.groq).toBe(newKey);
    expect(process.env.GROQ_API_KEY).toBe(newKey);
  });

  it('rejects disallowed keys with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/env',
      payload: { key: 'PATH', value: '/something' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/not allowed/i);
  });
});
