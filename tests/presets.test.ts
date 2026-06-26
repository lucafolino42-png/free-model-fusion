import { describe, it, expect } from 'vitest';
import { modelPresets, providerPresets } from '../src/providers/presets.js';

// Model IDs that providers have deprecated/removed. If any preset still
// references one, chat requests routed to it will fail. This is a regression
// guard: update the model id in presets.ts when a provider renames a model.
const DEAD_MODEL_IDS = new Set([
  // Groq (retired)
  'llama3-8b-8192',
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'llama-3.2-90b-vision-preview',
  // Gemini (shut down / not listed)
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  // Perplexity (old naming)
  'sonar-small-chat',
  'sonar-large-chat',
  // DeepInfra (no longer listed)
  'meta-llama/Meta-Llama-3-70B-Instruct',
  // Cerebras (Llama lineup dropped)
  'llama3.1-8b',
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

  it('gemini presets use current model ids (2.0 line is shut down)', () => {
    const gemini = modelPresets.filter((m) => m.providerId === 'gemini');
    const ids = gemini.map((m) => m.model);
    expect(ids).toContain('gemini-2.5-flash');
    expect(ids).toContain('gemini-2.5-pro');
  });

  it('perplexity presets use current sonar naming', () => {
    const pplx = modelPresets.filter((m) => m.providerId === 'perplexity');
    const ids = pplx.map((m) => m.model);
    expect(ids).toContain('sonar');
    expect(ids).toContain('sonar-pro');
  });

  it('deepinfra preset uses a currently-listed llama id', () => {
    const di = modelPresets.filter((m) => m.providerId === 'deepinfra');
    const ids = di.map((m) => m.model);
    expect(ids).toContain('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  });

  it('cerebras preset uses a currently-documented id', () => {
    const cer = modelPresets.filter((m) => m.providerId === 'cerebras');
    const ids = cer.map((m) => m.model);
    expect(ids).toContain('gpt-oss-120b');
  });

  it('every model preset references an existing provider id', () => {
    const providerIds = new Set(providerPresets.map((p) => p.id));
    const orphans = modelPresets.filter((m) => !providerIds.has(m.providerId));
    expect(orphans).toEqual([]);
  });
});
