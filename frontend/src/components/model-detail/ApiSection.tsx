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

interface ModelName {
  llm_id: number;
  llm_name: string;
}

interface ApiSectionProps {
  modelId: number;
}

function formatApiHeader(key: string, t: (k: string) => string): string {
  const path = `apiSection.columns.${key}`;
  const tr = t(path);
  if (tr !== path) return tr;
  const formatted = key.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1).toLowerCase();
}

function formatApiCellValue(key: string, value: any, t: (k: string) => string): string {
  if (key.startsWith('is_') || key.startsWith('on_')) {
    return value ? t('common.yes') : t('common.no');
  }
  return value == null ? '' : String(value);
}

const emptyApiForm = (modelId: number) => ({
  llm_id: modelId as number | undefined,
  api_key: '',
  request_url: '',
  token_limit_per_minute: '',
  request_limit_per_minute: '',
  request_limit_per_day: '',
  is_active: true as boolean,
});

function numberToFormString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function apiRowToFormData(row: ApiRow, modelId: number) {
  return {
    llm_id: row.llm_id || modelId,
    api_key: row.api_key ?? '',
    request_url: row.request_url ?? '',
    token_limit_per_minute: numberToFormString(row.token_limit_per_minute),
    request_limit_per_minute: numberToFormString(row.request_limit_per_minute),
    request_limit_per_day: numberToFormString(row.request_limit_per_day),
    is_active: true as boolean,
  };
}

