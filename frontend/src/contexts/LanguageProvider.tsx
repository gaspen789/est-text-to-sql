import { useCallback, useState, type ReactNode } from 'react';
import {
  LanguageContext,
  STORAGE_KEY,
  applyParams,
  getNestedValue,
  translations,
  type Language,
  type TranslationParams,
} from './language-context';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'et' || stored === 'en') return stored;
    }
    return 'et';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams): string =>
      applyParams(getNestedValue(translations[language], key), params),
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
