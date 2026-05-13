import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ModelTable, type ModelTableRef } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { useMemo, useState, useRef, useEffect } from 'react';
import { X, Filter, ArrowUpDown } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import { LlmClassifiersSection } from '@/components/UserClassifiersSection';
import { LlmDataManagementSection } from '@/components/LlmDataManagementSection';
import { apiFetchJson, queryKeys } from '@/lib/api';

export const Route = createFileRoute('/manager' as any)({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      create: (search.create as string | undefined) || undefined,
    };
  },
  beforeLoad: () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';

    if (!isAuthenticated) {
      throw redirect({
        to: '/login' as any,
      });
    }
  },
  component: ManagerPage,
});

export type FilterState = {
  is_active_llm: 'all' | 'active' | 'inactive';
  llm_name: string[];
  llm_group_name: string[];
  model_company_name: string[];
  model_company_country: string[];
  llm_version: string[];
  is_local_llm: 'all' | 'true' | 'false';
};

export type SortConfig = {
  column: string;
  direction: 'asc' | 'desc';
};

export default function ManagerPage() {
  const navigate = useNavigate();
  const { create } = Route.useSearch();
  const { t } = useTranslation();
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    column: 'llm_name',
    direction: 'asc',
  });
  const [filters, setFilters] = useState<FilterState>({
    is_active_llm: 'all',
    llm_name: [],
    llm_group_name: [],
    model_company_name: [],
    model_company_country: [],
    llm_version: [],
    is_local_llm: 'all',
  });

  const filterApiPath =
    filters.is_active_llm === 'active'
      ? '/api/llms/active'
      : filters.is_active_llm === 'inactive'
        ? '/api/llms/inactive'
        : '/api/llms';

  const { data: filterModels = [], isLoading: isLoadingFilterModels } = useQuery({
    queryKey: [...queryKeys.llms, filters.is_active_llm],
    queryFn: () => apiFetchJson<any[]>(filterApiPath),
    enabled: showFilters,
  });

  const llmGroupNameOptions = useMemo(() => {
    const values = filterModels.map((m) => m.llm_group_name).filter(Boolean);
    const unique = Array.from(new Set(values));
    return unique.sort((a, b) => String(a).localeCompare(String(b), 'et', { sensitivity: 'base' }));
  }, [filterModels]);

  const modelCompanyNameOptions = useMemo(() => {
    const values = filterModels.map((m) => m.model_company_name).filter(Boolean);
    const unique = Array.from(new Set(values));
    return unique.sort((a, b) => String(a).localeCompare(String(b), 'et', { sensitivity: 'base' }));
  }, [filterModels]);

  const modelCompanyCountryOptions = useMemo(() => {
    const values = filterModels.map((m) => m.model_company_country).filter(Boolean);
    const unique = Array.from(new Set(values));
    return unique.sort((a, b) => String(a).localeCompare(String(b), 'et', { sensitivity: 'base' }));
  }, [filterModels]);
  const dataTableRef = useRef<ModelTableRef>(null);
  const [tilesOpen, setTilesOpen] = useState(false);

  useEffect(() => {
    if (create === 'true') {
      navigate({ to: '/manager', search: { create: undefined } } as any);
      setTimeout(() => {
        dataTableRef.current?.handleCreate();
      }, 100);
    }
  }, [create, navigate]);

  const handleCreate = () => {
    dataTableRef.current?.handleCreate();
  };

  type MultiFilterKey =
    | 'llm_name'
    | 'llm_group_name'
    | 'model_company_name'
    | 'model_company_country'
    | 'llm_version';

  const toggleMultiFilterValue = (key: MultiFilterKey, value: string) => {
    setFilters((prev) => {
      const current = prev[key];
      const exists = current.includes(value);
      const next = exists ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const setActiveStatus = (value: FilterState['is_active_llm']) => {
    setFilters((prev) => ({ ...prev, is_active_llm: value }));
  };

  const setLocalStatus = (value: FilterState['is_local_llm']) => {
    setFilters((prev) => ({ ...prev, is_local_llm: value }));
  };

  const clearFilters = () => {
    setFilters({
      is_active_llm: 'all',
      llm_name: [],
      llm_group_name: [],
      model_company_name: [],
      model_company_country: [],
      llm_version: [],
      is_local_llm: 'all',
    });
  };

  const filterPillClass = (selected: boolean) =>
    `inline-flex items-center gap-2 px-3 h-8 rounded-md text-[13px] font-medium transition-colors border ${
      selected
        ? 'bg-primary text-primary-foreground border-primary/60 shadow-xs hover:bg-primary/90'
        : 'bg-card text-foreground border-border hover:bg-muted/50'
    }`;

  const activeFilterCount =
    (filters.is_active_llm !== 'all' ? 1 : 0) +
    (filters.is_local_llm !== 'all' ? 1 : 0) +
    filters.llm_name.length +
    filters.llm_group_name.length +
    filters.model_company_name.length +
    filters.model_company_country.length +
    filters.llm_version.length;

  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('manager.title')} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="flex flex-col gap-2 mb-4 @md:flex-row @md:items-center @md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleCreate}>{t('manager.addNew')}</Button>
              <Button
                onClick={() => {
                  setShowFilters(!showFilters);
                  if (!showFilters) {
                    setShowSort(false);
                  }
                }}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                {t('manager.filter')}
                {hasActiveFilters && (
                  <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-[11px]">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <Button
                onClick={() => {
                  setShowSort(!showSort);
                  if (!showSort) {
                    setShowFilters(false);
                  }
                }}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ArrowUpDown className="h-4 w-4" />
                {t('manager.sort')}
              </Button>
              {hasActiveFilters && (
                <Button
                  onClick={clearFilters}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  <X className="h-4 w-4 mr-1" />
                  {t('manager.clearFilters')}
                </Button>
              )}
            </div>
            <Button
              onClick={() => {
                if (tilesOpen) {
                  dataTableRef.current?.closeAllTiles();
                } else {
                  dataTableRef.current?.openAllTiles();
                }
                setTilesOpen(!tilesOpen);
              }}
              variant="outline"
            >
              {tilesOpen ? t('manager.closeDetails') : t('manager.openDetails')}
            </Button>
          </div>
          {showFilters && (
            <div className="bg-card border border-border rounded-lg p-4 mb-4">
              <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-4">
                <Field>
                  <FieldLabel>{t('manager.isActive')}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'all', label: t('common.all') },
                      { value: 'active', label: t('manager.active') },
                      { value: 'inactive', label: t('manager.inactive') },
                    ].map((opt) => {
                      const selected = filters.is_active_llm === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setActiveStatus(opt.value as FilterState['is_active_llm'])}
                          aria-pressed={selected}
                          className={filterPillClass(selected)}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field>
                  <FieldLabel>{t('manager.groupName')}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {isLoadingFilterModels ? (
                      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
                    ) : (
                      llmGroupNameOptions.map((name) => {
                        const selected = filters.llm_group_name.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleMultiFilterValue('llm_group_name', name)}
                            aria-pressed={selected}
                            className={filterPillClass(selected)}
                          >
                            {name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </Field>
                <Field>
                  <FieldLabel>{t('manager.companyName')}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {isLoadingFilterModels ? (
                      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
                    ) : (
                      modelCompanyNameOptions.map((name) => {
                        const selected = filters.model_company_name.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleMultiFilterValue('model_company_name', name)}
                            aria-pressed={selected}
                            className={filterPillClass(selected)}
                          >
                            {name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </Field>
                <Field>
                  <FieldLabel>{t('manager.companyCountry')}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {isLoadingFilterModels ? (
                      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
                    ) : (
                      modelCompanyCountryOptions.map((name) => {
                        const selected = filters.model_company_country.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleMultiFilterValue('model_company_country', name)}
                            aria-pressed={selected}
                            className={filterPillClass(selected)}
                          >
                            {name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </Field>
                <Field>
                  <FieldLabel>{t('manager.isLocal')}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'all', label: t('common.all') },
                      { value: 'true', label: t('common.yes') },
                      { value: 'false', label: t('common.no') },
                    ].map((opt) => {
                      const selected = filters.is_local_llm === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setLocalStatus(opt.value as FilterState['is_local_llm'])}
                          aria-pressed={selected}
                          className={filterPillClass(selected)}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            </div>
          )}
          {showSort && (
            <div className="bg-card border border-border rounded-lg p-4 mb-4">
              <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>{t('manager.sortColumn')}</FieldLabel>
                  <select
                    value={sortConfig.column}
                    onChange={(e) => setSortConfig((prev) => ({ ...prev, column: e.target.value }))}
                    className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <option value="llm_name">{t('manager.modelName')}</option>
                    <option value="llm_group_name">{t('manager.groupName')}</option>
                    <option value="model_company_name">{t('manager.companyName')}</option>
                    <option value="model_company_country">{t('manager.companyCountry')}</option>
                    <option value="llm_version">{t('manager.version')}</option>
                    <option value="llm_context_length">{t('manager.contextLength')}</option>
                    <option value="llm_max_output_tokens">{t('manager.maxOutputTokens')}</option>
                    <option value="llm_release_date">{t('manager.releaseDate')}</option>
                    <option value="is_local_llm">{t('manager.isLocal')}</option>
                    <option value="is_active_llm">{t('manager.isActive')}</option>
                    <option value="llm_created_at">{t('manager.createdAt')}</option>
                    <option value="llm_creator_email">{t('manager.creatorEmail')}</option>
                    <option value="llm_last_modified_at">{t('manager.lastModifiedAt')}</option>
                    <option value="llm_last_modifier_email">
                      {t('manager.lastModifierEmail')}
                    </option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel>{t('manager.sortDirection')}</FieldLabel>
                  <select
                    value={sortConfig.direction}
                    onChange={(e) =>
                      setSortConfig((prev) => ({
                        ...prev,
                        direction: e.target.value as 'asc' | 'desc',
                      }))
                    }
                    data-testid="sort-direction-select"
                    className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <option value="asc">{t('manager.ascending')}</option>
                    <option value="desc">{t('manager.descending')}</option>
                  </select>
                </Field>
              </div>
            </div>
          )}
          <div id="manager-models-section" className="scroll-mt-24">
            <ModelTable ref={dataTableRef} filters={filters} sortConfig={sortConfig} />
          </div>
          <LlmDataManagementSection rootId="manager-data-section" />
          <LlmClassifiersSection showAdminClassifiersLink rootId="manager-classifiers-section" />
        </div>
      </div>
    </div>
  );
}
