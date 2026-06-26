import { describe, it, expect } from 'vitest';
import { maskApiKey } from '../src/utils/crypto.js';

describe('credential masking', () => {
  it('masks long API keys correctly', () => {
    const masked = maskApiKey('gsk_abcdefghijklmnopqrstuvwxyz123456');
    expect(masked).toContain('****');
    expect(masked.length).toBeLessThan(30);
    expect(masked.startsWith('gsk_')).toBe(true);
  });

  it('masks short keys', () => {
    const masked = maskApiKey('abc123');
    expect(masked).toBe('ab****');
  });

  it('masks very short key', () => {
    const masked = maskApiKey('a');
    expect(masked).toBe('a****');
  });
});
