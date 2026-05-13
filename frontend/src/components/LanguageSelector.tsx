import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import type { Language } from '@/contexts/language-context';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

type LanguageSelectorProps = {
  className?: string;
};

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const languages: { code: Language; label: string }[] = [
    { code: 'et', label: t('language.et') },
    { code: 'en', label: t('language.en') },
  ];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={t('common.language') ?? 'Language'}
        title={t('common.language') ?? 'Language'}
      >
        <Globe className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 min-w-28 rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {languages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                setLanguage(lang.code);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                language === lang.code
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground hover:bg-accent/80'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
