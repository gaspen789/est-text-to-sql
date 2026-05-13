import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit, Trash2, Plus, Filter, ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react';
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
import { useTranslation } from '@/hooks/useTranslation';
import { apiPost, apiPut, apiDelete, apiFetchJson, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

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
  priceIds?: number[];
  [key: string]: any;
}

interface Modality {
  modality_code: string;
  modality_name: string;
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

interface PricingSectionProps {
  modelId: number;
}

const COLUMN_ORDER = [
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
];

function formatPriceHeader(key: string, t: (k: string) => string): string {
  const path = `pricing.columns.${key}`;
  const tr = t(path);
  if (tr !== path) return tr;
  const formatted = key.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1).toLowerCase();
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

function formatPriceCellValue(key: string, value: any, t: (k: string) => string): string {
  if (key.startsWith('is_') || key.startsWith('on_')) {
    return value ? t('common.yes') : t('common.no');
  }
  if (
    key.includes('valid_from') ||
    key.includes('valid_until') ||
    key.includes('_aeg') ||
    key.includes('datetime') ||
    key.toLowerCase().includes('time')
  ) {
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
  if (key.includes('_kp') || key.includes('date') || key.toLowerCase().includes('date')) {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return String(value);
    }
  }
  return value == null ? '' : String(value);
}

const emptyPriceForm = (modelId: number): PriceFormState => ({
  llm_id: modelId,
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

function priceRowToFormData(
  row: PriceRow,
  modelId: number,
  supportedModalities: SupportedModalityRow[]
): PriceFormState {
  const match = supportedModalities.find(
    (s) =>
      (s.modality_name ?? '').toString() === (row.modality_name ?? '').toString() &&
      Boolean(s.is_input) === Boolean(row.is_input) &&
      s.llm_supported_modality_id != null
  );
  const hasUnit = row.llm_unit_size != null && String(row.llm_unit_size).trim() !== '';
  const hasRange =
    (row.llm_min_unit_size != null && String(row.llm_min_unit_size).trim() !== '') ||
    (row.llm_max_unit_size != null && String(row.llm_max_unit_size).trim() !== '');
  const pricingSizingMode: PriceSizingMode = hasUnit ? 'fixed' : hasRange ? 'range' : 'fixed';

  return {
    llm_id: row.llm_id || modelId,
    llm_supported_modality_ids:
      match?.llm_supported_modality_id != null ? [String(match.llm_supported_modality_id)] : [],
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

export function PricingSection({ modelId }: PricingSectionProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PriceRow | null>(null);
  const [deletingPrice, setDeletingPrice] = useState<PriceRow | null>(null);

  const [priceFormData, setPriceFormData] = useState(emptyPriceForm(modelId));
  const [priceFieldErrors, setPriceFieldErrors] = useState<Set<string>>(new Set());

  const [showPriceFilters, setShowPriceFilters] = useState(false);
  const [priceFilters, setPriceFilters] = useState<{
    currency_code: string;
    modality_code: string;
    llm_unit_size: string;
    llm_min_unit_size: string;
    llm_max_unit_size: string;
    is_input: 'all' | 'true' | 'false';
    is_batch: 'all' | 'true' | 'false';
  }>({
    currency_code: '',
    modality_code: '',
    llm_unit_size: '',
    llm_min_unit_size: '',
    llm_max_unit_size: '',
    is_input: 'all',
    is_batch: 'all',
  });
  const [priceSortConfig, setPriceSortConfig] = useState<{
    key: string | null;
    direction: 'asc' | 'desc' | null;
  }>({ key: null, direction: null });
  const [prevPriceEditSyncKey, setPrevPriceEditSyncKey] = useState('');
  const [prevModelIdWhileAddingPrice, setPrevModelIdWhileAddingPrice] = useState(modelId);

  const dropdownEnabled = isAddingPrice || isEditingPrice || showPriceFilters;

  const { data: priceData = [], isLoading } = useQuery({
    queryKey: queryKeys.prices(modelId),
    queryFn: () => apiFetchJson<PriceRow[]>(`/api/llm-price/${modelId}`),
  });

  const { data: modalities = [] } = useQuery({
    queryKey: queryKeys.modalities,
    queryFn: () => apiFetchJson<Modality[]>('/api/modalities'),
    enabled: dropdownEnabled,
  });

  const { data: currencies = [] } = useQuery({
    queryKey: queryKeys.currencies,
    queryFn: () => apiFetchJson<Currency[]>('/api/valuutad'),
    enabled: dropdownEnabled,
  });

  const { data: supportedModalities = [] } = useQuery({
    queryKey: queryKeys.supportedModalities(modelId),
    queryFn: () => apiFetchJson<SupportedModalityRow[]>(`/api/llm-modality/${modelId}`),
    enabled: Boolean(modelId),
  });

  const { data: unitTypes = [] } = useQuery({
    queryKey: queryKeys.unitTypes,
    queryFn: () => apiFetchJson<UnitTypeRow[]>('/api/unit-types'),
    enabled: Boolean(modelId),
  });

  const supportedSig = supportedModalities.map((r) => r.llm_supported_modality_id ?? '').join('|');
  const priceEditSyncKey =
    isEditingPrice && editingPrice ? `${editingPrice.llm_price_id}|${modelId}|${supportedSig}` : '';
  if (priceEditSyncKey && priceEditSyncKey !== prevPriceEditSyncKey && editingPrice) {
    setPrevPriceEditSyncKey(priceEditSyncKey);
    setPriceFormData(priceRowToFormData(editingPrice, modelId, supportedModalities));
  }

  const sizingLiveViolation = useMemo(
    () => pricingSizingConstraintViolation(priceFormData),
    [
      priceFormData.pricingSizingMode,
      priceFormData.unit_size,
      priceFormData.min_unit_size,
      priceFormData.max_unit_size,
    ]
  );

  if (isAddingPrice && modelId !== prevModelIdWhileAddingPrice) {
    setPrevModelIdWhileAddingPrice(modelId);
    setPriceFormData(emptyPriceForm(modelId));
    setPriceFieldErrors(new Set());
  }

  const validateAndParsePriceForm = () => {
    const errors = new Set<string>();
    if (priceFormData.llm_supported_modality_ids.length === 0) {
      errors.add('llm_supported_modality_id');
    }
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
    const priceValue = parsedPrice;

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
      llm_supported_modality_ids: llmSupportedModalityIds,
      currency_code: priceFormData.currency_code,
      unit_type_code: priceFormData.unit_type_code,
      price_per_unit: priceValue,
      unit_size: unitSize,
      min_unit_size: minUnitSize,
      max_unit_size: maxUnitSize,
      is_batch: priceFormData.is_batch,
      valid_from_time: validFromDate ? validFromDate.toISOString() : null,
      valid_until_time: validUntilDate ? validUntilDate.toISOString() : null,
    };
  };

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
      queryClient.invalidateQueries({ queryKey: queryKeys.prices(modelId) });
      toast.success(
        bodies.length > 1
          ? t('pricing.addSuccessMany', { count: bodies.length })
          : t('pricing.addSuccess')
      );
      setIsAddingPrice(false);
      setPriceFieldErrors(new Set());
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePriceMutation = useMutation({
    mutationFn: async ({ priceId, body }: { priceId: number; body: object }) => {
      const res = await apiPut(`/api/llm-price/${priceId}`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'pricing.updateFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prices(modelId) });
      toast.success(t('pricing.updateSuccess'));
      setIsEditingPrice(false);
      setEditingPrice(null);
      setPriceFieldErrors(new Set());
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePriceMutation = useMutation({
    mutationFn: async (priceIds: number[]) => {
      const responses = await Promise.all(priceIds.map((id) => apiDelete(`/api/llm-price/${id}`)));
      const errors = responses.filter((r) => !r.ok);
      if (errors.length > 0) {
        const errorData = await errors[0].json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'pricing.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prices(modelId) });
      toast.success(t('pricing.deleteSuccess'));
      setDeletingPrice(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeletingPrice(null);
    },
  });

  const handleSavePrice = () => {
    const parsed = validateAndParsePriceForm();
    if (!parsed) return;
    const { llm_supported_modality_ids, ...shared } = parsed;
    const bodies = llm_supported_modality_ids.map((llm_supported_modality_id) => {
      const base: Record<string, unknown> = {
        llm_id: modelId,
        llm_supported_modality_id,
        currency_code: shared.currency_code,
        unit_type_code: shared.unit_type_code,
        price_per_unit: shared.price_per_unit,
        is_batch: shared.is_batch,
        valid_from_time: shared.valid_from_time,
        valid_until_time: shared.valid_until_time,
      };

      // Only include the sizing fields relevant to the chosen mode.
      if (shared.unit_size != null) base.unit_size = shared.unit_size;
      if (shared.min_unit_size != null) base.min_unit_size = shared.min_unit_size;
      if (shared.max_unit_size != null) base.max_unit_size = shared.max_unit_size;

      return base;
    });
    savePriceMutation.mutate(bodies);
  };

  const handleEditPrice = (priceRow: PriceRow) => {
    const priceId =
      priceRow.priceIds && priceRow.priceIds.length > 0
        ? priceRow.priceIds[0]
        : priceRow.llm_price_id;
    if (!priceId) {
      toast.error(t('pricing.priceIdMissing'));
      return;
    }
    const actualRow = priceData.find((row) => row.llm_price_id === priceId) || priceRow;
    const nextEditing: PriceRow = {
      ...actualRow,
      llm_id: actualRow.llm_id,
      llm_price_id: priceId,
      modality_name: actualRow.modality_name ?? '',
      currency: actualRow.currency ?? '',
      llm_price_per_unit: actualRow.llm_price_per_unit ?? null,
      llm_unit_size: actualRow.llm_unit_size ?? null,
      llm_min_unit_size: actualRow.llm_min_unit_size ?? null,
      llm_max_unit_size: actualRow.llm_max_unit_size ?? null,
      is_input: actualRow.is_input ?? false,
      is_batch: actualRow.is_batch ?? false,
      price_valid_from: actualRow.price_valid_from ?? null,
      price_valid_until: actualRow.price_valid_until ?? null,
    };
    setEditingPrice(nextEditing);
    setIsEditingPrice(true);
    setPriceFormData(priceRowToFormData(nextEditing, modelId, supportedModalities));
    setPriceFieldErrors(new Set());
  };

  const handleUpdatePrice = () => {
    if (!editingPrice) return;
    const parsed = validateAndParsePriceForm();
    if (!parsed) return;
    const priceId = editingPrice.llm_price_id;
    const linkedModelId = editingPrice.llm_id;
    if (!linkedModelId) {
      toast.error(t('pricing.modelIdMissing'));
      return;
    }
    const { llm_supported_modality_ids, ...shared } = parsed;
    if (llm_supported_modality_ids.length !== 1) {
      toast.error(t('pricing.fillRequired'));
      return;
    }
    updatePriceMutation.mutate({
      priceId: priceId!,
      body: {
        llm_id: linkedModelId,
        llm_supported_modality_id: llm_supported_modality_ids[0],
        ...shared,
      },
    });
  };

  const handleDeletePrice = (priceRow: PriceRow) => setDeletingPrice(priceRow);

  const handleConfirmDeletePrice = () => {
    if (!deletingPrice) return;
    const priceIds = (deletingPrice.priceIds || [deletingPrice.llm_price_id]).filter(
      (id): id is number => id !== undefined
    );
    if (priceIds.length === 0) {
      toast.error(t('pricing.priceIdMissing'));
      setDeletingPrice(null);
      return;
    }
    deletePriceMutation.mutate(priceIds);
  };

  const handlePriceSort = (key: string) => {
    setPriceSortConfig((prev) => {
      if (prev.key === key) return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      return { key, direction: 'asc' };
    });
  };

  const hasRealPriceData =
    priceData.length > 0 &&
    !priceData.every(
      (row) =>
        row.llm_price_per_unit == null ||
        (row.llm_price_per_unit.toString && row.llm_price_per_unit.toString().trim() === '')
    );

  const filteredPriceData = useMemo(() => {
    if (!priceData || priceData.length === 0) return [];
    return priceData.filter((row) => {
      if (priceFilters.currency_code?.trim()) {
        const fv = priceFilters.currency_code.trim().toLowerCase();
        if ((row.currency ?? '').toString().trim().toLowerCase() !== fv) return false;
      }
      if (priceFilters.modality_code?.trim()) {
        const fv = priceFilters.modality_code.trim().toLowerCase();
        if ((row.modality_name ?? '').toString().trim().toLowerCase() !== fv) return false;
      }
      if (
        priceFilters.llm_unit_size &&
        !(row.llm_unit_size?.toString() || '').includes(priceFilters.llm_unit_size)
      )
        return false;
      if (
        priceFilters.llm_min_unit_size &&
        !(row.llm_min_unit_size?.toString() || '').includes(priceFilters.llm_min_unit_size)
      )
        return false;
      if (
        priceFilters.llm_max_unit_size &&
        !(row.llm_max_unit_size?.toString() || '').includes(priceFilters.llm_max_unit_size)
      )
        return false;
      if (priceFilters.is_input !== 'all') {
        if (row.is_input !== (priceFilters.is_input === 'true')) return false;
      }
      if (priceFilters.is_batch !== 'all') {
        if (row.is_batch !== (priceFilters.is_batch === 'true')) return false;
      }
      return true;
    });
  }, [priceData, priceFilters]);

  const groupedPriceData = useMemo(() => {
    if (!filteredPriceData || filteredPriceData.length === 0) return [];
    let result = [...filteredPriceData];
    if (priceSortConfig.key && priceSortConfig.direction) {
      result = result.sort((a, b) => {
        const aValue = a[priceSortConfig.key!];
        const bValue = b[priceSortConfig.key!];
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return priceSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        return priceSortConfig.direction === 'asc'
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      });
    }
    return result;
  }, [filteredPriceData, priceSortConfig]);

  const closeEditPriceForm = () => {
    setIsEditingPrice(false);
    setEditingPrice(null);
    setPriceFieldErrors(new Set());
  };

  const supportedModalityOptions = useMemo(
    () =>
      supportedModalities.filter(
        (s) =>
          s.llm_supported_modality_id != null && (s.modality_name ?? '').toString().trim() !== ''
      ),
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

  const unitTypeSelectOptions = useMemo((): UnitTypeRow[] => {
    if (unitTypes.length > 0) return unitTypes;
    return [{ unit_type_code: 'TOK', unit_type_name: 'token' }];
  }, [unitTypes]);

  const priceFormFields = (
    <div className="grid grid-cols-2 gap-4">
      <Field className="col-span-2">
        <FieldLabel htmlFor={isAddingPrice ? undefined : 'llm_supported_modality_id'}>
          {isAddingPrice ? t('pricing.supportedModalities') : t('pricing.supportedModality')}{' '}
          <RequiredMark />
        </FieldLabel>
        {isAddingPrice ? (
          <>
            <p className="text-sm text-muted-foreground mb-2">
              {t('pricing.selectSupportedModalitiesHint')}
            </p>
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
                  disabled={supportedModalityOptions.length === 0 || allSupportedModalitiesSelected}
                  onClick={() => {
                    const allIds = supportedModalityOptions.map((s) =>
                      String(s.llm_supported_modality_id)
                    );
                    setPriceFormData((prev) => ({ ...prev, llm_supported_modality_ids: allIds }));
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
                    supportedModalityOptions.length === 0 || selectedSupportedModalityCount === 0
                  }
                  onClick={() =>
                    setPriceFormData((prev) => ({ ...prev, llm_supported_modality_ids: [] }))
                  }
                >
                  {t('common.deselectAll')}
                </Button>
              </div>
            </div>
            <div
              role="group"
              aria-label={t('pricing.supportedModalities')}
              className={`rounded-md border bg-background px-3 py-2 shadow-xs ${
                priceFieldErrors.has('llm_supported_modality_id')
                  ? 'border-destructive'
                  : 'border-input'
              }`}
            >
              <div className="flex flex-col gap-2">
                {supportedModalityOptions.map((s) => {
                  const idStr = String(s.llm_supported_modality_id);
                  const checked = priceFormData.llm_supported_modality_ids.includes(idStr);
                  return (
                    <label
                      key={s.llm_supported_modality_id}
                      className="flex items-center gap-2 text-sm"
                    >
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
                        {s.modality_name}{' '}
                        {Boolean(s.is_input)
                          ? `(${t('modalitiesSection.input')})`
                          : `(${t('modalitiesSection.output')})`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <SearchableSelect
            id="llm_supported_modality_id"
            value={priceFormData.llm_supported_modality_ids[0] ?? ''}
            onChange={(next) => {
              setPriceFormData((prev) => ({
                ...prev,
                llm_supported_modality_ids: next ? [next] : [],
              }));
              if (next)
                setPriceFieldErrors((prev) => {
                  const s = new Set(prev);
                  s.delete('llm_supported_modality_id');
                  return s;
                });
            }}
            options={supportedModalityOptions.map((s) => ({
              value: String(s.llm_supported_modality_id),
              label: `${s.modality_name} ${
                Boolean(s.is_input)
                  ? `(${t('modalitiesSection.input')})`
                  : `(${t('modalitiesSection.output')})`
              }`,
            }))}
            placeholder={t('pricing.selectSupportedModality')}
            hasError={priceFieldErrors.has('llm_supported_modality_id')}
          />
        )}
        {supportedModalityOptions.length === 0 && (isAddingPrice || isEditingPrice) && (
          <p className="text-sm text-muted-foreground mt-1">{t('pricing.noSupportedModalities')}</p>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="currency_code">
          {t('pricing.columns.currency')} <RequiredMark />
        </FieldLabel>
        <SearchableSelect
          id="currency_code"
          value={priceFormData.currency_code}
          onChange={(next) => {
            setPriceFormData((prev) => ({ ...prev, currency_code: next }));
            if (next)
              setPriceFieldErrors((prev) => {
                const s = new Set(prev);
                s.delete('currency_code');
                return s;
              });
          }}
          options={(currencies.length > 0 ? currencies : [{ currency_code: 'USD' }]).map((v) => ({
            value: v.currency_code,
            label: v.currency_code,
          }))}
          placeholder={t('common.select')}
          hasError={priceFieldErrors.has('currency_code')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="unit_type_code">
          {t('pricing.unitType')} <RequiredMark />
        </FieldLabel>
        <SearchableSelect
          id="unit_type_code"
          value={priceFormData.unit_type_code}
          onChange={(next) => {
            setPriceFormData((prev) => ({ ...prev, unit_type_code: next }));
            if (next)
              setPriceFieldErrors((prev) => {
                const s = new Set(prev);
                s.delete('unit_type_code');
                return s;
              });
          }}
          options={unitTypeSelectOptions.map((ut) => ({
            value: ut.unit_type_code,
            label: ut.unit_type_name ?? ut.unit_type_code,
          }))}
          placeholder={t('common.select')}
          hasError={priceFieldErrors.has('unit_type_code')}
        />
      </Field>

      <Field className="col-span-2">
        <FieldLabel htmlFor="price_per_unit">
          {t('pricing.columns.llm_price_per_unit')} <RequiredMark />
        </FieldLabel>
        <Input
          id="price_per_unit"
          type="number"
          step="any"
          min="0"
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
          className={
            priceFieldErrors.has('price_per_unit')
              ? 'border-destructive focus-visible:border-destructive'
              : ''
          }
        />
      </Field>

      <Field className="col-span-2">
        <FieldLabel>
          {t('pricing.pricingSizingMode')} <RequiredMark />
        </FieldLabel>
        <p className="text-sm text-muted-foreground mb-2">{t('pricing.sizingConstraintHint')}</p>
        <div className="flex flex-wrap gap-6 mt-1">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pricing_sizing_mode"
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
              name="pricing_sizing_mode"
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
        <Field className="col-span-2">
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
                priceFieldErrors.has('min_unit_size') || priceFieldErrors.has('unit_sizing')
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
                priceFieldErrors.has('max_unit_size') || priceFieldErrors.has('unit_sizing')
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

      <p className="col-span-2 text-sm text-muted-foreground">{t('pricing.validityDefaultNote')}</p>

      <Field className="col-span-2">
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
  );

  return (
    <div className="mt-8">
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold">{t('pricing.title')}</h3>
          <div className="flex items-center gap-2">
            {hasRealPriceData && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPriceFilters(!showPriceFilters)}
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                {t('pricing.filter')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setPriceFormData(emptyPriceForm(modelId));
                setPriceFieldErrors(new Set());
                setIsAddingPrice(true);
              }}
              className="flex items-center gap-2 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
            >
              <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              {t('pricing.addNew')}
            </Button>
          </div>
        </div>

        {showPriceFilters && hasRealPriceData && (
          <div className="bg-card border border-border rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field>
                <FieldLabel>{t('pricing.columns.currency')}</FieldLabel>
                <select
                  value={priceFilters.currency_code}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({ ...prev, currency_code: e.target.value }))
                  }
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="">{t('common.all')}</option>
                  {currencies.map((v) => (
                    <option key={v.currency_code} value={v.currency_code}>
                      {v.currency_code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel>{t('pricing.columns.modality_name')}</FieldLabel>
                <select
                  value={priceFilters.modality_code}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({ ...prev, modality_code: e.target.value }))
                  }
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="">{t('common.all')}</option>
                  {modalities.map((m) => (
                    <option key={m.modality_code} value={m.modality_name}>
                      {m.modality_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel>{t('pricing.tokenCount')}</FieldLabel>
                <Input
                  value={priceFilters.llm_unit_size}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({ ...prev, llm_unit_size: e.target.value }))
                  }
                  placeholder={t('pricing.placeholderUnitSize')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('pricing.minTokens')}</FieldLabel>
                <Input
                  value={priceFilters.llm_min_unit_size}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({ ...prev, llm_min_unit_size: e.target.value }))
                  }
                  placeholder={t('pricing.placeholderMin')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('pricing.maxTokens')}</FieldLabel>
                <Input
                  value={priceFilters.llm_max_unit_size}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({ ...prev, llm_max_unit_size: e.target.value }))
                  }
                  placeholder={t('pricing.placeholderMax')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('pricing.isInputToken')}</FieldLabel>
                <select
                  value={priceFilters.is_input}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({
                      ...prev,
                      is_input: e.target.value as 'all' | 'true' | 'false',
                    }))
                  }
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="all">{t('common.all')}</option>
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              </Field>
              <Field>
                <FieldLabel>{t('pricing.isBatch')}</FieldLabel>
                <select
                  value={priceFilters.is_batch}
                  onChange={(e) =>
                    setPriceFilters((prev) => ({
                      ...prev,
                      is_batch: e.target.value as 'all' | 'true' | 'false',
                    }))
                  }
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="all">Kõik</option>
                  <option value="true">Jah</option>
                  <option value="false">Ei</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPriceFilters({
                    currency_code: '',
                    modality_code: '',
                    llm_unit_size: '',
                    llm_min_unit_size: '',
                    llm_max_unit_size: '',
                    is_input: 'all',
                    is_batch: 'all',
                  })
                }
                className="text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Tühista filtrid
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton columns={6} rows={3} />
        ) : hasRealPriceData ? (
          groupedPriceData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {(() => {
                    const firstRow = groupedPriceData[0];
                    const keys = COLUMN_ORDER.filter((key) => firstRow && key in firstRow);
                    return (
                      <>
                        <TableHead className="w-20 sticky left-0 z-10 bg-card border-r border-border">
                          {t('common.actions')}
                        </TableHead>
                        {keys.map((key) => (
                          <TableHead key={key}>
                            <button
                              onClick={() => handlePriceSort(key)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              {formatPriceHeader(key, t)}
                              {priceSortConfig.key === key ? (
                                priceSortConfig.direction === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                              )}
                            </button>
                          </TableHead>
                        ))}
                      </>
                    );
                  })()}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedPriceData.map((priceRow, index) => {
                  const keys = COLUMN_ORDER.filter((key) => priceRow && key in priceRow);
                  return (
                    <TableRow key={index} className="group">
                      <TableCell className="sticky left-0 z-10 bg-card group-hover:bg-muted/50 border-r border-border">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditPrice(priceRow)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                            title={t('pricing.editRow')}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePrice(priceRow)}
                            className="p-1 hover:text-destructive"
                            title={t('pricing.deleteRow')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      {keys.map((key) => (
                        <TableCell key={key}>
                          {formatPriceCellValue(key, priceRow[key], t) || '-'}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t('pricing.noFiltered')}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{t('pricing.noData')}</p>
        )}
      </div>

      {/* Add Price Form */}
      {isAddingPrice && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('pricing.addTitle')}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingPrice(false);
                  setPriceFieldErrors(new Set());
                }}
              >
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
              {priceFormFields}
              <div className="flex justify-end gap-2 pt-4 mt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddingPrice(false);
                    setPriceFieldErrors(new Set());
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={handleSavePrice}>
                  {t('pricing.addSubmit')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Price Form */}
      {isEditingPrice && editingPrice && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('pricing.editTitle')}</h2>
              <Button variant="ghost" size="sm" onClick={closeEditPriceForm}>
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
              {priceFormFields}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-6 border-t">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      handleDeletePrice(editingPrice);
                      closeEditPriceForm();
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                <Button type="button" variant="outline" onClick={closeEditPriceForm}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={handleUpdatePrice}>
                  {t('pricing.saveChanges')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Price Confirmation */}
      {deletingPrice && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-destructive/15 rounded-full flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {t('pricing.deleteTitle')}
                  </h3>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('pricing.deleteConfirm')}
                  </p>
                </div>
              </div>
              <div className="mb-4 p-3 bg-muted/50 rounded-md">
                <div className="space-y-1 text-sm">
                  {deletingPrice.llm_price_per_unit != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('pricing.summaryPrice')}</span>
                      <span className="font-medium">
                        {deletingPrice.llm_price_per_unit} {deletingPrice.currency || ''}
                      </span>
                    </div>
                  )}
                  {deletingPrice.modality_name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('pricing.summaryModality')}</span>
                      <span className="font-medium">{deletingPrice.modality_name}</span>
                    </div>
                  )}
                  {deletingPrice.llm_unit_size != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('pricing.summaryUnitSize')}</span>
                      <span className="font-medium">{deletingPrice.llm_unit_size}</span>
                    </div>
                  )}
                  {deletingPrice.is_input != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('pricing.summaryIsInput')}</span>
                      <span className="font-medium">
                        {deletingPrice.is_input ? t('common.yes') : t('common.no')}
                      </span>
                    </div>
                  )}
                  {deletingPrice.is_batch != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('pricing.summaryIsBatch')}</span>
                      <span className="font-medium">
                        {deletingPrice.is_batch ? t('common.yes') : t('common.no')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDeletingPrice(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDeletePrice}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('pricing.deleteSubmit')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
