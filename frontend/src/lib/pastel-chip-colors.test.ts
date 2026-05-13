import { describe, it, expect } from 'vitest';
import {
  stablePastelChipIndex,
  pastelChipClassForSeed,
  PASTEL_CHIP_CLASSNAMES,
} from './pastel-chip-colors';

describe('stablePastelChipIndex', () => {
  it('returns the same index for the same seed (determinism)', () => {
    const seed = 'my-seed';
    expect(stablePastelChipIndex(seed)).toBe(stablePastelChipIndex(seed));
  });

  it('returns a value within valid index range [0, length-1]', () => {
    const seeds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'foo', 'bar', 'baz'];
    for (const seed of seeds) {
      const idx = stablePastelChipIndex(seed);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(PASTEL_CHIP_CLASSNAMES.length);
    }
  });

  it('handles empty string seed without throwing', () => {
    const idx = stablePastelChipIndex('');
    expect(idx).toBe(0); // h stays 0, 0 % n = 0
  });

  it('different seeds can return different indices', () => {
    const indices = new Set<number>();
    const seeds = [
      'modelA',
      'modelB',
      'modelC',
      'modelD',
      'modelE',
      'group1',
      'group2',
      'group3',
      'team-alpha',
      'red-team',
      'blue-team',
      'green-team',
    ];
    for (const s of seeds) {
      indices.add(stablePastelChipIndex(s));
    }
    // With 12 seeds and 10 colors, at least 2 distinct colors should appear
    expect(indices.size).toBeGreaterThan(1);
  });

  it('returns integer values', () => {
    expect(Number.isInteger(stablePastelChipIndex('test'))).toBe(true);
  });
});

describe('pastelChipClassForSeed', () => {
  it('returns a non-empty string', () => {
    expect(typeof pastelChipClassForSeed('test')).toBe('string');
    expect(pastelChipClassForSeed('test').length).toBeGreaterThan(0);
  });

  it('returns one of the known Tailwind class strings', () => {
    const result = pastelChipClassForSeed('any-seed');
    expect(PASTEL_CHIP_CLASSNAMES).toContain(result);
  });

  it('is deterministic — same seed gives same class', () => {
    const seed = 'stable-seed';
    expect(pastelChipClassForSeed(seed)).toBe(pastelChipClassForSeed(seed));
  });

  it('handles empty string seed', () => {
    const result = pastelChipClassForSeed('');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returned class contains bg- prefix (Tailwind background class)', () => {
    const result = pastelChipClassForSeed('bg-test');
    expect(result).toMatch(/bg-/);
  });
});
