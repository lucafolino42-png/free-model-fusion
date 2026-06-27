import { describe, it, expect } from 'vitest';
import {
  isRateLimited,
  telegramStartMessage,
} from '../src/telegram/bot.js';

describe('telegramStartMessage', () => {
  it('returns a welcome message with usage instructions', () => {
    const msg = telegramStartMessage();
    expect(msg).toContain('Welcome');
    expect(msg).toContain('Free Model Fusion');
    expect(msg).toContain('/help');
    expect(msg).toContain('/profile');
    expect(msg).toContain('/add');
  });
});

describe('isRateLimited', () => {
  it('first message is not limited', () => {
    const map = new Map<number, number>();
    expect(isRateLimited(123, map, 2000)).toBe(false);
    expect(map.get(123)).toBeTypeOf('number');
  });

  it('a burst within window is limited', () => {
    const map = new Map<number, number>();
    const now = 10_000;
    map.set(123, now - 100); // 100ms ago
    expect(isRateLimited(123, map, 2000, now)).toBe(true);
  });

  it('a message after the window is allowed', () => {
    const map = new Map<number, number>();
    const now = 10_000;
    map.set(123, now - 3000); // 3s ago, window is 2s
    expect(isRateLimited(123, map, 2000, now)).toBe(false);
  });

  it('different chat ids do not interfere', () => {
    const map = new Map<number, number>();
    const now = 10_000;
    map.set(123, now - 100);
    expect(isRateLimited(123, map, 2000, now)).toBe(true);
    expect(isRateLimited(456, map, 2000, now)).toBe(false);
  });
});
