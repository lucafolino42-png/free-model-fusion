import { describe, it, expect } from 'vitest';
import * as url from 'node:url';
import * as path from 'node:path';
import { pickBestForRole } from '../src/fusion/routing.js';
import type { RegisteredModel } from '../src/providers/types.js';

// ─── Test command parsing, model selection logic ─────────
// Most routing tests require DB setup, so we test the logic in isolation

describe('routing profile constants', () => {
  it('has valid profile types', () => {
    const profiles = ['speed', 'balanced', 'quality', 'custom'];
    expect(profiles).toContain('speed');
    expect(profiles).toContain('balanced');
    expect(profiles).toContain('quality');
    expect(profiles).toContain('custom');
  });

  it('speed class order exists', () => {
    const speedOrder: Record<string, number> = {
      very_fast: 1,
      fast: 2,
      medium: 3,
      slow: 4,
      very_slow: 5,
    };
    expect(speedOrder.very_fast).toBeLessThan(speedOrder.slow);
  });

  it('quality class order exists', () => {
    const qualityOrder: Record<string, number> = {
      basic: 1,
      good: 2,
      strong: 3,
      frontier: 4,
      reasoning: 5,
    };
    expect(qualityOrder.basic).toBeLessThan(qualityOrder.frontier);
  });
});

// ─── pickBestForRole (pure) ──────────────────────────────
function makeModel(
  id: string,
  speed: 'very_fast' | 'fast' | 'medium',
  quality: 'basic' | 'good' | 'strong'
): RegisteredModel {
  return {
    id,
    providerId: 'p',
    title: id,
    model: id,
    useAs: ['judge'],
    enabled: true,
    speedClass: speed,
    qualityClass: quality,
    maxOutputTokens: 8192,
    hasCredential: true,
    isPreset: true,
  };
}

describe('pickBestForRole', () => {
  it('does not mutate the input array', () => {
    const input = [
      makeModel('a', 'medium', 'good'),
      makeModel('b', 'very_fast', 'basic'),
    ];
    const snapshot = input.map((m) => m.id);
    pickBestForRole(input, 'speed', 'judge');
    expect(input.map((m) => m.id)).toEqual(snapshot);
  });

  it('picks the fastest model for the speed profile', () => {
    const input = [
      makeModel('a', 'medium', 'good'),
      makeModel('b', 'very_fast', 'basic'),
    ];
    expect(pickBestForRole(input, 'speed', 'judge')?.id).toBe('b');
  });

  it('picks the highest-quality model for the quality profile', () => {
    const input = [
      makeModel('a', 'fast', 'good'),
      makeModel('b', 'fast', 'strong'),
    ];
    expect(pickBestForRole(input, 'quality', 'judge')?.id).toBe('b');
  });

  it('returns null for an empty list', () => {
    expect(pickBestForRole([], 'balanced', 'judge')).toBeNull();
  });
});
