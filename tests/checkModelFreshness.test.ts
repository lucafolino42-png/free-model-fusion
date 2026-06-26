import { describe, it, expect } from 'vitest';
import { diffPresets } from '../scripts/checkModelFreshness.js';
import type { ModelPreset } from '../src/providers/types.js';

function preset(providerId: string, model: string, title: string): ModelPreset {
  return {
    id: `${providerId}_${model}`,
    providerId,
    title,
    model,
    useAs: ['expert'],
    enabled: true,
    speedClass: 'fast',
    qualityClass: 'good',
    maxOutputTokens: 8192,
  };
}

describe('diffPresets', () => {
  it('reports no missing when all preset ids are in the live set', () => {
    const presets = [
      preset('groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B'),
      preset('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini'),
    ];
    const live = {
      groq: new Set(['llama-3.3-70b-versatile', 'other']),
      openrouter: new Set(['openai/gpt-4o-mini']),
    };
    const result = diffPresets(presets, live);
    expect(result.missing).toEqual([]);
    expect(result.checkedProviders.sort()).toEqual(['groq', 'openrouter']);
  });

  it('reports missing ids not present in the live set', () => {
    const presets = [
      preset('groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B'),
      preset('groq', 'DEAD-MODEL-ID', 'Dead Model'),
      preset('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini'),
    ];
    const live = {
      groq: new Set(['llama-3.3-70b-versatile']),
      openrouter: new Set(['openai/gpt-4o-mini']),
    };
    const result = diffPresets(presets, live);
    expect(result.missing).toEqual([
      { providerId: 'groq', modelId: 'DEAD-MODEL-ID', presetTitle: 'Dead Model' },
    ]);
  });

  it('skips presets whose provider was not checked this run', () => {
    // cerebras not in liveIdsByProvider -> its presets are not flagged missing.
    const presets = [
      preset('cerebras', 'gpt-oss-120b', 'Cerebras GPT-OSS'),
      preset('groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B'),
    ];
    const live = { groq: new Set(['llama-3.3-70b-versatile']) };
    const result = diffPresets(presets, live);
    expect(result.missing).toEqual([]);
    expect(result.checkedProviders).toEqual(['groq']);
  });

  it('handles an empty live map', () => {
    const presets = [preset('groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B')];
    const result = diffPresets(presets, {});
    expect(result.missing).toEqual([]);
    expect(result.checkedProviders).toEqual([]);
  });
});
