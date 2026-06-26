import { describe, it, expect, beforeAll } from 'vitest';
import { initializeDatabase } from '../src/db/client.js';
import {
  hasCredential,
  getCredential,
  saveCredential,
  deleteCredential,
  listCredentials,
} from '../src/providers/credentials.js';

beforeAll(async () => {
  await initializeDatabase();
});

describe('saveCredential / getCredential round-trip', () => {
  it('saves and retrieves a key, decrypting correctly', async () => {
    await saveCredential('together', 'sk-together-test-key-1234567890abcdef');
    const got = await getCredential('together');
    expect(got).toBe('sk-together-test-key-1234567890abcdef');
  });

  it('reports hasCredential=true after saving', async () => {
    await saveCredential('fireworks', 'fir-fireworks-test-key-1234567890');
    expect(await hasCredential('fireworks')).toBe(true);
  });

  it('returns undefined for a provider with no key', async () => {
    expect(await getCredential('novita')).toBeUndefined();
    expect(await hasCredential('novita')).toBe(false);
  });
});

describe('env-var priority over DB', () => {
  it('returns the env var when both env and DB have a key (groq is set in setup)', async () => {
    await saveCredential('groq', 'this-db-key-should-not-be-returned-12345');
    const got = await getCredential('groq');
    // setup.ts sets GROQ_API_KEY=gsk_test_groq_key_for_tests_only_abcdef
    expect(got).toBe('gsk_test_groq_key_for_tests_only_abcdef');
    expect(got).not.toContain('this-db-key');
  });

  it('hasCredential is true for groq from the env var', async () => {
    expect(await hasCredential('groq')).toBe(true);
  });
});

describe('deleteCredential', () => {
  it('deletes a DB key and reports true, then getCredential is undefined', async () => {
    await saveCredential('hyperbolic', 'hyp-key-to-delete-1234567890');
    expect(await deleteCredential('hyperbolic')).toBe(true);
    expect(await getCredential('hyperbolic')).toBeUndefined();
  });

  it('returns false when deleting a provider with no DB key', async () => {
    expect(await deleteCredential('never-saved')).toBe(false);
  });
});

describe('listCredentials', () => {
  it('returns masked keys with a source label', async () => {
    await saveCredential('sambanova', 'sambanova-secret-key-1234567890');
    const list = await listCredentials();
    const sam = list.find((c) => c.providerId === 'sambanova');
    expect(sam).toBeDefined();
    expect(sam?.source).toBe('db');
    expect(sam?.maskedKey).toContain('****');
    expect(sam?.maskedKey).not.toContain('sambanova-secret-key-1234567890');

    const groq = list.find((c) => c.providerId === 'groq');
    expect(groq?.source).toBe('env');
  });
});
