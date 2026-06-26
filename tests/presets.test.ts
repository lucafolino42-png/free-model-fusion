import { describe, it, expect } from 'vitest';
import { modelPresets, providerPresets } from '../src/providers/presets.js';

// Model IDs that providers have deprecated/removed. If any preset still
// references one, chat requests routed to it will fail. This is a regression
// guard: update the model id in presets.ts when a provider renames a model.
const DEAD_MODEL_IDS = new Set([
  'llama3-8b-8192',
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'llama-3.2-90b-vision-preview',
]);

describe('model preset freshness', () => {
  it('no preset references a known-dead model id', () => {
    const dead = modelPresets.filter((m) => DEAD_MODEL_IDS.has(m.model));
    expect(dead).toEqual([]);
  });

  it('groq presets use current production model ids', () => {
    const groq = modelPresets.filter((m) => m.providerId === 'groq');
    const ids = groq.map((m) => m.model);
    expect(ids).toContain('llama-3.1-8b-instant');
    expect(ids).toContain('llama-3.3-70b-versatile');
    expect(ids).toContain('openai/gpt-oss-120b');
    expect(ids).toContain('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('every model preset references an existing provider id', () => {
    const providerIds = new Set(providerPresets.map((p) => p.id));
    const orphans = modelPresets.filter((m) => !providerIds.has(m.providerId));
    expect(orphans).toEqual([]);
  });
});
