import { describe, it, expect } from 'vitest';
import { splitTelegramMessage } from '../src/format/splitTelegram.js';

describe('splitTelegramMessage', () => {
  it('returns empty array for empty text', () => {
    expect(splitTelegramMessage('')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    const result = splitTelegramMessage('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world');
  });

  it('splits long text into multiple chunks', () => {
    const longText = 'A'.repeat(5000);
    const result = splitTelegramMessage(longText, 1000);
    expect(result.length).toBeGreaterThan(1);
  });

  it('prefixes continuation chunks with Part X/Y', () => {
    const longText = 'A'.repeat(5000);
    const result = splitTelegramMessage(longText, 1000);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toContain('Part');
    }
  });

  it('splits on paragraph breaks when possible', () => {
    const text =
      'Short paragraph.\n\n' +
      'B'.repeat(500) +
      '\n\n' +
      'C'.repeat(500) +
      '\n\n' +
      'D'.repeat(500);

    const result = splitTelegramMessage(text, 600);
    expect(result.length).toBeGreaterThan(1);
  });

  it('handles text at exact boundary', () => {
    const text = 'A'.repeat(3600);
    const result = splitTelegramMessage(text, 3600);
    expect(result).toHaveLength(1);
  });

  it('handles text just over boundary', () => {
    const text = 'A'.repeat(3601);
    const result = splitTelegramMessage(text, 3600);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('removes null characters', () => {
    const result = splitTelegramMessage('Hello\0World');
    expect(result[0]).not.toContain('\0');
  });

  it('does not split chunks longer than max by too much', () => {
    const longText = 'A'.repeat(10000);
    const result = splitTelegramMessage(longText, 3600);
    for (const chunk of result) {
      // Remove prefix length from consideration
      const cleanChunk = chunk.replace(/<b>Part \d+\/\d+<\/b>\n\n/, '');
      expect(cleanChunk.length).toBeLessThanOrEqual(3700); // slight tolerance
    }
  });
});
