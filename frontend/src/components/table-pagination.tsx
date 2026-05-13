import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export type TablePageSize = 10 | 20 | 30 | 'all';

export function parseTablePageSize(value: string): TablePageSize {
  return value === 'all' ? 'all' : (parseInt(value, 10) as 10 | 20 | 30);
}

export type TablePaginationBarProps = {
  total: number;
  from: number;
  to: number;
  pageSize: TablePageSize;
  pageIndex: number;
  pageCount: number;
  onPageSizeChange: (size: TablePageSize) => void;
  onPageIndexChange: (index: number) => void;
  className?: string;
};

export function TablePaginationBar({
  total,
  from,
  to,
  pageSize,
  pageIndex,
  pageCount,
  onPageSizeChange,
  onPageIndexChange,
  className,
}: TablePaginationBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-2 pt-2',
        className
      )}
    >
      <div className="text-sm text-muted-foreground">
        {t('users.pagination.showing', { from, to, total })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">{t('users.pagination.pageSize')}</div>
          <select
            className="h-8 rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseTablePageSize(e.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value="all">{t('users.pagination.all')}</option>
          </select>
        </div>

        {pageSize === 'all' ? null : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPageIndexChange(Math.max(0, pageIndex - 1))}
              disabled={pageIndex <= 0}
            >
              {t('users.pagination.prev')}
            </Button>
            <div className="text-sm text-muted-foreground whitespace-nowrap">
              {t('users.pagination.page', { page: pageIndex + 1, pages: pageCount })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPageIndexChange(Math.min(pageCount - 1, pageIndex + 1))}
              disabled={pageIndex >= pageCount - 1}
            >
              {t('users.pagination.next')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
