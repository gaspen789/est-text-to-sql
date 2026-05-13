/**
 * Tests for validation logic found in frontend/src/components/edit-form.tsx.
 * The functions (validateParameters, normalizeValue, normalizeDate, hasChanges,
 * levenshteinDistance, canonicalize) are inlined inside the component and not
 * exported, so they are replicated here to document and verify the business rules.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// LLM name regex  (from validateMandatoryFields in edit-form.tsx)
// /^[a-z][a-z0-9._:/-]*$/
// ---------------------------------------------------------------------------
const LLM_NAME_REGEX = /^[a-z][a-z0-9._:/-]*$/;

describe('LLM name format validation regex', () => {
  const valid = (name: string) => LLM_NAME_REGEX.test(name.trim());

  it('accepts a simple lowercase name', () => {
    expect(valid('gpt4')).toBe(true);
  });

  it('accepts name with hyphen (gpt-4)', () => {
    expect(valid('gpt-4')).toBe(true);
  });

  it('accepts name with dots (claude-3.5-sonnet)', () => {
    expect(valid('claude-3.5-sonnet')).toBe(true);
  });

  it('accepts name with colon suffix (llama3:8b)', () => {
    expect(valid('llama3:8b')).toBe(true);
  });

  it('accepts name with slash (models/gemini)', () => {
    expect(valid('models/gemini')).toBe(true);
  });

  it('accepts single lowercase letter', () => {
    expect(valid('a')).toBe(true);
  });

  it('rejects uppercase letters', () => {
    expect(valid('GPT-4')).toBe(false);
  });

  it('rejects name starting with a digit', () => {
    expect(valid('4gpt')).toBe(false);
  });

  it('rejects name with @ symbol', () => {
    expect(valid('user@model')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(valid('')).toBe(false);
  });

  it('rejects name starting with hyphen', () => {
    expect(valid('-name')).toBe(false);
  });

  it('rejects name with spaces', () => {
    expect(valid('gpt 4')).toBe(false);
  });

  it('rejects name with mixed case', () => {
    expect(valid('Claude')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Numeric field validation (llm_context_length, llm_max_output_tokens)
// from validateMandatoryFields in edit-form.tsx
// Rule: must be finite, integer, and > 0
// ---------------------------------------------------------------------------
function isValidPositiveInteger(v: number | undefined | null): boolean {
  if (v === undefined || v === null) return false;
  if (!Number.isFinite(v)) return false;
  if (!Number.isInteger(v)) return false;
  if (v <= 0) return false;
  return true;
}

describe('Numeric field validation (context length / max output tokens)', () => {
  it('accepts 1 (minimum positive integer)', () => {
    expect(isValidPositiveInteger(1)).toBe(true);
  });

  it('accepts 128000', () => {
    expect(isValidPositiveInteger(128000)).toBe(true);
  });

  it('rejects 0', () => {
    expect(isValidPositiveInteger(0)).toBe(false);
  });

  it('rejects negative values', () => {
    expect(isValidPositiveInteger(-1)).toBe(false);
  });

  it('rejects non-integer (1.5)', () => {
    expect(isValidPositiveInteger(1.5)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidPositiveInteger(Infinity)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidPositiveInteger(NaN)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidPositiveInteger(undefined)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidPositiveInteger(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateParameters logic (from edit-form.tsx)
// Rule: a row is invalid when exactly one of key/value is filled.
//       A row where both are empty is valid (ignored).
//       A row where both are filled is valid.
// ---------------------------------------------------------------------------
type Param = { key: string; value: string };

function validateParam(param: Param): boolean {
  const keyFilled = param.key && param.key.trim() !== '';
  const valueFilled = param.value && param.value.toString().trim() !== '';
  return !((keyFilled && !valueFilled) || (!keyFilled && valueFilled));
}

describe('validateParameters row logic', () => {
  it('both key and value filled — valid row', () => {
    expect(validateParam({ key: 'temperature', value: '0.7' })).toBe(true);
  });

  it('both key and value empty — valid row (ignored)', () => {
    expect(validateParam({ key: '', value: '' })).toBe(true);
  });

  it('key filled but value empty — invalid row', () => {
    expect(validateParam({ key: 'temperature', value: '' })).toBe(false);
  });

  it('value filled but key empty — invalid row', () => {
    expect(validateParam({ key: '', value: '0.7' })).toBe(false);
  });

  it('whitespace-only value counts as empty', () => {
    expect(validateParam({ key: 'temperature', value: '   ' })).toBe(false);
  });

  it('whitespace-only key counts as empty', () => {
    expect(validateParam({ key: '   ', value: '0.7' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeValue (from edit-form.tsx)
// ---------------------------------------------------------------------------
type NormalizeInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<{ key: string; value: unknown }>;

function normalizeValue(value: NormalizeInput): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (typeof item === 'object' && item !== null) {
          const keyFilled = item.key && item.key.trim() !== '';
          const valueFilled = item.value && String(item.value).trim() !== '';
          return keyFilled && valueFilled;
        }
        return true;
      })
      .map((item) => ({
        key: item.key?.trim() || '',
        value: item.value,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  return value;
}

describe('normalizeValue', () => {
  it('trims string values', () => {
    expect(normalizeValue('  hello  ')).toBe('hello');
  });

  it('converts empty/whitespace string to null', () => {
    expect(normalizeValue('')).toBeNull();
    expect(normalizeValue('   ')).toBeNull();
  });

  it('returns null for null', () => {
    expect(normalizeValue(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeValue(undefined)).toBeNull();
  });

  it('preserves numbers', () => {
    expect(normalizeValue(42)).toBe(42);
    expect(normalizeValue(0)).toBe(0);
  });

  it('preserves booleans', () => {
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(false)).toBe(false);
  });

  it('filters out array items with empty key or value', () => {
    const input = [
      { key: 'a', value: '1' },
      { key: '', value: '2' },
      { key: 'b', value: '' },
      { key: 'c', value: '3' },
    ];
    const result = normalizeValue(input) as Array<{ key: string; value: unknown }>;
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.key)).toContain('a');
    expect(result.map((r) => r.key)).toContain('c');
  });

  it('sorts array items by key', () => {
    const input = [
      { key: 'z', value: '1' },
      { key: 'a', value: '2' },
      { key: 'm', value: '3' },
    ];
    const result = normalizeValue(input) as Array<{ key: string; value: unknown }>;
    expect(result[0].key).toBe('a');
    expect(result[1].key).toBe('m');
    expect(result[2].key).toBe('z');
  });

  it('trims array item keys', () => {
    const input = [{ key: '  temp  ', value: '0.5' }];
    const result = normalizeValue(input) as Array<{ key: string; value: unknown }>;
    expect(result[0].key).toBe('temp');
  });

  it('returns empty array for empty array input', () => {
    expect(normalizeValue([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeDate (from edit-form.tsx)
// ---------------------------------------------------------------------------
function normalizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  return dateStr.substring(0, 10);
}

describe('normalizeDate', () => {
  it('extracts date part from ISO datetime string', () => {
    expect(normalizeDate('2024-01-15T10:00:00Z')).toBe('2024-01-15');
  });

  it('returns date string as-is when no T present', () => {
    expect(normalizeDate('2024-01-15')).toBe('2024-01-15');
  });

  it('returns null for null', () => {
    expect(normalizeDate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeDate('')).toBeNull();
  });

  it('handles ISO string with timezone offset', () => {
    expect(normalizeDate('2024-03-20T23:59:59+02:00')).toBe('2024-03-20');
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance (from edit-form.tsx)
// ---------------------------------------------------------------------------
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('kitten -> sitting = 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('empty string to abc = 3 (insertions)', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('abc to empty string = 3 (deletions)', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('single character difference = 1', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('completely different strings have distance = max length', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshteinDistance('hello', 'world')).toBe(levenshteinDistance('world', 'hello'));
  });

  it('handles single char strings', () => {
    expect(levenshteinDistance('a', 'b')).toBe(1);
    expect(levenshteinDistance('a', 'a')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// canonicalize (from edit-form.tsx)
// Strips non-alphanumeric characters and lowercases
// ---------------------------------------------------------------------------
function canonicalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

describe('canonicalize', () => {
  it('lowercases the string', () => {
    expect(canonicalize('HELLO')).toBe('hello');
  });

  it('strips non-alphanumeric characters', () => {
    expect(canonicalize('hello_world')).toBe('helloworld');
  });

  it('strips dashes and underscores', () => {
    expect(canonicalize('top-p')).toBe('topp');
  });

  it('preserves digits', () => {
    expect(canonicalize('gpt4')).toBe('gpt4');
  });

  it('handles empty string', () => {
    expect(canonicalize('')).toBe('');
  });

  it('strips all special characters', () => {
    expect(canonicalize('a.b:c/d')).toBe('abcd');
  });
});

// ---------------------------------------------------------------------------
// hasChanges — simplified standalone version to test the comparison logic
// ---------------------------------------------------------------------------
// The full function uses component state/closures. Here we test the core logic:
// equal normalized values should NOT trigger hasChanges, different ones should.
describe('hasChanges core comparison logic', () => {
  it('same trimmed string values are considered equal', () => {
    expect(normalizeValue('  hello  ')).toBe(normalizeValue('hello'));
  });

  it('empty string and null are both normalized to null (no change)', () => {
    expect(normalizeValue('')).toBe(normalizeValue(null));
  });

  it('different string values produce different normalized results (change detected)', () => {
    expect(normalizeValue('old')).not.toBe(normalizeValue('new'));
  });

  it('same date in ISO and date-only form are equal after normalizeDate', () => {
    expect(normalizeDate('2024-01-15T00:00:00Z')).toBe(normalizeDate('2024-01-15'));
  });

  it('different dates produce different normalized results', () => {
    expect(normalizeDate('2024-01-15')).not.toBe(normalizeDate('2024-02-20'));
  });

  it('array with same params in different order normalizes to same sorted array', () => {
    const a = [
      { key: 'z', value: '1' },
      { key: 'a', value: '2' },
    ];
    const b = [
      { key: 'a', value: '2' },
      { key: 'z', value: '1' },
    ];
    expect(normalizeValue(a)).toEqual(normalizeValue(b));
  });

  it('arrays with different param values normalize to different results', () => {
    const a = [{ key: 'temp', value: '0.5' }];
    const b = [{ key: 'temp', value: '0.9' }];
    expect(normalizeValue(a)).not.toEqual(normalizeValue(b));
  });
});
