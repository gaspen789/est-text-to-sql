import { describe, it, expect } from 'vitest';
import { getNestedValue, applyParams } from './language-context';

// ---------------------------------------------------------------------------
// getNestedValue
// ---------------------------------------------------------------------------
describe('getNestedValue', () => {
  const obj: Record<string, unknown> = {
    greeting: 'Hello',
    nested: {
      level1: {
        level2: 'deep value',
      },
      sibling: 'sibling value',
    },
    empty: '',
  };

  it('returns a top-level string value', () => {
    expect(getNestedValue(obj, 'greeting')).toBe('Hello');
  });

  it('returns a deeply nested value via dot-notation', () => {
    expect(getNestedValue(obj, 'nested.level1.level2')).toBe('deep value');
  });

  it('returns a two-level nested value', () => {
    expect(getNestedValue(obj, 'nested.sibling')).toBe('sibling value');
  });

  it('returns the path string when key does not exist', () => {
    expect(getNestedValue(obj, 'nonexistent')).toBe('nonexistent');
  });

  it('returns the path string when intermediate key does not exist', () => {
    expect(getNestedValue(obj, 'nested.missing.key')).toBe('nested.missing.key');
  });

  it('returns the path string when final value is not a string (object)', () => {
    expect(getNestedValue(obj, 'nested')).toBe('nested');
  });

  it('returns the path string when final value is not a string (nested object)', () => {
    expect(getNestedValue(obj, 'nested.level1')).toBe('nested.level1');
  });

  it('returns empty string when key maps to empty string', () => {
    expect(getNestedValue(obj, 'empty')).toBe('');
  });

  it('handles a single-segment path that is a string', () => {
    const simple: Record<string, unknown> = { foo: 'bar' };
    expect(getNestedValue(simple, 'foo')).toBe('bar');
  });

  it('returns path when traversing through null value', () => {
    const withNull: Record<string, unknown> = { a: null };
    expect(getNestedValue(withNull, 'a.b')).toBe('a.b');
  });
});

// ---------------------------------------------------------------------------
// applyParams
// ---------------------------------------------------------------------------
describe('applyParams', () => {
  it('replaces a single {{name}} placeholder', () => {
    expect(applyParams('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('replaces multiple distinct placeholders', () => {
    expect(applyParams('{{a}} and {{b}}', { a: 'foo', b: 'bar' })).toBe('foo and bar');
  });

  it('replaces the same placeholder multiple times', () => {
    expect(applyParams('{{x}} {{x}}', { x: 'hi' })).toBe('hi hi');
  });

  it('returns template unchanged when params is undefined', () => {
    expect(applyParams('Hello {{name}}!')).toBe('Hello {{name}}!');
  });

  it('leaves unmatched placeholders intact', () => {
    expect(applyParams('Hello {{unknown}}!', { name: 'World' })).toBe('Hello {{unknown}}!');
  });

  it('handles numeric param values', () => {
    expect(applyParams('Count: {{count}}', { count: 42 })).toBe('Count: 42');
  });

  it('returns template unchanged when params is an empty object', () => {
    expect(applyParams('template {{key}}', {})).toBe('template {{key}}');
  });

  it('handles template with no placeholders', () => {
    expect(applyParams('no placeholders', { x: 'y' })).toBe('no placeholders');
  });

  it('handles empty template string', () => {
    expect(applyParams('', { name: 'x' })).toBe('');
  });
});
