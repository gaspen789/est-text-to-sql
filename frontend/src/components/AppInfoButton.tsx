import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

import { AppInfoModal } from './AppInfoModal';

type AppInfoButtonProps = {
  onOpenMyData: () => void;
  onOpenSettings?: () => void;
};

export function AppInfoButton({ onOpenMyData, onOpenSettings }: AppInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        title={t('appInfo.iconLabel')}
        aria-label={t('appInfo.iconLabel')}
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4 shrink-0" />
      </Button>

      <AppInfoModal
        open={open}
        onClose={() => setOpen(false)}
        onOpenMyData={onOpenMyData}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
