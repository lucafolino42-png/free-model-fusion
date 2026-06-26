import { describe, it, expect, beforeAll } from 'vitest';
import { initializeDatabase } from '../src/db/client.js';
import {
  getAllProviders,
  getProviderById,
  addCustomProvider,
  deleteCustomProvider,
  setProviderEnabled,
  findProviderByAlias,
} from '../src/providers/registry.js';

beforeAll(async () => {
  await initializeDatabase();
});

describe('addCustomProvider / getAllProviders', () => {
  it('adds a custom provider and lists it alongside presets', async () => {
    await addCustomProvider({
      id: 'myprov',
      label: 'My Custom Provider',
      endpoint: 'https://api.myprovider.example.com/v1/chat/completions',
    });
    const all = await getAllProviders();
    expect(all.some((p) => p.id === 'myprov')).toBe(true);
    const cp = all.find((p) => p.id === 'myprov');
    expect(cp?.isPreset).toBe(false);
  });
});

describe('setProviderEnabled — preset (the Sub-project A fix, guarded)', () => {
  it('toggles a built-in preset via an override and getAllProviders reflects it', async () => {
    const before = await getAllProviders();
    const groqBefore = before.find((p) => p.id === 'groq');
    const beforeEnabled = groqBefore?.enabled;
    expect(beforeEnabled).toBe(true);

    const ok = await setProviderEnabled('groq', false);
    expect(ok).toBe(true);

    const after = await getAllProviders();
    const groqAfter = after.find((p) => p.id === 'groq');
    expect(groqAfter?.enabled).toBe(false);

    // Restore so other tests/expectations are unaffected.
    await setProviderEnabled('groq', true);
  });

  it('returns false for an unknown provider id', async () => {
    const ok = await setProviderEnabled('does-not-exist', true);
    expect(ok).toBe(false);
  });
});

describe('setProviderEnabled — custom provider', () => {
  it('updates the custom provider row directly', async () => {
    await addCustomProvider({
      id: 'custom-toggle',
      label: 'Toggle Me',
      endpoint: 'https://api.toggle.example.com/v1/chat/completions',
    });
    const ok = await setProviderEnabled('custom-toggle', false);
    expect(ok).toBe(true);
    const all = await getAllProviders();
    expect(all.find((p) => p.id === 'custom-toggle')?.enabled).toBe(false);
  });
});

describe('deleteCustomProvider', () => {
  it('deletes a custom provider and reports true', async () => {
    await addCustomProvider({
      id: 'to-delete',
      label: 'Delete Me',
      endpoint: 'https://api.delete.example.com/v1/chat/completions',
    });
    const deleted = await deleteCustomProvider('to-delete');
    expect(deleted).toBe(true);
    const all = await getAllProviders();
    expect(all.some((p) => p.id === 'to-delete')).toBe(false);
  });
});

describe('getProviderById / findProviderByAlias', () => {
  it('finds a preset by its id', async () => {
    const p = await getProviderById('groq');
    expect(p?.id).toBe('groq');
  });

  it('finds a preset by an alias', async () => {
    const p = await findProviderByAlias('google'); // gemini alias
    expect(p?.id).toBe('gemini');
  });
});
