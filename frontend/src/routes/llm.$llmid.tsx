import { useState } from 'react';
import { createFileRoute, useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Edit, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import toast from '@/lib/toast';
import { AlertModal } from '@/components/AlertModal';
import { Button } from '@/components/ui/button';
import { ModelEditForm } from '@/components/edit-form';
import { CardSkeleton } from '@/components/table-skeleton';
import { LanguagesSection } from '@/components/model-detail/LanguagesSection';
import { ModalitiesSection } from '@/components/model-detail/ModalitiesSection';
import { ApiSection } from '@/components/model-detail/ApiSection';
import { PricingSection } from '@/components/model-detail/PricingSection';
import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import type { LanguageModel } from '@/types';
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

export const Route = createFileRoute('/llm/$llmid')({
  component: ModelDetailPage,
});

function ModelDetailPage() {
  const { llmid } = useParams({ from: '/llm/$llmid' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activateAlert, setActivateAlert] = useState<'closed' | 'noApi' | 'fetchError'>('closed');
  const modelId = parseInt(llmid);

  const {
    data: allModels,
    isLoading: isLoadingModel,
    error: fetchError,
  } = useQuery({
    queryKey: queryKeys.llms,
    queryFn: () => apiFetchJson<any[]>('/api/llms'),
  });

  const model: LanguageModel | null = allModels
    ? (allModels.map(normalizeModelParams).find((llm: LanguageModel) => llm.llm_id === modelId) ??
      null)
    : null;

  const error = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'An error occurred'
    : !isLoadingModel && allModels && !model
      ? 'Language model not found'
      : null;

  const editMutation = useMutation({
    mutationFn: async (updatedModel: LanguageModel) => {
      const updateData = {
        model_name: updatedModel.llm_name,
        llm_group_id: updatedModel.llm_group_id,
        version: updatedModel.llm_version,
        context_length: updatedModel.llm_context_length,
        max_output_tokens: updatedModel.llm_max_output_tokens,
        other_parameters: updatedModel.llm_other_parameters,
        release_date: updatedModel.llm_release_date,
        is_local: updatedModel.is_local_llm,
        is_active: updatedModel.is_active_llm,
      };
      const res = await apiPut(`/api/llms/${llmid}`, updateData);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.editFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      setIsEditing(false);
      toast.success(t('modelDetail.editSuccess'));
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiDelete(`/api/llms/${llmid}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.llms });
      toast.success(t('modelDetail.deleteSuccess'));
      navigate({ to: '/manager' as any });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      if (!model) return null;
      const endpoint = model.is_active_llm
        ? `/api/llms/${llmid}/deactivate`
        : `/api/llms/${llmid}/activate`;
      const res = await apiPost(endpoint, {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modelDetail.toggleFailed'));
      }
      const data = (await res.json()) as { no_active_llms_remain?: boolean };
      return {
        wasActive: model.is_active_llm,
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
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSaveEdit = (updatedModel: LanguageModel) => editMutation.mutate(updatedModel);
  const handleConfirmDelete = () => deleteMutation.mutate();
  const handleToggleActive = async () => {
    if (!model) return;
    if (!model.is_active_llm) {
      try {
        const rows = await queryClient.fetchQuery({
          queryKey: queryKeys.apiData(modelId),
          queryFn: () => apiFetchJson<LlmApiCredentialRow[]>(`/api/llm-api/${modelId}`),
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
    toggleActiveMutation.mutate();
  };

  if (error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={t('modelDetail.error')}
          start={
            <Button variant="outline" onClick={() => navigate({ to: '/manager' as any })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('common.back')}
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="text-center text-destructive">
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        title={
          <>
            {t('modelDetail.model')} {model?.llm_name || `ID: ${llmid}`}
          </>
        }
        start={
          <Button variant="outline" onClick={() => navigate({ to: '/manager' as any })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="mb-8">
            {isLoadingModel ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <CardSkeleton lines={6} />
                </div>
                <div className="space-y-6">
                  <CardSkeleton lines={3} />
                  <CardSkeleton lines={3} />
                </div>
              </div>
            ) : model ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <div className="bg-card border border-border rounded-lg p-6 space-y-4 relative shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[15px] font-semibold">{t('modelDetail.data')}</h3>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditing(true)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={t('modelDetail.editModel')}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleToggleActive}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={
                            model.is_active_llm
                              ? t('modelDetail.deactivateModel')
                              : t('modelDetail.activateModel')
                          }
                        >
                          {model.is_active_llm ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => !model.is_active_llm && setIsDeleting(true)}
                          className={`p-1 ${model.is_active_llm ? 'opacity-50 cursor-not-allowed text-muted-foreground' : 'text-muted-foreground hover:text-destructive'}`}
                          title={
                            model.is_active_llm
                              ? t('modelDetail.cannotDeleteActive')
                              : t('modelDetail.deleteModel')
                          }
                          disabled={model.is_active_llm}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.modelName')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_name || '-'}</p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.groupName')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-[14px]">{model.llm_group_name || '-'}</p>
                          {model.llm_group_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[12px] font-medium text-foreground"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.companyName')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-[14px]">{model.model_company_name || '-'}</p>
                          {model.model_company_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[12px] font-medium text-foreground"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.companyCountry')}
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-[14px]">{model.model_company_country || '-'}</p>
                          {model.model_company_country_is_active === false && (
                            <span
                              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[12px] font-medium text-foreground"
                              title={t('manager.inactiveDependency')}
                            >
                              {t('common.deactivated')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.version')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_version || '-'}</p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.contextLength')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_context_length ?? '-'}</p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('modelDetail.maxOutputTokensLabel')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_max_output_tokens ?? '-'}</p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.releaseDate')}
                        </label>
                        <p className="mt-1 text-[14px]">
                          {model.llm_release_date
                            ? (() => {
                                const dateValue = model.llm_release_date;
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
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.isLocal')}
                        </label>
                        <p className="mt-1 text-[14px]">
                          {model.is_local_llm ? t('common.yes') : t('common.no')}
                        </p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.isActive')}
                        </label>
                        <p className="mt-1 text-[14px]">
                          {model.is_active_llm ? t('common.yes') : t('common.no')}
                        </p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.createdAt')}
                        </label>
                        <p className="mt-1 text-[14px]">
                          {model.llm_created_at
                            ? new Date(model.llm_created_at).toLocaleString('de-DE', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.creatorEmail')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_creator_email || '-'}</p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.lastModifiedAt')}
                        </label>
                        <p className="mt-1 text-[14px]">
                          {model.llm_last_modified_at
                            ? new Date(model.llm_last_modified_at).toLocaleString('de-DE', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('manager.lastModifierEmail')}
                        </label>
                        <p className="mt-1 text-[14px]">{model.llm_last_modifier_email || '-'}</p>
                      </div>
                    </div>
                    {model.llm_other_parameters && model.llm_other_parameters.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <label className="text-[12px] font-medium text-muted-foreground">
                          {t('modelDetail.otherParams')}
                        </label>
                        <div className="mt-2 space-y-1">
                          {model.llm_other_parameters.map((param: any, index: number) => (
                            <div key={index} className="text-[14px]">
                              <span className="font-medium">{param.key}:</span>{' '}
                              {String(param.value)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-1 space-y-6">
                  <LanguagesSection modelId={modelId} />
                  <ModalitiesSection modelId={modelId} />
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t('modelDetail.notFound')}</p>
              </div>
            )}
          </div>

          <ApiSection modelId={modelId} />

          <PricingSection modelId={modelId} />

          {isEditing && model && (
            <ModelEditForm
              llm={model}
              isOpen={true}
              onClose={() => setIsEditing(false)}
              onSave={handleSaveEdit}
              onDelete={() => {
                setIsEditing(false);
                setIsDeleting(true);
              }}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {isDeleting && model && (
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
                        {t('modelDetail.confirmDeleteText')} <strong>"{model.llm_name}"</strong>
                        {t('modelDetail.confirmDeleteSuffix')}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={() => setIsDeleting(false)}>
                      {t('modelDetail.cancel')}
                    </Button>
                    <Button variant="destructive" onClick={handleConfirmDelete}>
                      {t('modelDetail.confirmDeleteButton')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
