import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

export type AdminRangePreset = 'last7' | 'last30' | 'thisMonth' | 'thisYear' | 'custom';

function yyyyMmDd(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

export function presetToRange(preset: AdminRangePreset): {
  from: string | null;
  to: string | null;
} {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (preset === 'last7') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { from: yyyyMmDd(start), to: yyyyMmDd(end) };
  }
  if (preset === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return { from: yyyyMmDd(start), to: yyyyMmDd(end) };
  }
  if (preset === 'thisMonth') {
    return { from: yyyyMmDd(startOfMonth(now)), to: yyyyMmDd(end) };
  }
  if (preset === 'thisYear') {
    return { from: yyyyMmDd(startOfYear(now)), to: yyyyMmDd(end) };
  }
  return { from: null, to: null };
}

export function AdminDateRangePicker(props: {
  preset: AdminRangePreset;
  from: string;
  to: string;
  onPresetChange: (preset: AdminRangePreset) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onApplyPresetRange: (preset: AdminRangePreset) => void;
  autoApplyPreset?: boolean;
  showApplyButton?: boolean;
}) {
  const { t } = useTranslation();
  const {
    preset,
    from,
    to,
    onPresetChange,
    onFromChange,
    onToChange,
    onApplyPresetRange,
    autoApplyPreset = true,
    showApplyButton = true,
  } = props;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
        <div className="w-full sm:w-56">
          <div className="text-xs text-muted-foreground mb-1">{t('adminChats.timeframe')}</div>
          <select
            className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            value={preset}
            onChange={(e) => {
              const next = e.target.value as AdminRangePreset;
              onPresetChange(next);
              if (autoApplyPreset && next !== 'custom') onApplyPresetRange(next);
            }}
          >
            <option value="last7">{t('adminChats.timeframeLast7')}</option>
            <option value="last30">{t('adminChats.timeframeLast30')}</option>
            <option value="thisMonth">{t('adminChats.timeframeThisMonth')}</option>
            <option value="thisYear">{t('adminChats.timeframeThisYear')}</option>
            <option value="custom">{t('adminChats.timeframeCustom')}</option>
          </select>
        </div>

        <div className="w-full sm:w-44">
          <div className="text-xs text-muted-foreground mb-1">{t('adminChats.from')}</div>
          <Input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            disabled={preset !== 'custom'}
          />
        </div>
        <div className="w-full sm:w-44">
          <div className="text-xs text-muted-foreground mb-1">{t('adminChats.to')}</div>
          <Input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            disabled={preset !== 'custom'}
          />
        </div>
      </div>

      {showApplyButton && preset === 'custom' ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onApplyPresetRange('custom')}
            disabled={!from || !to}
          >
            {t('adminChats.apply')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
