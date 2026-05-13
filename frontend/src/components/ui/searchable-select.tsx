import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  name?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  allowClear = false,
  disabled = false,
  hasError = false,
  id,
  className,
  triggerClassName,
  name,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const effectivePlaceholder = placeholder ?? t('common.select');
  const effectiveEmptyText = emptyText ?? t('common.noResults');

  const selectedOption = React.useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value]
  );

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      const initialIndex = options.findIndex((opt) => opt.value === value);
      setHighlightedIndex(initialIndex >= 0 ? initialIndex : options.length > 0 ? 0 : -1);
      const raf = requestAnimationFrame(() => {
        listRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, options, value]);

  React.useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex}"]`);
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, open]);

  const selectIndex = (index: number) => {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        if (options.length === 0) return -1;
        const next = prev + 1;
        return next >= options.length ? 0 : next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        if (options.length === 0) return -1;
        const next = prev - 1;
        return next < 0 ? options.length - 1 : next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0) selectIndex(highlightedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const displayLabel = selectedOption?.label ?? '';

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {name !== undefined ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-card pl-3 pr-4 py-1 text-[13px] text-foreground shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50',
          hasError
            ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30 focus-visible:ring-[3px]'
            : 'border-input focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          triggerClassName
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            !selectedOption && 'text-muted-foreground'
          )}
        >
          {selectedOption ? displayLabel : effectivePlaceholder}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {allowClear && selectedOption && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
              aria-label={t('common.clear')}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </span>
      </button>

      {open ? (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          role="listbox"
        >
          <div
            ref={listRef}
            tabIndex={-1}
            onKeyDown={handleListKeyDown}
            className="max-h-60 overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-[13px] text-muted-foreground">
                {effectiveEmptyText}
              </div>
            ) : (
              options.map((opt, index) => {
                const isSelected = opt.value === value;
                const isHighlighted = index === highlightedIndex;
                return (
                  <div
                    key={opt.value}
                    data-option-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectIndex(index)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px]',
                      isHighlighted && !opt.disabled ? 'bg-muted text-foreground' : '',
                      opt.disabled ? 'cursor-not-allowed opacity-50' : ''
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.description ? (
                        <div className="truncate text-[12px] text-muted-foreground">
                          {opt.description}
                        </div>
                      ) : null}
                    </div>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
