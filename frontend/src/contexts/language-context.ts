import { createContext } from 'react';
import et from '@/translations/et.json';
import en from '@/translations/en.json';

export type Language = 'et' | 'en';

export const translations: Record<Language, Record<string, unknown>> = { et, en };

export function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : path;
}

export type TranslationParams = Record<string, string | number>;

export function applyParams(template: string, params?: TranslationParams): string {
  if (!params) return template;
  let result = template;
  for (const [name, value] of Object.entries(params)) {
    result = result.split(`{{${name}}}`).join(String(value));
  }
  return result;
}

export interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: TranslationParams) => string;
}

export const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const STORAGE_KEY = 'app-language';
