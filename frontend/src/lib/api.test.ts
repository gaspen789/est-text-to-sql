import { describe, it, expect } from 'vitest';
import { normalizeModelParams } from './api';

describe('normalizeModelParams', () => {
  it('passes through array llm_other_parameters unchanged', () => {
    const params = [
      { key: 'temperature', value: '0.7' },
      { key: 'top_p', value: '0.9' },
    ];
    const input = { llm_id: 1, llm_name: 'gpt-4', llm_other_parameters: params };
    const result = normalizeModelParams(input);
    expect(result.llm_other_parameters).toStrictEqual(params);
  });

  it('converts object llm_other_parameters to array format', () => {
    const input = {
      llm_id: 2,
      llm_name: 'claude',
      llm_other_parameters: { temperature: '0.5', top_p: '1.0' },
    };
    const result = normalizeModelParams(input);
    expect(Array.isArray(result.llm_other_parameters)).toBe(true);
    const arr = result.llm_other_parameters as Array<{ key: string; value: unknown }>;
    expect(arr).toContainEqual({ key: 'temperature', value: '0.5' });
    expect(arr).toContainEqual({ key: 'top_p', value: '1.0' });
    expect(arr).toHaveLength(2);
  });

  it('converts empty object to empty array', () => {
    const input = { llm_id: 3, llm_name: 'model', llm_other_parameters: {} };
    const result = normalizeModelParams(input);
    expect(Array.isArray(result.llm_other_parameters)).toBe(true);
    expect(result.llm_other_parameters).toHaveLength(0);
  });

  it('converts null llm_other_parameters to empty array', () => {
    const input = { llm_id: 4, llm_name: 'model', llm_other_parameters: null };
    const result = normalizeModelParams(input);
    expect(Array.isArray(result.llm_other_parameters)).toBe(true);
    expect(result.llm_other_parameters).toHaveLength(0);
  });

  it('converts undefined llm_other_parameters to empty array', () => {
    const input = { llm_id: 5, llm_name: 'model', llm_other_parameters: undefined };
    const result = normalizeModelParams(input);
    expect(Array.isArray(result.llm_other_parameters)).toBe(true);
    expect(result.llm_other_parameters).toHaveLength(0);
  });

  it('preserves other fields on the model object', () => {
    const input = {
      llm_id: 6,
      llm_name: 'my-model',
      llm_version: '1.0',
      is_active_llm: true,
      llm_other_parameters: [],
    };
    const result = normalizeModelParams(input);
    expect(result.llm_id).toBe(6);
    expect(result.llm_name).toBe('my-model');
    expect(result.llm_version).toBe('1.0');
    expect(result.is_active_llm).toBe(true);
  });
});
