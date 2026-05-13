import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AlertModalVariant = 'default' | 'destructive';

type AlertModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: AlertModalVariant;
};

export function AlertModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  variant = 'default',
}: AlertModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
        aria-describedby="alert-modal-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="mb-4 flex gap-3">
            <div
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
                variant === 'destructive' ? 'bg-destructive/15' : 'bg-amber-500/15'
              )}
            >
              <AlertCircle
                className={cn(
                  'h-5 w-5',
                  variant === 'destructive' ? 'text-destructive' : 'text-amber-600'
                )}
              />
            </div>
            <div className="min-w-0">
              <h3 id="alert-modal-title" className="text-[15px] font-semibold text-foreground">
                {title}
              </h3>
              <p id="alert-modal-desc" className="mt-1 text-[13px] text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
