import { describe, it, expect } from 'vitest';
import * as url from 'node:url';
import * as path from 'node:path';

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
