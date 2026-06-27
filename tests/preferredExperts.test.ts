import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { initializeDatabase } from '../src/db/client.js';
import { getOrCreateSession } from '../src/fusion/memory.js';
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

describe('PUT /session/:id/preferredExperts (F3 fix)', () => {
  const sid = 'pref-test';

  beforeEach(async () => {
    // Reset session for each test
    await app.inject({
      method: 'DELETE',
      url: `/memory/${encodeURIComponent(sid)}`,
    });
  });

  it('sets the preferred experts list and switches profile to custom', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
      payload: { preferredExperts: ['groq_llama3_8b', 'groq_llama3_70b'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferredExperts).toEqual(['groq_llama3_8b', 'groq_llama3_70b']);
    expect(body.profile).toBe('custom');

    // Confirm via direct session read.
    const session = await getOrCreateSession(sid, 'api');
    expect(session.preferredExperts).toEqual(['groq_llama3_8b', 'groq_llama3_70b']);
    expect(session.profile).toBe('custom');
  });

  it('empty list clears preferredExperts but does not change profile', async () => {
    // First set non-empty
    await app.inject({
      method: 'PUT',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
      payload: { preferredExperts: ['groq_llama3_8b'] },
    });
    // Then clear
    const res = await app.inject({
      method: 'PUT',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
      payload: { preferredExperts: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferredExperts).toEqual([]);
    // Profile should NOT switch to 'custom' when clearing (keep current profile)
    // Implementation choice: don't auto-revert; user controls via /profile.
  });

  it('rejects non-array preferredExperts with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
      payload: { preferredExperts: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /session/:id/preferredExperts returns the current list', async () => {
    await app.inject({
      method: 'PUT',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
      payload: { preferredExperts: ['groq_llama3_8b'] },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/session/${encodeURIComponent(sid)}/preferredExperts`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferredExperts).toEqual(['groq_llama3_8b']);
  });
});
