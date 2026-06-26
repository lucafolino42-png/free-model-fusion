import { describe, it, expect } from 'vitest';
import { maskApiKey } from '../src/utils/crypto.js';

describe('maskApiKey', () => {
  it('masks long key showing first 4 and last 4 chars', () => {
    const masked = maskApiKey('sk-abcdefghijklmnop1234567890');
    expect(masked).toBe('sk-a****7890');
  });

  it('masks short key', () => {
    const masked = maskApiKey('abc123');
    expect(masked).toBe('ab****');
  });

  it('masks very short key', () => {
    const masked = maskApiKey('a');
    expect(masked).toBe('a****');
  });
});