export function ApiSection({ modelId }: ApiSectionProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [isAddingApi, setIsAddingApi] = useState(false);
  const [isEditingApi, setIsEditingApi] = useState(false);
  const [editingApi, setEditingApi] = useState<ApiRow | null>(null);
  const [deletingApi, setDeletingApi] = useState<ApiRow | null>(null);

  const [apiFormData, setApiFormData] = useState(emptyApiForm(modelId));
  const [apiFieldErrors, setApiFieldErrors] = useState<Set<string>>(new Set());

  const [showApiFilters, setShowApiFilters] = useState(false);
  const [apiFilters, setApiFilters] = useState({
    api_key: '',
    request_url: '',
    token_limit_per_minute: '',
    request_limit_per_minute: '',
    request_limit_per_day: '',
  });
  const [apiSortConfig, setApiSortConfig] = useState<{
    key: string | null;
    direction: 'asc' | 'desc' | null;
  }>({ key: null, direction: null });
  const [prevModelIdWhileAdding, setPrevModelIdWhileAdding] = useState(modelId);

  const { data: apiData = [], isLoading } = useQuery({
    queryKey: queryKeys.apiData(modelId),
    queryFn: () => apiFetchJson<ApiRow[]>(`/api/llm-api/${modelId}`),
  });

  const { data: llmNames = [] } = useQuery({
    queryKey: queryKeys.llmNames,
    queryFn: () => apiFetchJson<ModelName[]>('/api/llm-names'),
    enabled: isAddingApi,
  });

  if (isAddingApi && modelId !== prevModelIdWhileAdding) {
    setPrevModelIdWhileAdding(modelId);
    setApiFormData(emptyApiForm(modelId));
    setApiFieldErrors(new Set());
  }

  const validateAndParseApiForm = () => {
    const errors = new Set<string>();
    if (!apiFormData.api_key || apiFormData.api_key.trim() === '') errors.add('api_key');
    setApiFieldErrors(errors);
    if (errors.size > 0) {
      toast.error(t('apiSection.fillRequired'));
      return null;
    }

    const apiKeyTrimmed = apiFormData.api_key.trim();
    if (apiKeyTrimmed.length > 260) {
      setApiFieldErrors((prev) => new Set(prev).add('api_key'));
      return null;
    }
    const apiVotiPattern = /^[a-zA-Z0-9_.-]+$/;
    if (!apiVotiPattern.test(apiKeyTrimmed)) {
      setApiFieldErrors((prev) => new Set(prev).add('api_key'));
      return null;
    }

    const requestUrlTrimmed = apiFormData.request_url.trim();
    if (requestUrlTrimmed.length > 0) {
      if (requestUrlTrimmed.length > 400) {
        setApiFieldErrors((prev) => new Set(prev).add('request_url'));
        return null;
      }
      const urlPattern =
        /^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?(\/[a-zA-Z0-9_.~!$&'()*+,;=:@%/-]*)?$/;
      if (!urlPattern.test(requestUrlTrimmed)) {
        setApiFieldErrors((prev) => new Set(prev).add('request_url'));
        return null;
      }
    }

    const requestLimitPerMinute = apiFormData.request_limit_per_minute
      ? parseInt(apiFormData.request_limit_per_minute)
      : null;
    const requestLimitPerDay = apiFormData.request_limit_per_day
      ? parseInt(apiFormData.request_limit_per_day)
      : null;
    const tokenLimitPerMinute = apiFormData.token_limit_per_minute
      ? parseInt(apiFormData.token_limit_per_minute)
      : null;

    if (requestLimitPerMinute !== null) {
      if (
        isNaN(requestLimitPerMinute) ||
        requestLimitPerMinute <= 0 ||
        !Number.isInteger(requestLimitPerMinute)
      ) {
        setApiFieldErrors((prev) => new Set(prev).add('request_limit_per_minute'));
        return null;
      }
    }
    if (requestLimitPerDay !== null) {
      if (
        isNaN(requestLimitPerDay) ||
        requestLimitPerDay <= 0 ||
        !Number.isInteger(requestLimitPerDay)
      ) {
        setApiFieldErrors((prev) => new Set(prev).add('request_limit_per_day'));
        return null;
      }
    }
    if (tokenLimitPerMinute !== null) {
      if (
        isNaN(tokenLimitPerMinute) ||
        tokenLimitPerMinute <= 0 ||
        !Number.isInteger(tokenLimitPerMinute)
      ) {
        setApiFieldErrors((prev) => new Set(prev).add('token_limit_per_minute'));
        return null;
      }
    }

    return {
      api_key: apiKeyTrimmed,
      request_url: requestUrlTrimmed.length > 0 ? requestUrlTrimmed : null,
      token_limit_per_minute: tokenLimitPerMinute,
      request_limit_per_minute: requestLimitPerMinute,
      request_limit_per_day: requestLimitPerDay,
      is_active: apiFormData.is_active,
    };
  };

  const saveApiMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await apiPost('/api/llm-api', body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'apiSection.addFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiData(modelId) });
      toast.success(t('apiSection.addSuccess'));
      setIsAddingApi(false);
      setApiFieldErrors(new Set());
    },
  });

  const updateApiMutation = useMutation({
    mutationFn: async ({ apiId, body }: { apiId: number; body: object }) => {
      const res = await apiPut(`/api/llm-api/${apiId}`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'apiSection.updateFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiData(modelId) });
      toast.success(t('apiSection.updateSuccess'));
      setIsEditingApi(false);
      setEditingApi(null);
      setApiFieldErrors(new Set());
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteApiMutation = useMutation({
    mutationFn: async (apiId: number) => {
      const res = await apiDelete(`/api/llm-api/${apiId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'apiSection.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiData(modelId) });
      toast.success(t('apiSection.deleteSuccess'));
      setDeletingApi(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeletingApi(null);
    },
  });

  const handleSaveApi = () => {
    if (!apiFormData.llm_id) {
      setApiFieldErrors((prev) => new Set(prev).add('llm_id'));
      toast.error(t('apiSection.fillRequired'));
      return;
    }
    const parsed = validateAndParseApiForm();
    if (!parsed) return;
    saveApiMutation.mutate({ llm_id: apiFormData.llm_id, ...parsed });
  };

  const handleEditApi = (apiRow: ApiRow) => {
    const apiId = apiRow.llm_api_id;
    if (!apiId) {
      toast.error(t('apiSection.apiIdMissing'));
      return;
    }
    const actualRow = apiData.find((row) => row.llm_api_id === apiId) || apiRow;
    const nextEditing: ApiRow = {
      ...actualRow,
      llm_api_id: apiId,
      llm_id: actualRow.llm_id,
      api_key: actualRow.api_key ?? '',
      request_url: actualRow.request_url ?? '',
      token_limit_per_minute: actualRow.token_limit_per_minute,
      request_limit_per_minute: actualRow.request_limit_per_minute,
      request_limit_per_day: actualRow.request_limit_per_day,
    };
    setEditingApi(nextEditing);
    setIsEditingApi(true);
    setApiFormData(apiRowToFormData(nextEditing, modelId));
    setApiFieldErrors(new Set());
  };

  const handleUpdateApi = () => {
    if (!editingApi) return;
    const parsed = validateAndParseApiForm();
    if (!parsed) return;
    const apiId = editingApi.llm_api_id;
    const linkedModelId = editingApi.llm_id || apiFormData.llm_id;
    if (!linkedModelId) {
      toast.error(t('apiSection.modelIdMissing'));
      return;
    }
    updateApiMutation.mutate({ apiId: apiId!, body: { llm_id: linkedModelId, ...parsed } });
  };

  const handleDeleteApi = (apiRow: ApiRow) => {
    setDeletingApi(apiRow);
  };

  const handleConfirmDeleteApi = () => {
    if (!deletingApi) return;
    const apiId = deletingApi.llm_api_id;
    if (!apiId) {
      toast.error(t('apiSection.apiIdMissing'));
      setDeletingApi(null);
      return;
    }
    deleteApiMutation.mutate(apiId);
  };

  const handleApiSort = (key: string) => {
    setApiSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const filteredApiData = useMemo(() => {
    if (!apiData || apiData.length === 0) return [];
    return apiData.filter((row) => {
      if (apiFilters.api_key?.trim()) {
        const fv = apiFilters.api_key.trim().toLowerCase();
        if (!(row.api_key ?? '').toString().toLowerCase().includes(fv)) return false;
      }
      if (apiFilters.request_url?.trim()) {
        const fv = apiFilters.request_url.trim().toLowerCase();
        if (!(row.request_url ?? '').toString().toLowerCase().includes(fv)) return false;
      }
      if (apiFilters.token_limit_per_minute?.trim()) {
        const fv = apiFilters.token_limit_per_minute.trim();
        if (!(row.token_limit_per_minute ?? '').toString().includes(fv)) return false;
      }
      if (apiFilters.request_limit_per_minute?.trim()) {
        const fv = apiFilters.request_limit_per_minute.trim();
        if (!(row.request_limit_per_minute ?? '').toString().includes(fv)) return false;
      }
      if (apiFilters.request_limit_per_day?.trim()) {
        const fv = apiFilters.request_limit_per_day.trim();
        if (!(row.request_limit_per_day ?? '').toString().includes(fv)) return false;
      }
      return true;
    });
  }, [apiData, apiFilters]);

  const sortedApiData = useMemo(() => {
    if (!apiSortConfig.key || !apiSortConfig.direction) return filteredApiData;
    return [...filteredApiData].sort((a, b) => {
      const aValue = a[apiSortConfig.key!];
      const bValue = b[apiSortConfig.key!];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return apiSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      return apiSortConfig.direction === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [filteredApiData, apiSortConfig]);

  const hasRealApiData =
    apiData.length > 0 &&
    !apiData.every((row) => !row.api_key || row.api_key.toString().trim() === '');

  const closeEditForm = () => {
    setIsEditingApi(false);
    setEditingApi(null);
    setApiFieldErrors(new Set());
    setApiFormData(emptyApiForm(modelId));
  };

  const apiFormFields = (
    <div className="grid grid-cols-2 gap-4">
      {isAddingApi && (
        <Field>
          <FieldLabel htmlFor="api_llm_id">
            {t('manager.modelName')} <RequiredMark />
          </FieldLabel>
          <SearchableSelect
            id="api_llm_id"
            value={apiFormData.llm_id ? String(apiFormData.llm_id) : ''}
            onChange={(next) => {
              const value = next ? parseInt(next) : undefined;
              setApiFormData((prev) => ({ ...prev, llm_id: value }));
              if (value)
                setApiFieldErrors((prev) => {
                  const s = new Set(prev);
                  s.delete('llm_id');
                  return s;
                });
            }}
            options={llmNames.map((km) => ({
              value: String(km.llm_id),
              label: km.llm_name,
            }))}
            placeholder={t('apiSection.selectModel')}
            hasError={apiFieldErrors.has('llm_id')}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="api_key">
          {t('apiSection.columns.api_key')} <RequiredMark />
        </FieldLabel>
        <Input
          id="api_key"
          type="text"
          value={apiFormData.api_key}
          onChange={(e) => {
            setApiFormData((prev) => ({ ...prev, api_key: e.target.value }));
            if (e.target.value.trim())
              setApiFieldErrors((prev) => {
                const s = new Set(prev);
                s.delete('api_key');
                return s;
              });
          }}
          className={
            apiFieldErrors.has('api_key')
              ? 'border-destructive focus-visible:border-destructive'
              : ''
          }
        />
      </Field>
      <Field className="col-span-2">
        <FieldLabel htmlFor="request_url">{t('apiSection.columns.request_url')}</FieldLabel>
        <Input
          id="request_url"
          type="url"
          value={apiFormData.request_url}
          onChange={(e) => {
            setApiFormData((prev) => ({ ...prev, request_url: e.target.value }));
            if (e.target.value.trim())
              setApiFieldErrors((prev) => {
                const s = new Set(prev);
                s.delete('request_url');
                return s;
              });
          }}
          className={
            apiFieldErrors.has('request_url')
              ? 'border-destructive focus-visible:border-destructive'
              : ''
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="request_limit_per_minute">
          {t('apiSection.columns.request_limit_per_minute')}
        </FieldLabel>
        <Input
          id="request_limit_per_minute"
          type="number"
          min="1"
          step="1"
          value={apiFormData.request_limit_per_minute}
          onChange={(e) =>
            setApiFormData((prev) => ({ ...prev, request_limit_per_minute: e.target.value }))
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="request_limit_per_day">
          {t('apiSection.columns.request_limit_per_day')}
        </FieldLabel>
        <Input
          id="request_limit_per_day"
          type="number"
          min="1"
          step="1"
          value={apiFormData.request_limit_per_day}
          onChange={(e) =>
            setApiFormData((prev) => ({ ...prev, request_limit_per_day: e.target.value }))
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="token_limit_per_minute">
          {t('apiSection.columns.token_limit_per_minute')}
        </FieldLabel>
        <Input
          id="token_limit_per_minute"
          type="number"
          min="1"
          step="1"
          value={apiFormData.token_limit_per_minute}
          onChange={(e) => {
            setApiFormData((prev) => ({ ...prev, token_limit_per_minute: e.target.value }));
            if (e.target.value.trim())
              setApiFieldErrors((prev) => {
                const s = new Set(prev);
                s.delete('token_limit_per_minute');
                return s;
              });
          }}
          className={
            apiFieldErrors.has('token_limit_per_minute')
              ? 'border-destructive focus-visible:border-destructive'
              : ''
          }
        />
      </Field>
      <Field>
        <FieldLabel>{t('apiSection.activeQuestion')}</FieldLabel>
        <div className="flex gap-6 mt-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="is_active_form"
              value="true"
              checked={apiFormData.is_active === true}
              onChange={() => setApiFormData((prev) => ({ ...prev, is_active: true }))}
              className="text-primary"
            />
            {t('common.yes')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="is_active_form"
              value="false"
              checked={apiFormData.is_active === false}
              onChange={() => setApiFormData((prev) => ({ ...prev, is_active: false }))}
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
          <h3 className="text-[15px] font-semibold">{t('apiSection.title')}</h3>
          <div className="flex items-center gap-2">
            {hasRealApiData && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApiFilters(!showApiFilters)}
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                {t('apiSection.filter')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setApiFormData(emptyApiForm(modelId));
                setApiFieldErrors(new Set());
                setIsAddingApi(true);
              }}
              className="flex items-center gap-2 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
            >
              <Plus className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              {t('apiSection.addNew')}
            </Button>
          </div>
        </div>

        {showApiFilters && hasRealApiData && (
          <div className="bg-card border border-border rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field>
                <FieldLabel>{t('apiSection.columns.api_key')}</FieldLabel>
                <Input
                  value={apiFilters.api_key}
                  onChange={(e) => setApiFilters((prev) => ({ ...prev, api_key: e.target.value }))}
                  placeholder={t('apiSection.placeholderSearchApiKey')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('apiSection.columns.request_url')}</FieldLabel>
                <Input
                  value={apiFilters.request_url}
                  onChange={(e) =>
                    setApiFilters((prev) => ({ ...prev, request_url: e.target.value }))
                  }
                  placeholder={t('apiSection.placeholderSearchUrl')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('apiSection.columns.token_limit_per_minute')}</FieldLabel>
                <Input
                  value={apiFilters.token_limit_per_minute}
                  onChange={(e) =>
                    setApiFilters((prev) => ({ ...prev, token_limit_per_minute: e.target.value }))
                  }
                  placeholder={t('apiSection.placeholderSearchTokenLimit')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('apiSection.columns.request_limit_per_minute')}</FieldLabel>
                <Input
                  value={apiFilters.request_limit_per_minute}
                  onChange={(e) =>
                    setApiFilters((prev) => ({
                      ...prev,
                      request_limit_per_minute: e.target.value,
                    }))
                  }
                  placeholder={t('apiSection.placeholderSearchReqMin')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('apiSection.columns.request_limit_per_day')}</FieldLabel>
                <Input
                  value={apiFilters.request_limit_per_day}
                  onChange={(e) =>
                    setApiFilters((prev) => ({
                      ...prev,
                      request_limit_per_day: e.target.value,
                    }))
                  }
                  placeholder={t('apiSection.placeholderSearchReqDay')}
                />
              </Field>
            </div>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton columns={5} rows={2} />
        ) : sortedApiData.length > 0 &&
          !sortedApiData.every((row) => !row.api_key || row.api_key.toString().trim() === '') ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20 sticky left-0 z-10 bg-card border-r border-border">
                  {t('common.actions')}
                </TableHead>
                {Object.keys(apiData[0] || {})
                  .filter(
                    (key) =>
                      key !== 'llm_id' &&
                      key !== 'llm_name' &&
                      key !== 'is_active_llm' &&
                      key !== 'llm_api_id'
                  )
                  .map((key) => (
                    <TableHead key={key}>
                      <button
                        onClick={() => handleApiSort(key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {formatApiHeader(key, t)}
                        {apiSortConfig.key === key ? (
                          apiSortConfig.direction === 'asc' ? (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedApiData.map((apiRow, index) => {
                const keys = Object.keys(apiRow || {}).filter(
                  (key) =>
                    key !== 'llm_id' &&
                    key !== 'llm_name' &&
                    key !== 'is_active_llm' &&
                    key !== 'llm_api_id'
                );
                return (
                  <TableRow key={index} className="group">
                    <TableCell className="sticky left-0 z-10 bg-card group-hover:bg-muted/50 border-r border-border">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditApi(apiRow)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('apiSection.editRow')}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteApi(apiRow)}
                          className="p-1 hover:text-destructive"
                          title={t('apiSection.deleteRow')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    {keys.map((key) => {
                      const displayValue = formatApiCellValue(key, apiRow[key], t);
                      return <TableCell key={key}>{displayValue || '-'}</TableCell>;
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : hasRealApiData ? (
          <p className="text-[13px] text-muted-foreground">{t('apiSection.noFiltered')}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('apiSection.noData')}</p>
        )}
      </div>

      {/* Add API Form */}
      {isAddingApi && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('apiSection.addTitle')}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingApi(false);
                  setApiFieldErrors(new Set());
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveApi();
              }}
              className="p-6"
              noValidate
            >
              {apiFormFields}
              <div className="flex justify-end gap-2 pt-4 mt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddingApi(false);
                    setApiFieldErrors(new Set());
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit">{t('apiSection.addSubmit')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit API Form */}
      {isEditingApi && editingApi && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('apiSection.editTitle')}</h2>
              <Button variant="ghost" size="sm" onClick={closeEditForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdateApi();
              }}
              className="p-6"
              noValidate
            >
              {apiFormFields}
              <div className="flex justify-end gap-2 pt-4 mt-6 border-t">
                <Button type="button" variant="outline" onClick={closeEditForm}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit">{t('apiSection.updateSubmit')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete API Confirmation */}
      {deletingApi && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('apiSection.deleteTitle')}</h2>
              <Button variant="ghost" size="sm" onClick={() => setDeletingApi(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6">
              <p className="text-[13px] text-foreground mb-4">{t('apiSection.confirmDelete')}</p>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                {deletingApi.api_key && (
                  <div>
                    <span className="text-[13px] text-muted-foreground">
                      {t('apiSection.columns.api_key')}:{' '}
                    </span>
                    <span className="font-medium">{deletingApi.api_key}</span>
                  </div>
                )}
                {deletingApi.request_url && (
                  <div>
                    <span className="text-[13px] text-muted-foreground">
                      {t('apiSection.columns.request_url')}:{' '}
                    </span>
                    <span className="font-medium">{deletingApi.request_url}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button type="button" variant="outline" onClick={() => setDeletingApi(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={handleConfirmDeleteApi}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
