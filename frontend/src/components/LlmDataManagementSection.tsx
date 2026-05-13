import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Edit, Plus, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, X, Search } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableSkeleton } from '@/components/table-skeleton';
import { TablePaginationBar, type TablePageSize } from '@/components/table-pagination';
import { useTranslation } from '@/hooks/useTranslation';
import { apiPost, apiPut, apiDelete, apiFetchJson, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';
import { useModal } from '@/contexts/modal-context';

type TabKey = 'apis' | 'pricing';

interface ApiRow {
  llm_api_id?: number;
  llm_id?: number;
  llm_name?: string;
  is_active_llm?: boolean;
  api_key?: string;
  request_url?: string;
  token_limit_per_minute?: number | null;
  request_limit_per_minute?: number | null;
  request_limit_per_day?: number | null;
  [key: string]: any;
}

interface PriceRow {
  llm_price_id?: number;
  llm_id?: number;
  llm_name?: string;
  is_active_llm?: boolean;
  llm_price_per_unit?: number | null;
  llm_unit_size?: number | null;
  llm_min_unit_size?: number | null;
  llm_max_unit_size?: number | null;
  currency?: string;
  modality_name?: string;
  is_input?: boolean;
  is_batch?: boolean;
  price_valid_from?: string | null;
  price_valid_until?: string | null;
  [key: string]: any;
}

interface ModelName {
  llm_id: number;
  llm_name: string;
}

function formatBoolCell(value: any, t: (k: string) => string): string {
  return value ? t('common.yes') : t('common.no');
}

function formatDateCell(value: any): string {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

interface SupportedModalityRow {
  llm_supported_modality_id?: number;
  modality_name?: string;
  is_input?: boolean;
}

interface UnitTypeRow {
  unit_type_code: string;
  unit_type_name?: string;
}

interface Currency {
  currency_code: string;
  currency_name?: string;
}

type PriceSizingMode = 'fixed' | 'range';

interface PriceFormState {
  llm_id?: number;
  llm_supported_modality_ids: string[];
  currency_code: string;
  unit_type_code: string;
  price_per_unit: string;
  pricingSizingMode: PriceSizingMode;
  unit_size: string;
  min_unit_size: string;
  max_unit_size: string;
  is_batch: boolean;
  valid_from_time: string;
  valid_until_time: string;
}

function formatDateForInput(dateValue: any): string {
  if (!dateValue) return '';
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
}

/** Live check for CHK_LLM_price_unit_size_and_min_max_unit_size (XOR fixed size vs min–max range). */
function pricingSizingConstraintViolation(form: PriceFormState): 'xor' | 'minmaxPair' | null {
  const u = form.unit_size.trim();
  const min = form.min_unit_size.trim();
  const max = form.max_unit_size.trim();
  if (form.pricingSizingMode === 'fixed') {
    if (min !== '' || max !== '') return 'xor';
    return null;
  }
  if (u !== '') return 'xor';
  // Min is required in range mode; max may be omitted (treated as "infinite" on submit).
  if (min === '' && max !== '') return 'minmaxPair';
  return null;
}

const emptyPriceForm = (): PriceFormState => ({
  llm_id: undefined,
  llm_supported_modality_ids: [],
  currency_code: 'USD',
  unit_type_code: 'TOK',
  price_per_unit: '',
  pricingSizingMode: 'fixed',
  unit_size: '',
  min_unit_size: '',
  max_unit_size: '',
  is_batch: false,
  valid_from_time: '',
  valid_until_time: '',
});

function priceRowToFormData(row: PriceRow): PriceFormState {
  const hasUnit = row.llm_unit_size != null && String(row.llm_unit_size).trim() !== '';
  const hasRange =
    (row.llm_min_unit_size != null && String(row.llm_min_unit_size).trim() !== '') ||
    (row.llm_max_unit_size != null && String(row.llm_max_unit_size).trim() !== '');
  const pricingSizingMode: PriceSizingMode = hasUnit ? 'fixed' : hasRange ? 'range' : 'fixed';

  return {
    llm_id: row.llm_id,
    llm_supported_modality_ids: [],
    currency_code: row.currency ? String(row.currency) : 'USD',
    unit_type_code: 'TOK',
    price_per_unit: row.llm_price_per_unit != null ? String(row.llm_price_per_unit) : '',
    pricingSizingMode,
    unit_size: row.llm_unit_size != null ? String(row.llm_unit_size) : '',
    min_unit_size: row.llm_min_unit_size != null ? String(row.llm_min_unit_size) : '',
    max_unit_size: row.llm_max_unit_size != null ? String(row.llm_max_unit_size) : '',
    is_batch: row.is_batch !== undefined ? Boolean(row.is_batch) : false,
    valid_from_time: formatDateForInput(row.price_valid_from),
    valid_until_time: formatDateForInput(row.price_valid_until),
  };
}

// ─── APIs Tab ───────────────────────────────────────────────────────────

function ApisTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm } = useModal();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<TablePageSize>(20);

  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingRow, setEditingRow] = useState<ApiRow | null>(null);
  const [formData, setFormData] = useState({
    llm_id: undefined as number | undefined,
    api_key: '',
    request_url: '',
    token_limit_per_minute: '',
    request_limit_per_minute: '',
    request_limit_per_day: '',
    is_active: true,
  });
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  const { data: apiData = [], isLoading } = useQuery({
    queryKey: queryKeys.allApiData,
    queryFn: () => apiFetchJson<ApiRow[]>('/api/llm-api-all'),
  });

  const { data: llmNames = [] } = useQuery({
    queryKey: queryKeys.llmNames,
    queryFn: () => apiFetchJson<ModelName[]>('/api/llm-names'),
    enabled: isAdding,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return apiData;
    const q = search.toLowerCase();
    return apiData.filter(
      (r) =>
        (r.llm_name ?? '').toLowerCase().includes(q) ||
        (r.api_key ?? '').toLowerCase().includes(q) ||
        (r.request_url ?? '').toLowerCase().includes(q)
    );
  }, [apiData, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const displayData =
    pageSize === 'all' ? sorted : sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const from = total === 0 ? 0 : pageIndex * (pageSize === 'all' ? total : pageSize) + 1;
  const to = pageSize === 'all' ? total : Math.min((pageIndex + 1) * pageSize, total);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: string }) =>
    sortKey === col ? (
      sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )
    ) : (
      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
    );

  const saveMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await apiPost('/api/llm-api', body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, err, 'apiSection.addFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allApiData });
      toast.success(t('apiSection.addSuccess'));
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => {
      const res = await apiPut(`/api/llm-api/${id}`, body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, err, 'apiSection.updateFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allApiData });
      toast.success(t('apiSection.updateSuccess'));
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiDelete(`/api/llm-api/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, err, 'apiSection.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allApiData });
      toast.success(t('apiSection.deleteSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const closeForm = () => {
    setIsAdding(false);
    setIsEditing(false);
    setEditingRow(null);
    setFieldErrors(new Set());
    setFormData({
      llm_id: undefined,
      api_key: '',
      request_url: '',
      token_limit_per_minute: '',
      request_limit_per_minute: '',
      request_limit_per_day: '',
      is_active: true,
    });
  };

  const openAdd = () => {
    closeForm();
    setIsAdding(true);
  };

  const openEdit = (row: ApiRow) => {
    setEditingRow(row);
    setFormData({
      llm_id: row.llm_id,
      api_key: row.api_key ?? '',
      request_url: row.request_url ?? '',
      token_limit_per_minute:
        row.token_limit_per_minute != null ? String(row.token_limit_per_minute) : '',
      request_limit_per_minute:
        row.request_limit_per_minute != null ? String(row.request_limit_per_minute) : '',
      request_limit_per_day:
        row.request_limit_per_day != null ? String(row.request_limit_per_day) : '',
      is_active: true,
    });
    setFieldErrors(new Set());
    setIsEditing(true);
  };

  const handleSubmit = () => {
    const errors = new Set<string>();
    if (!formData.api_key.trim()) errors.add('api_key');
    if (!formData.llm_id) errors.add('llm_id');
    setFieldErrors(errors);
    if (errors.size > 0) {
      toast.error(t('apiSection.fillRequired'));
      return;
    }
    const body = {
      llm_id: formData.llm_id,
      api_key: formData.api_key.trim(),
      request_url: formData.request_url.trim() || null,
      token_limit_per_minute: formData.token_limit_per_minute
        ? parseInt(formData.token_limit_per_minute)
        : null,
      request_limit_per_minute: formData.request_limit_per_minute
        ? parseInt(formData.request_limit_per_minute)
        : null,
      request_limit_per_day: formData.request_limit_per_day
        ? parseInt(formData.request_limit_per_day)
        : null,
      is_active: formData.is_active,
    };
    if (isEditing && editingRow?.llm_api_id)
      updateMutation.mutate({ id: editingRow.llm_api_id, body });
    else saveMutation.mutate(body);
  };

  const columns: { key: string; label: string }[] = [
    { key: 'llm_name', label: t('llmData.llmName') },
    { key: 'api_key', label: t('apiSection.columns.api_key') },
    { key: 'request_url', label: t('apiSection.columns.request_url') },
    { key: 'token_limit_per_minute', label: t('apiSection.columns.token_limit_per_minute') },
    { key: 'request_limit_per_minute', label: t('apiSection.columns.request_limit_per_minute') },
    { key: 'request_limit_per_day', label: t('apiSection.columns.request_limit_per_day') },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPageIndex(0);
            }}
            placeholder={t('llmData.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Button
          size="sm"
          onClick={openAdd}
          className="flex items-center gap-2 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
        >
          <Plus className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          {t('apiSection.addNew')}
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton columns={7} rows={4} />
      ) : displayData.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('llmData.noData')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28 sticky left-0 z-10 bg-card border-r border-border">
                    {t('common.actions')}
                  </TableHead>
                  {columns.map((col) => (
                    <TableHead key={col.key}>
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {col.label} <SortIcon col={col.key} />
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.map((row, i) => (
                  <TableRow key={row.llm_api_id ?? i} className="group">
                    <TableCell className="sticky left-0 z-10 bg-card group-hover:bg-muted/50 border-r border-border">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(row)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('apiSection.editRow')}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            navigate({
                              to: '/llm/$llmid',
                              params: { llmid: String(row.llm_id) },
                            } as any)
                          }
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('llmData.openDetail')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        {row[col.key] != null ? String(row[col.key]) : '-'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePaginationBar
            total={total}
            from={from}
            to={to}
            pageSize={pageSize}
            pageIndex={pageIndex}
            pageCount={pageCount}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPageIndex(0);
            }}
            onPageIndexChange={setPageIndex}
          />
        </>
      )}

      {(isAdding || isEditing) && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">
                {isEditing ? t('apiSection.editTitle') : t('apiSection.addTitle')}
              </h2>
              <Button variant="ghost" size="sm" onClick={closeForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              className="p-6"
              noValidate
            >
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>
                    {t('llmData.llmName')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={formData.llm_id ? String(formData.llm_id) : ''}
                    onChange={(v) => {
                      setFormData((p) => ({ ...p, llm_id: v ? parseInt(v) : undefined }));
                      if (v)
                        setFieldErrors((p) => {
                          const s = new Set(p);
                          s.delete('llm_id');
                          return s;
                        });
                    }}
                    options={llmNames.map((m) => ({ value: String(m.llm_id), label: m.llm_name }))}
                    placeholder={t('apiSection.selectModel')}
                    hasError={fieldErrors.has('llm_id')}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('apiSection.columns.api_key')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={formData.api_key}
                    onChange={(e) => setFormData((p) => ({ ...p, api_key: e.target.value }))}
                    className={fieldErrors.has('api_key') ? 'border-destructive' : ''}
                  />
                </Field>
                <Field className="col-span-2">
                  <FieldLabel>{t('apiSection.columns.request_url')}</FieldLabel>
                  <Input
                    type="url"
                    value={formData.request_url}
                    onChange={(e) => setFormData((p) => ({ ...p, request_url: e.target.value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('apiSection.columns.request_limit_per_minute')}</FieldLabel>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.request_limit_per_minute}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, request_limit_per_minute: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('apiSection.columns.request_limit_per_day')}</FieldLabel>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.request_limit_per_day}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, request_limit_per_day: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('apiSection.columns.token_limit_per_minute')}</FieldLabel>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.token_limit_per_minute}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, token_limit_per_minute: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-6 border-t">
                <div className="flex flex-wrap gap-2">
                  {isEditing && editingRow?.llm_api_id ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={async () => {
                        const id = editingRow.llm_api_id!;
                        const ok = await confirm({
                          message: t('apiSection.confirmDelete'),
                          destructive: true,
                        });
                        if (!ok) return;
                        deleteMutation.mutate(id, { onSuccess: () => closeForm() });
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeForm}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit">
                    {isEditing ? t('apiSection.updateSubmit') : t('apiSection.addSubmit')}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Pricing Tab ────────────────────────────────────────────────────────

const PRICE_COLUMNS = [
  'llm_name',
  'llm_price_per_unit',
  'currency',
  'modality_name',
  'llm_unit_size',
  'llm_min_unit_size',
  'llm_max_unit_size',
  'is_input',
  'is_batch',
  'price_valid_from',
  'price_valid_until',
] as const;

function PricingTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm } = useModal();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<TablePageSize>(20);
  const [viewingRow, setViewingRow] = useState<PriceRow | null>(null);
  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editingPriceRow, setEditingPriceRow] = useState<PriceRow | null>(null);
  const [priceFormData, setPriceFormData] = useState<PriceFormState>(emptyPriceForm());
  const [priceFieldErrors, setPriceFieldErrors] = useState<Set<string>>(new Set());

  const { data: priceData = [], isLoading } = useQuery({
    queryKey: queryKeys.allPrices,
    queryFn: () => apiFetchJson<PriceRow[]>('/api/llm-price-all'),
  });

  const showPriceForm = isAddingPrice || isEditingPrice;

  const { data: llmNames = [] } = useQuery({
    queryKey: queryKeys.llmNames,
    queryFn: () => apiFetchJson<ModelName[]>('/api/llm-names'),
    enabled: showPriceForm,
  });

  const selectedModelId = priceFormData.llm_id;

  const { data: supportedModalities = [] } = useQuery({
    queryKey: queryKeys.supportedModalities(selectedModelId ?? 0),
    queryFn: () => apiFetchJson<SupportedModalityRow[]>(`/api/llm-modality/${selectedModelId}`),
    enabled: showPriceForm && Boolean(selectedModelId),
  });

  const supportedModalityOptions = useMemo(
    () => supportedModalities.filter((s) => s.llm_supported_modality_id != null),
    [supportedModalities]
  );
  const selectedSupportedModalityCount = useMemo(() => {
    if (supportedModalityOptions.length === 0) return 0;
    const selected = new Set(priceFormData.llm_supported_modality_ids);
    let count = 0;
    for (const s of supportedModalityOptions) {
      const idStr = String(s.llm_supported_modality_id);
      if (selected.has(idStr)) count++;
    }
    return count;
  }, [priceFormData.llm_supported_modality_ids, supportedModalityOptions]);
  const allSupportedModalitiesSelected =
    supportedModalityOptions.length > 0 &&
    selectedSupportedModalityCount === supportedModalityOptions.length;

  const { data: unitTypes = [] } = useQuery({
    queryKey: queryKeys.unitTypes,
    queryFn: () => apiFetchJson<UnitTypeRow[]>('/api/unit-types'),
    enabled: showPriceForm,
  });

  const { data: currencies = [] } = useQuery({
    queryKey: queryKeys.currencies,
    queryFn: () => apiFetchJson<Currency[]>('/api/valuutad'),
    enabled: showPriceForm,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return priceData;
    const q = search.toLowerCase();
    return priceData.filter(
      (r) =>
        (r.llm_name ?? '').toLowerCase().includes(q) ||
        (r.modality_name ?? '').toLowerCase().includes(q) ||
        (r.currency ?? '').toLowerCase().includes(q)
    );
  }, [priceData, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const displayData =
    pageSize === 'all' ? sorted : sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const from = total === 0 ? 0 : pageIndex * (pageSize === 'all' ? total : pageSize) + 1;
  const to = pageSize === 'all' ? total : Math.min((pageIndex + 1) * pageSize, total);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const SortIcon = ({ col }: { col: string }) =>
    sortKey === col ? (
      sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )
    ) : (
      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
    );

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiDelete(`/api/llm-price/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, err, 'pricing.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allPrices });
      toast.success(t('pricing.deleteSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePriceMutation = useMutation({
    mutationFn: async (bodies: object[]) => {
      const responses = await Promise.all(bodies.map((body) => apiPost('/api/llm-price', body)));
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        const errorData = await failed.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'pricing.addFailed'));
      }
    },
    onSuccess: (_, bodies) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allPrices });
      toast.success(
        bodies.length > 1
          ? t('pricing.addSuccessMany', { count: bodies.length })
          : t('pricing.addSuccess')
      );
      closePriceForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePriceMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => {
      const res = await apiPut(`/api/llm-price/${id}`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'pricing.updateFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allPrices });
      toast.success(t('pricing.updateSuccess'));
      closePriceForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const closePriceForm = () => {
    setIsAddingPrice(false);
    setIsEditingPrice(false);
    setEditingPriceRow(null);
    setPriceFormData(emptyPriceForm());
    setPriceFieldErrors(new Set());
  };

  const openAddPrice = () => {
    setPriceFormData(emptyPriceForm());
    setPriceFieldErrors(new Set());
    setEditingPriceRow(null);
    setIsEditingPrice(false);
    setIsAddingPrice(true);
  };

  const openEditPrice = (row: PriceRow) => {
    setEditingPriceRow(row);
    setPriceFormData(priceRowToFormData(row));
    setPriceFieldErrors(new Set());
    setIsAddingPrice(false);
    setIsEditingPrice(true);
  };

  const sizingLiveViolation = useMemo(
    () => pricingSizingConstraintViolation(priceFormData),
    [
      priceFormData.pricingSizingMode,
      priceFormData.unit_size,
      priceFormData.min_unit_size,
      priceFormData.max_unit_size,
    ]
  );

  const validateAndParsePriceForm = () => {
    const errors = new Set<string>();
    if (!priceFormData.llm_id) errors.add('llm_id');
    if (priceFormData.llm_supported_modality_ids.length === 0)
      errors.add('llm_supported_modality_id');
    if (!priceFormData.currency_code) errors.add('currency_code');
    if (!priceFormData.unit_type_code) errors.add('unit_type_code');

    const violation = pricingSizingConstraintViolation(priceFormData);
    if (violation) errors.add('unit_sizing');

    if (priceFormData.pricingSizingMode === 'fixed') {
      if (priceFormData.unit_size.trim() === '') errors.add('unit_size');
    } else {
      if (priceFormData.min_unit_size.trim() === '') errors.add('min_unit_size');
    }

    if (!priceFormData.price_per_unit || priceFormData.price_per_unit.trim() === '') {
      errors.add('price_per_unit');
    }

    setPriceFieldErrors(errors);
    if (errors.size > 0) {
      toast.error(t('pricing.fillRequired'));
      return null;
    }

    const parsedPrice = parseFloat(priceFormData.price_per_unit);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error(t('pricing.pricePositive'));
      setPriceFieldErrors((prev) => new Set(prev).add('price_per_unit'));
      return null;
    }

    let unitSize: number | null = null;
    let minUnitSize: number | null = null;
    let maxUnitSize: number | null = null;

    if (priceFormData.pricingSizingMode === 'fixed') {
      const u = parseInt(priceFormData.unit_size, 10);
      if (u <= 0 || !Number.isInteger(u)) {
        toast.error(t('pricing.unitPositiveInt'));
        return null;
      }
      unitSize = u;
    } else {
      const mn = parseInt(priceFormData.min_unit_size, 10);
      const maxRaw = priceFormData.max_unit_size.trim();
      const mx = maxRaw === '' ? Number.MAX_SAFE_INTEGER : parseInt(maxRaw, 10);
      if (mn <= 0 || !Number.isInteger(mn)) {
        toast.error(t('pricing.minPositiveInt'));
        return null;
      }
      if (mx <= 0 || !Number.isInteger(mx)) {
        toast.error(t('pricing.maxPositiveInt'));
        return null;
      }
      if (mn > mx) {
        toast.error(t('pricing.minLeMax'));
        return null;
      }
      minUnitSize = mn;
      maxUnitSize = mx;
    }

    const minDate = new Date('2010-01-01T00:00:00+02:00');
    const maxDate = new Date('2101-01-01T00:00:00+02:00');
    let validFromDate: Date | null = null;
    let validUntilDate: Date | null = null;

    if (priceFormData.valid_from_time) {
      validFromDate = new Date(priceFormData.valid_from_time);
      if (validFromDate < minDate || validFromDate >= maxDate) {
        toast.error(t('pricing.validFromRange'));
        return null;
      }
    }
    if (priceFormData.valid_until_time) {
      validUntilDate = new Date(priceFormData.valid_until_time);
      if (validUntilDate < minDate || validUntilDate >= maxDate) {
        toast.error(t('pricing.validUntilRange'));
        return null;
      }
    }
    if (validFromDate && validUntilDate && validFromDate >= validUntilDate) {
      toast.error(t('pricing.validFromBeforeUntil'));
      return null;
    }

    const llmSupportedModalityIds = [
      ...new Set(
        priceFormData.llm_supported_modality_ids
          .map((id) => parseInt(id, 10))
          .filter((n) => !isNaN(n))
      ),
    ];
    if (llmSupportedModalityIds.length === 0) {
      toast.error(t('pricing.fillRequired'));
      return null;
    }

    return {
      llm_id: priceFormData.llm_id,
      llm_supported_modality_ids: llmSupportedModalityIds,
      currency_code: priceFormData.currency_code,
      unit_type_code: priceFormData.unit_type_code,
      price_per_unit: parsedPrice,
      unit_size: unitSize,
      min_unit_size: minUnitSize,
      max_unit_size: maxUnitSize,
      is_batch: priceFormData.is_batch,
      valid_from_time: validFromDate ? validFromDate.toISOString() : null,
      valid_until_time: validUntilDate ? validUntilDate.toISOString() : null,
    };
  };

  const handleSubmitPrice = () => {
    const parsed = validateAndParsePriceForm();
    if (!parsed) return;

    if (!parsed.llm_id) {
      toast.error(t('pricing.fillRequired'));
      return;
    }

    const bodies = parsed.llm_supported_modality_ids.map((supportedId: number) => ({
      llm_id: parsed.llm_id,
      llm_supported_modality_id: supportedId,
      currency_code: parsed.currency_code,
      unit_type_code: parsed.unit_type_code,
      price_per_unit: parsed.price_per_unit,
      ...(parsed.unit_size != null ? { unit_size: parsed.unit_size } : {}),
      ...(parsed.min_unit_size != null ? { min_unit_size: parsed.min_unit_size } : {}),
      ...(parsed.max_unit_size != null ? { max_unit_size: parsed.max_unit_size } : {}),
      is_batch: parsed.is_batch,
      valid_from_time: parsed.valid_from_time,
      valid_until_time: parsed.valid_until_time,
    }));

    if (isEditingPrice && editingPriceRow?.llm_price_id) {
      if (bodies.length !== 1) {
        toast.error(t('pricing.editOneOnly'));
        return;
      }
      updatePriceMutation.mutate({ id: editingPriceRow.llm_price_id, body: bodies[0] });
    } else {
      savePriceMutation.mutate(bodies);
    }
  };

  const columnLabels: Record<string, string> = {
    llm_name: t('llmData.llmName'),
    llm_price_per_unit: t('pricing.columns.llm_price_per_unit'),
    currency: t('pricing.columns.currency'),
    modality_name: t('pricing.columns.modality_name'),
    llm_unit_size: t('pricing.columns.llm_unit_size'),
    llm_min_unit_size: t('pricing.columns.llm_min_unit_size'),
    llm_max_unit_size: t('pricing.columns.llm_max_unit_size'),
    is_input: t('pricing.columns.is_input'),
    is_batch: t('pricing.columns.is_batch'),
    price_valid_from: t('pricing.columns.price_valid_from'),
    price_valid_until: t('pricing.columns.price_valid_until'),
  };

  const formatCell = (key: string, value: any) => {
    if (key === 'is_input' || key === 'is_batch') return formatBoolCell(value, t);
    if (key === 'price_valid_from' || key === 'price_valid_until') return formatDateCell(value);
    return value != null ? String(value) : '-';
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPageIndex(0);
            }}
            placeholder={t('llmData.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Button
          size="sm"
          onClick={openAddPrice}
          className="flex items-center gap-2 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
        >
          <Plus className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          {t('pricing.addNew')}
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton columns={8} rows={4} />
      ) : displayData.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('llmData.noData')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28 sticky left-0 z-10 bg-card border-r border-border">
                    {t('common.actions')}
                  </TableHead>
                  {PRICE_COLUMNS.map((key) => (
                    <TableHead key={key}>
                      <button
                        onClick={() => toggleSort(key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {columnLabels[key] ?? key} <SortIcon col={key} />
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.map((row, i) => (
                  <TableRow key={row.llm_price_id ?? i} className="group">
                    <TableCell className="sticky left-0 z-10 bg-card group-hover:bg-muted/50 border-r border-border">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditPrice(row)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('llmData.editInDetail')}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            navigate({
                              to: '/llm/$llmid',
                              params: { llmid: String(row.llm_id) },
                            } as any)
                          }
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('llmData.openDetail')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    {PRICE_COLUMNS.map((key) => (
                      <TableCell key={key}>{formatCell(key, row[key])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePaginationBar
            total={total}
            from={from}
            to={to}
            pageSize={pageSize}
            pageIndex={pageIndex}
            pageCount={pageCount}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPageIndex(0);
            }}
            onPageIndexChange={setPageIndex}
          />
        </>
      )}

      {showPriceForm && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">
                {isEditingPrice ? t('pricing.editTitle') : t('pricing.addTitle')}
              </h2>
              <Button variant="ghost" size="sm" onClick={closePriceForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              onKeyDown={(e) => {
                // Prevent implicit form submit on Enter; save must be explicit button click.
                if (e.key === 'Enter') e.preventDefault();
              }}
              className="p-6"
              noValidate
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field className="md:col-span-2">
                  <FieldLabel>
                    {t('llmData.llmName')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={priceFormData.llm_id != null ? String(priceFormData.llm_id) : ''}
                    onChange={(v) => {
                      const nextId = v ? parseInt(v, 10) : undefined;
                      setPriceFormData((prev) => ({
                        ...prev,
                        llm_id: nextId,
                        llm_supported_modality_ids: [],
                      }));
                      setPriceFieldErrors((prev) => {
                        const s = new Set(prev);
                        s.delete('llm_id');
                        s.delete('llm_supported_modality_id');
                        return s;
                      });
                    }}
                    options={llmNames.map((m) => ({ value: String(m.llm_id), label: m.llm_name }))}
                    placeholder={t('apiSection.selectModel')}
                    hasError={priceFieldErrors.has('llm_id')}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>
                    {t('pricing.supportedModalities')} <RequiredMark />
                  </FieldLabel>
                  {isAddingPrice ? (
                    <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="text-xs text-muted-foreground">
                          {supportedModalityOptions.length > 0
                            ? `${selectedSupportedModalityCount}/${supportedModalityOptions.length}`
                            : null}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              !priceFormData.llm_id ||
                              supportedModalityOptions.length === 0 ||
                              allSupportedModalitiesSelected
                            }
                            onClick={() => {
                              const allIds = supportedModalityOptions.map((s) =>
                                String(s.llm_supported_modality_id)
                              );
                              setPriceFormData((prev) => ({
                                ...prev,
                                llm_supported_modality_ids: allIds,
                              }));
                              setPriceFieldErrors((pe) => {
                                const n = new Set(pe);
                                n.delete('llm_supported_modality_id');
                                return n;
                              });
                            }}
                          >
                            {t('common.selectAll')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              !priceFormData.llm_id ||
                              supportedModalityOptions.length === 0 ||
                              selectedSupportedModalityCount === 0
                            }
                            onClick={() =>
                              setPriceFormData((prev) => ({
                                ...prev,
                                llm_supported_modality_ids: [],
                              }))
                            }
                          >
                            {t('common.deselectAll')}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {supportedModalityOptions.map((s) => {
                          const idStr = String(s.llm_supported_modality_id);
                          const checked = priceFormData.llm_supported_modality_ids.includes(idStr);
                          return (
                            <label key={idStr} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  let nextIds: string[] = [];
                                  setPriceFormData((prev) => {
                                    const next = new Set(prev.llm_supported_modality_ids);
                                    if (next.has(idStr)) next.delete(idStr);
                                    else next.add(idStr);
                                    nextIds = Array.from(next);
                                    return { ...prev, llm_supported_modality_ids: nextIds };
                                  });
                                  if (nextIds.length > 0) {
                                    setPriceFieldErrors((pe) => {
                                      const n = new Set(pe);
                                      n.delete('llm_supported_modality_id');
                                      return n;
                                    });
                                  }
                                }}
                                className="text-primary rounded border-input"
                              />
                              <span>
                                {s.modality_name ?? ''}{' '}
                                {s.is_input
                                  ? `(${t('modalitiesSection.input')})`
                                  : `(${t('modalitiesSection.output')})`}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <SearchableSelect
                      value={priceFormData.llm_supported_modality_ids[0] ?? ''}
                      onChange={(v) => {
                        setPriceFormData((prev) => ({
                          ...prev,
                          llm_supported_modality_ids: v ? [v] : [],
                        }));
                        if (v)
                          setPriceFieldErrors((prev) => {
                            const s = new Set(prev);
                            s.delete('llm_supported_modality_id');
                            return s;
                          });
                      }}
                      options={supportedModalityOptions.map((s) => ({
                        value: String(s.llm_supported_modality_id),
                        label: `${s.modality_name ?? ''} ${
                          s.is_input
                            ? `(${t('modalitiesSection.input')})`
                            : `(${t('modalitiesSection.output')})`
                        }`,
                      }))}
                      placeholder={t('pricing.selectSupportedModality')}
                      hasError={priceFieldErrors.has('llm_supported_modality_id')}
                    />
                  )}
                  {!priceFormData.llm_id ? (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('pricing.chooseModelFirst')}
                    </p>
                  ) : supportedModalities.length === 0 ? (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('pricing.noSupportedModalities')}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('pricing.selectSupportedModalitiesHint')}
                    </p>
                  )}
                </Field>

                <Field>
                  <FieldLabel>
                    {t('pricing.columns.currency')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={priceFormData.currency_code}
                    onChange={(v) => {
                      setPriceFormData((prev) => ({ ...prev, currency_code: v || '' }));
                      setPriceFieldErrors((prev) => {
                        const s = new Set(prev);
                        s.delete('currency_code');
                        return s;
                      });
                    }}
                    options={currencies.map((c) => ({
                      value: c.currency_code,
                      label: c.currency_name
                        ? `${c.currency_code} — ${c.currency_name}`
                        : c.currency_code,
                    }))}
                    placeholder={t('common.select')}
                    hasError={priceFieldErrors.has('currency_code')}
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('pricing.unitType')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={priceFormData.unit_type_code}
                    onChange={(v) => {
                      setPriceFormData((prev) => ({ ...prev, unit_type_code: v || '' }));
                      setPriceFieldErrors((prev) => {
                        const s = new Set(prev);
                        s.delete('unit_type_code');
                        return s;
                      });
                    }}
                    options={unitTypes.map((u) => ({
                      value: u.unit_type_code,
                      label: u.unit_type_name
                        ? `${u.unit_type_code} — ${u.unit_type_name}`
                        : u.unit_type_code,
                    }))}
                    placeholder={t('common.select')}
                    hasError={priceFieldErrors.has('unit_type_code')}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="price_per_unit">
                    {t('pricing.columns.llm_price_per_unit')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="price_per_unit"
                    value={priceFormData.price_per_unit}
                    onChange={(e) => {
                      setPriceFormData((prev) => ({ ...prev, price_per_unit: e.target.value }));
                      if (e.target.value.trim())
                        setPriceFieldErrors((prev) => {
                          const s = new Set(prev);
                          s.delete('price_per_unit');
                          return s;
                        });
                    }}
                    className={priceFieldErrors.has('price_per_unit') ? 'border-destructive' : ''}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>{t('pricing.pricingSizingMode')}</FieldLabel>
                  <div className="flex gap-6 mt-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="pricingSizingMode"
                        value="fixed"
                        checked={priceFormData.pricingSizingMode === 'fixed'}
                        onChange={() =>
                          setPriceFormData((prev) => ({
                            ...prev,
                            pricingSizingMode: 'fixed',
                            min_unit_size: '',
                            max_unit_size: '',
                          }))
                        }
                        className="text-primary"
                      />
                      {t('pricing.pricingSizingFixed')}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="pricingSizingMode"
                        value="range"
                        checked={priceFormData.pricingSizingMode === 'range'}
                        onChange={() =>
                          setPriceFormData((prev) => ({
                            ...prev,
                            pricingSizingMode: 'range',
                            unit_size: '',
                          }))
                        }
                        className="text-primary"
                      />
                      {t('pricing.pricingSizingRange')}
                    </label>
                  </div>
                  {sizingLiveViolation && (
                    <p className="text-sm text-destructive mt-2" role="alert">
                      {sizingLiveViolation === 'xor'
                        ? t('pricing.sizingXor')
                        : t('pricing.minMaxBothRequired')}
                    </p>
                  )}
                </Field>

                {priceFormData.pricingSizingMode === 'fixed' ? (
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="unit_size">
                      {t('pricing.tokenCount')} <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="unit_size"
                      type="number"
                      min="1"
                      step="1"
                      value={priceFormData.unit_size}
                      onChange={(e) => {
                        setPriceFormData((prev) => ({ ...prev, unit_size: e.target.value }));
                        if (e.target.value.trim())
                          setPriceFieldErrors((prev) => {
                            const s = new Set(prev);
                            s.delete('unit_size');
                            s.delete('unit_sizing');
                            return s;
                          });
                      }}
                      className={
                        priceFieldErrors.has('unit_size') || priceFieldErrors.has('unit_sizing')
                          ? 'border-destructive focus-visible:border-destructive'
                          : ''
                      }
                    />
                  </Field>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="min_unit_size">
                        {t('pricing.minTokens')} <RequiredMark />
                      </FieldLabel>
                      <Input
                        id="min_unit_size"
                        type="number"
                        min="1"
                        step="1"
                        value={priceFormData.min_unit_size}
                        onChange={(e) => {
                          setPriceFormData((prev) => ({ ...prev, min_unit_size: e.target.value }));
                          setPriceFieldErrors((prev) => {
                            const s = new Set(prev);
                            s.delete('min_unit_size');
                            s.delete('unit_sizing');
                            return s;
                          });
                        }}
                        className={
                          priceFieldErrors.has('min_unit_size') ||
                          priceFieldErrors.has('unit_sizing')
                            ? 'border-destructive focus-visible:border-destructive'
                            : ''
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="max_unit_size">{t('pricing.maxTokens')}</FieldLabel>
                      <Input
                        id="max_unit_size"
                        type="number"
                        min="1"
                        step="1"
                        value={priceFormData.max_unit_size}
                        onChange={(e) => {
                          setPriceFormData((prev) => ({ ...prev, max_unit_size: e.target.value }));
                          setPriceFieldErrors((prev) => {
                            const s = new Set(prev);
                            s.delete('max_unit_size');
                            s.delete('unit_sizing');
                            return s;
                          });
                        }}
                        className={
                          priceFieldErrors.has('max_unit_size') ||
                          priceFieldErrors.has('unit_sizing')
                            ? 'border-destructive focus-visible:border-destructive'
                            : ''
                        }
                      />
                    </Field>
                  </>
                )}

                <Field>
                  <FieldLabel htmlFor="valid_from_time">{t('pricing.validFrom')}</FieldLabel>
                  <Input
                    id="valid_from_time"
                    type="datetime-local"
                    min="2010-01-01T00:00"
                    max="2100-12-31T23:59"
                    value={priceFormData.valid_from_time}
                    onChange={(e) =>
                      setPriceFormData((prev) => ({ ...prev, valid_from_time: e.target.value }))
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="valid_until_time">{t('pricing.validUntil')}</FieldLabel>
                  <Input
                    id="valid_until_time"
                    type="datetime-local"
                    min="2010-01-01T00:00"
                    max="2100-12-31T23:59"
                    value={priceFormData.valid_until_time}
                    onChange={(e) =>
                      setPriceFormData((prev) => ({ ...prev, valid_until_time: e.target.value }))
                    }
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>{t('pricing.isBatch')}</FieldLabel>
                  <div className="flex gap-6 mt-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="is_batch_form"
                        value="true"
                        checked={priceFormData.is_batch === true}
                        onChange={() => setPriceFormData((prev) => ({ ...prev, is_batch: true }))}
                        className="text-primary"
                      />
                      {t('common.yes')}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="is_batch_form"
                        value="false"
                        checked={priceFormData.is_batch === false}
                        onChange={() => setPriceFormData((prev) => ({ ...prev, is_batch: false }))}
                        className="text-primary"
                      />
                      {t('common.no')}
                    </label>
                  </div>
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-6 border-t">
                <div className="flex flex-wrap gap-2">
                  {isEditingPrice && editingPriceRow?.llm_price_id ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          message: t('pricing.deleteConfirm'),
                          destructive: true,
                        });
                        if (!ok) return;
                        deleteMutation.mutate(editingPriceRow.llm_price_id!, {
                          onSuccess: () => closePriceForm(),
                        });
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closePriceForm}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={savePriceMutation.isPending || updatePriceMutation.isPending}
                    onClick={handleSubmitPrice}
                  >
                    {isEditingPrice ? t('pricing.saveChanges') : t('pricing.addSubmit')}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingRow && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('pricing.editTitle')}</h2>
              <Button variant="ghost" size="sm" onClick={() => setViewingRow(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6 space-y-3">
              {(
                [
                  ['llm_name', columnLabels.llm_name],
                  ['llm_price_per_unit', columnLabels.llm_price_per_unit],
                  ['currency', columnLabels.currency],
                  ['modality_name', columnLabels.modality_name],
                  ['llm_unit_size', columnLabels.llm_unit_size],
                  ['llm_min_unit_size', columnLabels.llm_min_unit_size],
                  ['llm_max_unit_size', columnLabels.llm_max_unit_size],
                  ['is_input', columnLabels.is_input],
                  ['is_batch', columnLabels.is_batch],
                  ['price_valid_from', columnLabels.price_valid_from],
                  ['price_valid_until', columnLabels.price_valid_until],
                ] as [string, string][]
              ).map(([key, label]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{formatCell(key, viewingRow[key])}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-6 pt-0 mt-2 border-t">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={async () => {
                    if (!viewingRow.llm_price_id) return;
                    const ok = await confirm({
                      message: t('pricing.deleteConfirm'),
                      destructive: true,
                    });
                    if (!ok) return;
                    deleteMutation.mutate(viewingRow.llm_price_id, {
                      onSuccess: () => setViewingRow(null),
                    });
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setViewingRow(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setViewingRow(null);
                    openEditPrice(viewingRow);
                  }}
                >
                  {t('llmData.editInDetail')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────

export function LlmDataManagementSection({ rootId }: { rootId?: string } = {}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('apis');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'apis', label: t('llmData.tabApis') },
    { key: 'pricing', label: t('llmData.tabPricing') },
  ];

  return (
    <>
      <div id={rootId} className={`mt-8${rootId ? ' scroll-mt-24' : ''}`}>
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-[15px] font-semibold mb-2">{t('llmData.title')}</h3>
          <p className="text-[13px] text-muted-foreground mb-4">{t('llmData.intro')}</p>

          <div className="flex flex-wrap gap-2 mb-6 border-b border-border pb-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-t-md text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/80'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'apis' && <ApisTab />}
          {activeTab === 'pricing' && <PricingTab />}
        </div>
      </div>
    </>
  );
}
