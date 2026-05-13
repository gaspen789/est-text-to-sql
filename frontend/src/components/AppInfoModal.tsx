import { X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

type AppInfoModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenMyData: () => void;
  onOpenSettings?: () => void;
};

export function AppInfoModal({ open, onClose, onOpenMyData, onOpenSettings }: AppInfoModalProps) {
  const { t } = useTranslation();
  const settingsAvailable = typeof onOpenSettings === 'function';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label={t('appInfo.close')}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-info-title"
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg text-card-foreground"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
          <h2 id="app-info-title" className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
            {t('appInfo.title')}
          </h2>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <section className="space-y-3">
            <p className="text-[13px] leading-6">{t('appInfo.description1')}</p>
            <p className="text-[13px] leading-6">{t('appInfo.description2')}</p>
            <p className="text-[13px] leading-6">{t('appInfo.description3')}</p>
            <p className="text-[13px] leading-6">{t('appInfo.description4')}</p>
          </section>

          <Separator />

          <section className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => {
                onClose();
                onOpenMyData();
              }}
            >
              {t('myData.title')}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={!settingsAvailable}
              title={settingsAvailable ? undefined : t('appInfo.settingsNotAvailable')}
              onClick={() => {
                if (!settingsAvailable) return;
                onClose();
                onOpenSettings?.();
              }}
            >
              {t('common.settings')}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
