import { describe, it, expect } from 'vitest';
import { toastReadableDurationMs } from './toast';

const MIN_MS = 4000;
const MAX_MS = 18000;
const BASE_MS = 4000;
const MS_PER_CHAR = 38;

describe('toastReadableDurationMs', () => {
  it('returns a number', () => {
    expect(typeof toastReadableDurationMs('hello')).toBe('number');
  });

  it('returns the minimum duration for empty string', () => {
    expect(toastReadableDurationMs('')).toBe(MIN_MS);
  });

  it('returns above minimum for very short text (2 chars = 4076ms)', () => {
    // 'hi' has 2 chars: BASE_MS + 2 * MS_PER_CHAR = 4000 + 76 = 4076
    expect(toastReadableDurationMs('hi')).toBe(BASE_MS + 2 * MS_PER_CHAR);
  });

  it('returns a value higher than minimum for long text', () => {
    const longText = 'a'.repeat(200);
    const duration = toastReadableDurationMs(longText);
    expect(duration).toBeGreaterThan(MIN_MS);
  });

  it('is capped at max duration for extremely long text', () => {
    const veryLongText = 'a'.repeat(10000);
    expect(toastReadableDurationMs(veryLongText)).toBe(MAX_MS);
  });

  it('scales linearly within the allowed range', () => {
    // 100 chars: BASE_MS + 100 * MS_PER_CHAR = 4000 + 3800 = 7800 (within [4000, 18000])
    const text = 'a'.repeat(100);
    expect(toastReadableDurationMs(text)).toBe(BASE_MS + 100 * MS_PER_CHAR);
  });

  it('never goes below the minimum', () => {
    const tests = ['', 'x', 'hi', 'hello'];
    for (const t of tests) {
      expect(toastReadableDurationMs(t)).toBeGreaterThanOrEqual(MIN_MS);
    }
  });

  it('never exceeds the maximum', () => {
    const tests = ['', 'short', 'a'.repeat(500), 'a'.repeat(5000)];
    for (const t of tests) {
      expect(toastReadableDurationMs(t)).toBeLessThanOrEqual(MAX_MS);
    }
  });

  it('duration for text just long enough to reach max is exactly MAX_MS', () => {
    // chars needed: (MAX_MS - BASE_MS) / MS_PER_CHAR = 14000 / 38 ≈ 368.4 → 369 chars hits max
    const threshold = Math.ceil((MAX_MS - BASE_MS) / MS_PER_CHAR);
    const text = 'a'.repeat(threshold);
    expect(toastReadableDurationMs(text)).toBe(MAX_MS);
  });
});
