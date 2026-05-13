import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const SHOW_AFTER_PX = 320;

function getScrollTop(target: EventTarget): number {
  if (target instanceof Document) {
    return window.scrollY;
  }
  if (target === document.documentElement || target === document.body) {
    return window.scrollY || document.documentElement.scrollTop;
  }
  if (target instanceof Element) {
    return target.scrollTop;
  }
  return 0;
}

function isMainAreaScrollTarget(target: EventTarget): boolean {
  if (target instanceof Document) return true;
  if (target === document.documentElement || target === document.body) return true;
  if (!(target instanceof Element)) return false;
  const main = document.getElementById('app-main-column');
  if (main && main.contains(target)) return true;
  return false;
}

function rememberScrollTarget(target: EventTarget): Element {
  if (target instanceof Document) {
    return document.documentElement;
  }
  if (target === document.body || target === document.documentElement) {
    return document.documentElement;
  }
  if (target instanceof Element) {
    return target;
  }
  return document.documentElement;
}

export function ScrollToTopButton() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);
  const lastScrollTargetRef = useRef<Element | null>(null);

  const onScroll = useCallback((e: Event) => {
    const target = e.target;
    if (target == null || !isMainAreaScrollTarget(target)) return;
    const top = getScrollTop(target);
    lastScrollTargetRef.current = rememberScrollTarget(target);
    setVisible(top > SHOW_AFTER_PX);
  }, []);

  useEffect(() => {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [onScroll]);

  useEffect(() => {
    setVisible(false);
    lastScrollTargetRef.current = null;
  }, [pathname]);

  const scrollToTop = useCallback(() => {
    const el = lastScrollTargetRef.current;
    if (el && el !== document.documentElement && el !== document.body) {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={scrollToTop}
      title={t('common.scrollToTop')}
      aria-label={t('common.scrollToTop')}
      className={cn(
        'fixed bottom-6 right-6 z-50 size-10 rounded-full border-border bg-card/95 shadow-md backdrop-blur-sm transition-opacity duration-200 hover:bg-accent sm:bottom-8 sm:right-8',
        visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <ChevronUp className="size-5" aria-hidden />
    </Button>
  );
}
