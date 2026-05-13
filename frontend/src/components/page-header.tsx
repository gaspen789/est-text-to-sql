import { Menu } from 'lucide-react';
import { type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LanguageSelector } from '@/components/LanguageSelector';
import { AppInfoButton } from '@/components/AppInfoButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useSidebarMenuOpen } from '@/contexts/sidebar-menu-context';
import { useChatSession } from '@/contexts/chat-session-context';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: ReactNode;
  /** Shown after the menu button (when closed) and before the title, e.g. back button */
  start?: ReactNode;
  /** Actions before the language selector on the right */
  end?: ReactNode;
  className?: string;
  titleClassName?: string;
  children?: ReactNode;
};

export function PageHeader({
  title,
  start,
  end,
  className,
  titleClassName,
  children,
}: PageHeaderProps) {
  const { open, setOpen } = useSidebarMenuOpen();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setSettingsOpen } = useChatSession();

  return (
    <header className={cn('shrink-0 border-b border-border bg-card', className)}>
      <div className="flex h-15 items-center gap-3 px-6">
        {!open && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setOpen(true)}
            title={t('common.openMenu')}
            className="shrink-0 bg-card shadow-sm"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {start}
          <h1
            className={cn(
              'min-w-0 truncate text-[22px] font-semibold tracking-[-0.02em]',
              titleClassName
            )}
          >
            {title}
          </h1>
        </div>
        {end}
        <div className="flex shrink-0 items-center gap-2 relative">
          <ThemeToggle />
          <AppInfoButton
            onOpenMyData={() => navigate({ to: '/my-data' })}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <LanguageSelector />
        </div>
      </div>
      {children}
    </header>
  );
}
