import { useState, forwardRef, useImperativeHandle, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit, ExternalLink, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import toast from '@/lib/toast';

import type { LanguageModel } from '@/types';
import type { FilterState, SortConfig } from '@/routes/manager';
import { AlertModal } from '@/components/AlertModal';
import { Button } from '@/components/ui/button';
import { ModelEditForm } from './edit-form';
import { CardSkeleton } from './table-skeleton';
import {
  apiPost,
  apiPut,
  apiDelete,
  apiFetchJson,
  normalizeModelParams,
  queryKeys,
} from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';
import type { LlmApiCredentialRow } from '@/lib/llmApiCredentials';
import { llmHasApiCredentials } from '@/lib/llmApiCredentials';
import { PASTEL_CHIP_CLASSNAMES, PASTEL_CHIP_FALLBACK_CLASS } from '@/lib/pastel-chip-colors';
import { useTranslation } from '@/hooks/useTranslation';

export interface ModelTableRef {
  handleCreate: () => void;
  openAllTiles: () => void;
  closeAllTiles: () => void;
}

export const ModelTable = forwardRef<
  ModelTableRef,
  { filters: FilterState; sortConfig: SortConfig }
>(({ filters, sortConfig }, ref) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [editingLLM, setEditingLLM] = useState<LanguageModel | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [deletingLLM, setDeletingLLM] = useState<LanguageModel | null>(null);
  const [openTiles, setOpenTiles] = useState<Set<number>>(new Set());
  const [activateAlert, setActivateAlert] = useState<'closed' | 'noApi' | 'fetchError'>('closed');
  const navigate = useNavigate();

  const activeFilter = filters.is_active_llm;
  const apiPath =
    activeFilter === 'active'
      ? '/api/llms/active'
      : activeFilter === 'inactive'
        ? '/api/llms/inactive'
        : '/api/llms';

  const { data: allLLMs = null, isLoading } = useQuery({
    queryKey: [...queryKeys.llms, activeFilter],
    queryFn: () => apiFetchJson<any[]>(apiPath).then((items) => items.map(normalizeModelParams)),
  });

  const handleEdit = (llmId: number) => {
    const llm = allLLMs?.find((k) => k.llm_id === llmId);
    if (llm) {
      setEditingLLM(llm);
    }
  };

  const toggleActiveMutation = useMutation({
    mutationFn: async (llmId: number) => {
      const llm = allLLMs?.find((k) => k.llm_id === llmId);
      if (!llm) return null;
      const endpoint = llm.is_active_llm
        ? `/api/llms/${llmId}/deactivate`
        : `/api/llms/${llmId}/activate`;
      const response = await apiPost(endpoint);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.toggleFailed'));
      }
      const data = (await response.json()) as { no_active_llms_remain?: boolean };
      return {
        wasActive: llm.is_active_llm,
        noActiveLlmsRemain: Boolean(data.no_active_llms_remain),
      };
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      queryClient.invalidateQueries({ queryKey: ['llm-names-active'] });
      if (!payload) return;
      if (payload.wasActive) {
        toast.success(
          payload.noActiveLlmsRemain
            ? t('modelDetail.deactivatedWithNoActiveLlms')
            : t('modelDetail.deactivated')
        );
      } else {
        toast.success(t('modelDetail.activated'));
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (llmId: number) => {
      const response = await apiDelete(`/api/llms/${llmId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      setDeletingLLM(null);
      toast.success(t('modelDetail.deleteSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const editMutation = useMutation({
    mutationFn: async (updatedLLM: LanguageModel) => {
      const updateData = {
        model_name: updatedLLM.llm_name,
        llm_group_id: updatedLLM.llm_group_id,
        version: updatedLLM.llm_version,
        context_length: updatedLLM.llm_context_length,
        max_output_tokens: updatedLLM.llm_max_output_tokens,
        other_parameters: updatedLLM.llm_other_parameters,
        release_date: updatedLLM.llm_release_date,
        is_local: updatedLLM.is_local_llm,
        is_active: updatedLLM.is_active_llm,
      };
      const response = await apiPut(`/api/llms/${updatedLLM.llm_id}`, updateData);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.editFailed'));
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      setEditingLLM(null);
      toast.success(t('modelDetail.editSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: async (newLLM: LanguageModel) => {
      const createData = {
        model_name: newLLM.llm_name,
        llm_group_id: newLLM.llm_group_id,
        version: newLLM.llm_version,
        context_length: newLLM.llm_context_length || undefined,
        max_output_tokens: newLLM.llm_max_output_tokens || undefined,
        other_parameters: newLLM.llm_other_parameters,
        release_date: newLLM.llm_release_date || undefined,
        is_local: newLLM.is_local_llm,
        is_active: newLLM.is_active_llm,
      };
      const response = await apiPost('/api/llms', createData);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'editForm.createFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      setIsCreating(false);
      toast.success(t('editForm.createSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleToggleActive = async (llmId: number) => {
    const llm = allLLMs?.find((k) => k.llm_id === llmId);
    if (!llm) return;
    if (!llm.is_active_llm) {
      try {
        const rows = await queryClient.fetchQuery({
          queryKey: queryKeys.apiData(llmId),
          queryFn: () => apiFetchJson<LlmApiCredentialRow[]>(`/api/llm-api/${llmId}`),
        });
        if (!llmHasApiCredentials(rows)) {
          setActivateAlert('noApi');
          return;
        }
      } catch {
        setActivateAlert('fetchError');
        return;
      }
    }
    toggleActiveMutation.mutate(llmId);
  };

  const handleConfirmDelete = () => {
    if (!deletingLLM?.llm_id) return;
    deleteMutation.mutate(deletingLLM.llm_id);
  };

  const handleCreate = () => {
    setIsCreating(true);
  };

  const handleSaveEdit = (updatedLLM: LanguageModel) => {
    if (!updatedLLM.llm_id) {
      toast.error(t('dataTable.modelIdMissing'));
      return;
    }
    editMutation.mutate(updatedLLM);
  };

  const handleSaveCreate = (newLLM: LanguageModel) => createMutation.mutate(newLLM);

  const handleCancelCreate = () => {
    setIsCreating(false);
  };

  // Apply client-side filtering and sorting
  const llms = useMemo(() => {
    if (!allLLMs) return null;

    const llmNameSet = new Set(filters.llm_name.map((v) => v.toLowerCase()));
    const llmGroupNameSet = new Set(filters.llm_group_name.map((v) => v.toLowerCase()));
    const modelCompanyNameSet = new Set(filters.model_company_name.map((v) => v.toLowerCase()));
    const modelCompanyCountrySet = new Set(
      filters.model_company_country.map((v) => v.toLowerCase())
    );
    const llmVersionSet = new Set(filters.llm_version.map((v) => v.toLowerCase()));

    const filtered = allLLMs.filter((item) => {
      // Filter by selected multi-values (exact match, case-insensitive)
      if (llmNameSet.size > 0) {
        const itemVal = item.llm_name?.toLowerCase();
        if (!itemVal || !llmNameSet.has(itemVal)) return false;
      }

      if (llmGroupNameSet.size > 0) {
        const itemVal = item.llm_group_name?.toLowerCase();
        if (!itemVal || !llmGroupNameSet.has(itemVal)) return false;
      }

      if (modelCompanyNameSet.size > 0) {
        const itemVal = item.model_company_name?.toLowerCase();
        if (!itemVal || !modelCompanyNameSet.has(itemVal)) return false;
      }

      if (modelCompanyCountrySet.size > 0) {
        const itemVal = item.model_company_country?.toLowerCase();
        if (!itemVal || !modelCompanyCountrySet.has(itemVal)) return false;
      }

      if (llmVersionSet.size > 0) {
        const itemVal = item.llm_version?.toLowerCase();
        if (!itemVal || !llmVersionSet.has(itemVal)) return false;
      }

      // Filter by is_local_llm
      if (filters.is_local_llm !== 'all') {
        const filterValue = filters.is_local_llm === 'true';
        if (item.is_local_llm !== filterValue) {
          return false;
        }
      }

      return true;
    });

    // Apply sorting
    return filtered.sort((a, b) => {
      const column = sortConfig.column;
      let aValue: any = a[column as keyof LanguageModel];
      let bValue: any = b[column as keyof LanguageModel];

      // Handle null/undefined values
      if (aValue == null) aValue = '';
      if (bValue == null) bValue = '';

      // Handle different data types
      if (column === 'llm_context_length' || column === 'llm_max_output_tokens') {
        // Numeric sorting
        const aNum = aValue ?? 0;
        const bNum = bValue ?? 0;
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      } else if (
        column === 'llm_release_date' ||
        column === 'llm_created_at' ||
        column === 'llm_last_modified_at'
      ) {
        // Date sorting
        const aDate = aValue ? new Date(aValue).getTime() : 0;
        const bDate = bValue ? new Date(bValue).getTime() : 0;
        return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
      } else if (column === 'is_local_llm' || column === 'is_active_llm') {
        // Boolean sorting (false < true)
        const aBool = aValue ? 1 : 0;
        const bBool = bValue ? 1 : 0;
        return sortConfig.direction === 'asc' ? aBool - bBool : bBool - aBool;
      } else {
        // String sorting
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        if (sortConfig.direction === 'asc') {
          return aStr.localeCompare(bStr, 'et');
        } else {
          return bStr.localeCompare(aStr, 'et');
        }
      }
    });
  }, [allLLMs, filters, sortConfig]);

  const hasOpenTiles = openTiles.size > 0;

  interface ModalityRow {
    llm_supported_modality_id?: number;
    llm_id?: number;
    modality_code?: string;
    modality_name?: string;
    is_input?: boolean;
  }

  interface LanguageRow {
    llm_id?: number;
    language_code?: string;
    language_name?: string;
  }

  const { data: allModalities = [] } = useQuery({
    queryKey: queryKeys.allModalities,
    queryFn: () => apiFetchJson<ModalityRow[]>('/api/llm-modality-all'),
    enabled: hasOpenTiles,
  });

  const { data: allLanguages = [] } = useQuery({
    queryKey: queryKeys.allLanguages,
    queryFn: () => apiFetchJson<LanguageRow[]>('/api/llm-supported-language-all'),
    enabled: hasOpenTiles,
  });

  const modalitiesByLlm = useMemo(() => {
    const map = new Map<number, { input: ModalityRow[]; output: ModalityRow[] }>();
    for (const row of allModalities) {
      if (!row.llm_id || !row.modality_name) continue;
      let group = map.get(row.llm_id);
      if (!group) {
        group = { input: [], output: [] };
        map.set(row.llm_id, group);
      }
      if (row.is_input) group.input.push(row);
      else group.output.push(row);
    }
    return map;
  }, [allModalities]);

  const languagesByLlm = useMemo(() => {
    const map = new Map<number, LanguageRow[]>();
    for (const row of allLanguages) {
      if (!row.llm_id || !row.language_name) continue;
      let arr = map.get(row.llm_id);
      if (!arr) {
        arr = [];
        map.set(row.llm_id, arr);
      }
      arr.push(row);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        (a.language_name || '')
          .toLowerCase()
          .localeCompare((b.language_name || '').toLowerCase(), 'et', { sensitivity: 'base' })
      );
    }
    return map;
  }, [allLanguages]);

  const modalityColorMap = useMemo(() => {
    const unique = Array.from(
      new Map(
        allModalities.map((r) => [r.modality_code || r.modality_name?.toLowerCase(), r])
      ).values()
    );
    const map = new Map<string, string>();
    unique.forEach((r, i) => {
      map.set(
        r.modality_code || r.modality_name?.toLowerCase() || '',
        PASTEL_CHIP_CLASSNAMES[i % PASTEL_CHIP_CLASSNAMES.length]!
      );
    });
    return map;
  }, [allModalities]);

  const getModalityColor = useCallback(
    (row: ModalityRow) => {
      const key = row.modality_code || row.modality_name?.toLowerCase() || '';
      return modalityColorMap.get(key) || PASTEL_CHIP_FALLBACK_CLASS;
    },
    [modalityColorMap]
  );

  const [expandedLanguages, setExpandedLanguages] = useState<Set<number>>(new Set());
  const LANG_PREVIEW_COUNT = 4;

  const openAllTiles = () => {
    if (!llms) return;
    const allIds = new Set(llms.map((k) => k.llm_id).filter((id) => id !== undefined) as number[]);
    setOpenTiles(allIds);
  };

  const closeAllTiles = () => {
    setOpenTiles(new Set());
  };

  useImperativeHandle(ref, () => ({
    handleCreate,
    openAllTiles,
    closeAllTiles,
  }));

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 @min-[516px]:grid-cols-2 @min-[800px]:grid-cols-3 @min-[1100px]:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
    );
  }

  if (!llms) {
    return (
      <div className="text-center">
        <p>{t('dataTable.noData')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 @min-[516px]:grid-cols-2 @min-[800px]:grid-cols-3 @min-[1100px]:grid-cols-4 gap-4">
        {llms.map((llm) => {
          const llmId = llm.llm_id;
          const isActive = llm.is_active_llm;
          const isOpen = llmId !== undefined && openTiles.has(llmId);

          return (
            <div
              key={llmId}
              className="@container bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
            >
              <div className="flex w-full min-w-0 flex-col-reverse flex-wrap gap-2 @[240px]:flex-row @[240px]:items-start">
                <div className="min-w-0 w-full @[240px]:flex-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('manager.modelName')}
                  </label>
                  <p className="mt-0.5 text-sm font-semibold break-words">{llm.llm_name || '-'}</p>
                </div>
                <div className="flex w-full shrink-0 flex-wrap justify-start gap-0.5 -ml-2 @[240px]:w-auto @[240px]:justify-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => navigate({ to: `/llm/${llmId}` })}
                    className="text-muted-foreground hover:text-foreground"
                    title={t('dataTable.viewDetails')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => llmId && handleEdit(llmId)}
                    className="text-muted-foreground hover:text-foreground"
                    title={t('modelDetail.editModel')}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => llmId && handleToggleActive(llmId)}
                    className={
                      isActive
                        ? 'text-muted-foreground hover:text-foreground'
                        : 'text-muted-foreground hover:text-destructive'
                    }
                    title={
                      isActive ? t('modelDetail.deactivateModel') : t('modelDetail.activateModel')
                    }
                  >
                    {isActive ? (
                      <ToggleRight className="h-4 w-4" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="min-w-0 flex-grow space-y-4">
                {isOpen ? (
                  // Open view - show all information
                  <>
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.groupName')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-base">{llm.llm_group_name || '-'}</p>
                          {llm.llm_group_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.companyName')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-base"> {llm.model_company_name || '-'} </p>
                          {llm.model_company_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.companyCountry')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-base">{llm.model_company_country || '-'}</p>
                          {llm.model_company_country_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.version')}
                        </label>
                        <p className="mt-1 text-base">{llm.llm_version || '-'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.contextLength')}
                        </label>
                        <p className="mt-1 text-base"> {llm.llm_context_length ?? '-'} </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('modelDetail.maxOutputTokensLabel')}
                        </label>
                        <p className="mt-1 text-base"> {llm.llm_max_output_tokens ?? '-'} </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.releaseDate')}
                        </label>
                        <p className="mt-1 text-base">
                          {llm.llm_release_date
                            ? (() => {
                                const dateValue = llm.llm_release_date;
                                const dateStr = String(dateValue);
                                const utcDate = dateStr.includes('T')
                                  ? new Date(dateStr)
                                  : new Date(dateStr + 'T00:00:00.000Z');
                                return utcDate.toLocaleDateString('de-DE', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                });
                              })()
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.isLocal')}
                        </label>
                        <p className="mt-1 text-base">
                          {' '}
                          {llm.is_local_llm ? t('common.yes') : t('common.no')}{' '}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.isActive')}
                        </label>
                        <p className="mt-1 text-base">
                          {' '}
                          {llm.is_active_llm ? t('common.yes') : t('common.no')}{' '}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.createdAt')}
                        </label>
                        <p className="mt-1 text-base">
                          {llm.llm_created_at
                            ? new Date(llm.llm_created_at).toLocaleString('de-DE', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.creatorEmail')}
                        </label>
                        <p className="mt-1 text-base">{llm.llm_creator_email || '-'}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.lastModifiedAt')}
                        </label>
                        <p className="mt-1 text-base">
                          {' '}
                          {llm.llm_last_modified_at
                            ? new Date(llm.llm_last_modified_at).toLocaleString('de-DE', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('manager.lastModifierEmail')}
                        </label>
                        <p className="mt-1 text-base">{llm.llm_last_modifier_email || '-'}</p>
                      </div>
                    </div>
                    {llm.llm_other_parameters && llm.llm_other_parameters.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <label className="text-sm font-medium text-muted-foreground">
                          {t('modelDetail.otherParams')}
                        </label>
                        <div className="mt-2 space-y-1">
                          {llm.llm_other_parameters.map((param: any, index: number) => (
                            <div key={index} className="text-base">
                              <span className="font-medium">{param.key}:</span>{' '}
                              {String(param.value)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(() => {
                      const mods = llmId != null ? modalitiesByLlm.get(llmId) : undefined;
                      if (!mods || (mods.input.length === 0 && mods.output.length === 0))
                        return null;
                      return (
                        <div className="mt-4 pt-4 border-t">
                          <label className="text-sm font-medium text-muted-foreground">
                            {t('manager.supportedModalities')}
                          </label>
                          <div className="mt-2 space-y-2">
                            {mods.input.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  {t('modalitiesSection.inputTokens')}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {mods.input.map((row, i) => (
                                    <span
                                      key={row.llm_supported_modality_id || i}
                                      className={`px-2.5 py-0.5 rounded-md text-xs font-medium ${getModalityColor(row)}`}
                                    >
                                      {row.modality_name?.toLowerCase()}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {mods.output.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  {t('modalitiesSection.outputTokens')}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {mods.output.map((row, i) => (
                                    <span
                                      key={row.llm_supported_modality_id || i}
                                      className={`px-2.5 py-0.5 rounded-md text-xs font-medium ${getModalityColor(row)}`}
                                    >
                                      {row.modality_name?.toLowerCase()}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {(() => {
                      const langs = llmId != null ? languagesByLlm.get(llmId) : undefined;
                      if (!langs || langs.length === 0) return null;
                      const isExpanded = llmId != null && expandedLanguages.has(llmId);
                      const visible = isExpanded ? langs : langs.slice(0, LANG_PREVIEW_COUNT);
                      const hasMore = langs.length > LANG_PREVIEW_COUNT;
                      return (
                        <div className="mt-4 pt-4 border-t">
                          <label className="text-sm font-medium text-muted-foreground">
                            {t('manager.supportedLanguages')}
                          </label>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {visible.map((row, i) => (
                              <span
                                key={row.language_code || i}
                                className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-muted text-foreground"
                              >
                                {row.language_name?.toLowerCase()}
                              </span>
                            ))}
                            {hasMore && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLanguages((prev) => {
                                    const next = new Set(prev);
                                    if (isExpanded) next.delete(llmId!);
                                    else next.add(llmId!);
                                    return next;
                                  })
                                }
                                className="px-2.5 py-0.5 rounded-md text-xs font-medium text-primary hover:underline"
                              >
                                {isExpanded
                                  ? t('manager.showLess')
                                  : t('manager.showMore', {
                                      count: langs.length - LANG_PREVIEW_COUNT,
                                    })}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  // Closed view - company name inline
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {llm.model_company_name || '-'}
                    </span>
                    {llm.model_company_is_active === false && (
                      <span
                        className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-900"
                        title={t('manager.inactiveDependency')}
                      >
                        {t('common.deactivated')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editingLLM && (
        <ModelEditForm
          llm={editingLLM}
          isOpen={true}
          onClose={() => setEditingLLM(null)}
          onSave={handleSaveEdit}
          onDelete={() => {
            const target = editingLLM;
            setEditingLLM(null);
            setDeletingLLM(target);
          }}
          isDeleting={deleteMutation.isPending}
        />
      )}

      <AlertModal
        open={activateAlert !== 'closed'}
        onClose={() => setActivateAlert('closed')}
        title={
          activateAlert === 'fetchError'
            ? t('modelDetail.error')
            : t('modelDetail.activateBlockedTitle')
        }
        description={
          activateAlert === 'fetchError'
            ? t('modelDetail.toggleFailed')
            : t('modelDetail.activateRequiresApi')
        }
        confirmLabel={t('common.ok')}
        variant={activateAlert === 'fetchError' ? 'destructive' : 'default'}
      />

      {deletingLLM && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-destructive/15 rounded-full flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {t('modelDetail.confirmDeleteTitle')}
                  </h3>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {t('modelDetail.confirmDeleteText')} <strong>"{deletingLLM.llm_name}"</strong>
                    {t('modelDetail.confirmDeleteSuffix')}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDeletingLLM(null)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" onClick={handleConfirmDelete}>
                  {t('modelDetail.confirmDeleteButton')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCreating && (
        <ModelEditForm
          llm={{
            llm_name: '',
            llm_group_id: undefined,
            llm_group_name: '',
            model_company_name: '',
            model_company_country: '',
            llm_version: '',
            llm_context_length: undefined,
            llm_max_output_tokens: undefined,
            llm_other_parameters: [],
            llm_release_date: '',
            is_local_llm: false,
            is_active_llm: false,
            llm_created_at: '',
            llm_creator_email: '',
            llm_last_modified_at: '',
            llm_last_modifier_email: '',
          }}
          isOpen={true}
          onClose={handleCancelCreate}
          onSave={handleSaveCreate}
          isCreating={true}
        />
      )}
    </div>
  );
});
