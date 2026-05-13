import { Moon, Sun } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      aria-label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground',
        className
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
