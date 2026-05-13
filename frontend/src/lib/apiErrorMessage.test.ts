import { describe, it, expect, vi } from 'vitest';
import { formatApiErrorMessage, parseApiErrorJson } from './apiErrorMessage';
import type { ApiErrorJson } from './apiErrorMessage';

// ---------------------------------------------------------------------------
// formatApiErrorMessage
// ---------------------------------------------------------------------------
describe('formatApiErrorMessage', () => {
  const makeT =
    (overrides: Record<string, string> = {}) =>
    (key: string, _params?: Record<string, string | number>) =>
      overrides[key] ?? key; // by default returns the key itself (missing translation)

  it('uses translated message when code is present and translation exists', () => {
    const t = makeT({ 'apiErrors.NOT_FOUND': 'Resource not found' });
    const payload: ApiErrorJson = { code: 'NOT_FOUND' };
    expect(formatApiErrorMessage(t, payload, 'fallback.key')).toBe('Resource not found');
  });

  it('falls through to legacy error field when code translation is missing', () => {
    const t = makeT({}); // t returns the key — so msg === key
    const payload: ApiErrorJson = { code: 'UNKNOWN_CODE', error: 'Legacy error message' };
    expect(formatApiErrorMessage(t, payload, 'fallback.key')).toBe('Legacy error message');
  });

  it('uses fallback key when neither code nor legacy error is present', () => {
    const t = makeT({ 'fallback.key': 'Generic error' });
    const payload: ApiErrorJson = {};
    expect(formatApiErrorMessage(t, payload, 'fallback.key')).toBe('Generic error');
  });

  it('uses fallback key when payload is null', () => {
    const t = makeT({ 'fallback.key': 'Generic error' });
    expect(formatApiErrorMessage(t, null, 'fallback.key')).toBe('Generic error');
  });

  it('uses fallback key when payload is undefined', () => {
    const t = makeT({ 'fallback.key': 'Generic error' });
    expect(formatApiErrorMessage(t, undefined, 'fallback.key')).toBe('Generic error');
  });

  it('ignores blank legacy error string', () => {
    const t = makeT({ 'fallback.key': 'Fallback' });
    const payload: ApiErrorJson = { error: '   ' };
    expect(formatApiErrorMessage(t, payload, 'fallback.key')).toBe('Fallback');
  });

  it('passes params to translation function', () => {
    const t = vi.fn((key: string, params?: Record<string, string | number>) =>
      key === 'apiErrors.WITH_PARAMS' ? `value=${params?.count}` : key
    );
    const payload: ApiErrorJson = { code: 'WITH_PARAMS', params: { count: 42 } };
    formatApiErrorMessage(t, payload, 'fallback.key');
    expect(t).toHaveBeenCalledWith('apiErrors.WITH_PARAMS', { count: 42 });
  });

  it('returns the translation key itself as fallback when t returns key for fallbackKey', () => {
    const t = (key: string) => key; // identity — no translations
    const payload: ApiErrorJson = {};
    expect(formatApiErrorMessage(t, payload, 'some.fallback')).toBe('some.fallback');
  });
});

// ---------------------------------------------------------------------------
// parseApiErrorJson
// ---------------------------------------------------------------------------
describe('parseApiErrorJson', () => {
  function makeResponse(body: string, contentType = 'application/json'): Response {
    return new Response(body, {
      headers: { 'Content-Type': contentType },
    });
  }

  it('parses a valid JSON error body', async () => {
    const res = makeResponse(JSON.stringify({ code: 'TEST_ERROR', error: 'oops' }));
    const result = await parseApiErrorJson(res);
    expect(result).toEqual({ code: 'TEST_ERROR', error: 'oops' });
  });

  it('returns null for non-JSON content-type', async () => {
    const res = makeResponse('plain text', 'text/html');
    const result = await parseApiErrorJson(res);
    expect(result).toBeNull();
  });

  it('returns null for non-JSON content-type when content-type is missing', async () => {
    const res = new Response('body', { headers: {} });
    const result = await parseApiErrorJson(res);
    expect(result).toBeNull();
  });

  it('returns the parsed array when body is a JSON array (arrays are objects in JS)', async () => {
    // Note: the function checks `data && typeof data === 'object'`, which is true for arrays.
    // Arrays pass through — callers should handle this case if needed.
    const res = makeResponse(JSON.stringify([1, 2, 3]));
    const result = await parseApiErrorJson(res);
    // Arrays satisfy typeof x === 'object', so they are returned as-is (cast to ApiErrorJson)
    expect(result).not.toBeNull();
  });

  it('returns null when body is invalid JSON', async () => {
    const res = makeResponse('not json at all {{{');
    const result = await parseApiErrorJson(res);
    expect(result).toBeNull();
  });

  it('returns null when body is empty', async () => {
    const res = makeResponse('');
    const result = await parseApiErrorJson(res);
    expect(result).toBeNull();
  });

  it('parses legacy error format with only error field', async () => {
    const res = makeResponse(JSON.stringify({ error: 'something went wrong' }));
    const result = await parseApiErrorJson(res);
    expect(result).toEqual({ error: 'something went wrong' });
  });
});
