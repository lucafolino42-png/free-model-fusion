import { describe, it, expect } from 'vitest';
import { applyProviderOverrides } from '../src/providers/registry.js';
import type { RegisteredProvider } from '../src/providers/types.js';

function preset(id: string, enabled: boolean): RegisteredProvider {
  return {
    id,
    label: id,
    endpoint: 'https://x',
    authType: 'bearer',
    apiFormat: 'openai',
    enabled,
    aliases: [id],
    credentialRef: id,
    maxOutputTokens: 8192,
    speedClass: 'fast',
    qualityClass: 'good',
    hasCredential: false,
    isPreset: true,
  };
}

describe('applyProviderOverrides', () => {
  it('keeps preset default when no override exists', () => {
    const out = applyProviderOverrides([preset('groq', true)], []);
    expect(out[0].enabled).toBe(true);
  });

  it('applies an override that disables an enabled preset', () => {
    const out = applyProviderOverrides(
      [preset('groq', true)],
      [{ providerId: 'groq', enabled: false, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(false);
  });

  it('applies an override that enables a disabled preset', () => {
    const out = applyProviderOverrides(
      [preset('groq', false)],
      [{ providerId: 'groq', enabled: true, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(true);
  });

  it('ignores overrides for unknown provider ids', () => {
    const out = applyProviderOverrides(
      [preset('groq', true)],
      [{ providerId: 'nope', enabled: false, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(true);
  });

  it('does not mutate the input providers', () => {
    const providers = [preset('groq', true)];
    applyProviderOverrides(providers, [
      { providerId: 'groq', enabled: false, updatedAt: new Date() },
    ]);
    expect(providers[0].enabled).toBe(true);
  });
});
