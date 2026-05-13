import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, X } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { ListSkeleton } from '@/components/table-skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';
import { apiPost, apiDelete, apiFetchJson, queryKeys } from '@/lib/api';
import { PASTEL_CHIP_CLASSNAMES } from '@/lib/pastel-chip-colors';

interface ModalityRow {
  llm_supported_modality_id?: number;
  llm_id?: number;
  llm_name?: string;
  is_active_llm?: boolean;
  modality_code?: string;
  modality_name?: string;
  is_input?: boolean;
}

interface AvailableModality {
  modality_code: string;
  modality_name: string;
}

interface ModalitiesSectionProps {
  modelId: number;
}

function buildColorMap(rows: ModalityRow[]): Map<string, string> {
  const uniqueRows = Array.from(
    new Map(
      rows.map((row) => [row.modality_code || row.modality_name?.toLowerCase(), row])
    ).values()
  );
  const map = new Map<string, string>();
  uniqueRows.forEach((row, index) => {
    const key = row.modality_code || row.modality_name?.toLowerCase() || '';
    map.set(key, PASTEL_CHIP_CLASSNAMES[index % PASTEL_CHIP_CLASSNAMES.length]!);
  });
  return map;
}

type DirectionSelection = { input: boolean; output: boolean };

const defaultDirections: DirectionSelection = { input: true, output: false };

export function ModalitiesSection({ modelId }: ModalitiesSectionProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isAddingModality, setIsAddingModality] = useState(false);
  const [isDeletingModality, setIsDeletingModality] = useState(false);
  const [directions, setDirections] = useState<DirectionSelection>(defaultDirections);
  const [selectedModalityCodes, setSelectedModalityCodes] = useState<string[]>([]);

  const { data: modalityData = [], isLoading } = useQuery({
    queryKey: queryKeys.supportedModalities(modelId),
    queryFn: () => apiFetchJson<ModalityRow[]>(`/api/llm-modality/${modelId}`),
  });

  const { data: modalities = [], isLoading: isLoadingModalities } = useQuery({
    queryKey: queryKeys.modalities,
    queryFn: () => apiFetchJson<AvailableModality[]>('/api/modalities'),
    enabled: isAddingModality,
  });

  const addModalitiesMutation = useMutation({
    mutationFn: async (tasks: Array<{ modality_code: string; is_input: boolean }>) => {
      await Promise.all(
        tasks.map(async ({ modality_code, is_input }) => {
          const res = await apiPost('/api/llm-supported-modalities', {
            llm_id: modelId,
            modality_code,
            is_input,
          });
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(formatApiErrorMessage(t, errorData, 'modalitiesSection.addFailed'));
          }
        })
      );
      return tasks.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.supportedModalities(modelId) });
      toast.success(t('modalitiesSection.addSuccess', { count }));
      setIsAddingModality(false);
      setSelectedModalityCodes([]);
      setDirections(defaultDirections);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteModalityMutation = useMutation({
    mutationFn: async ({
      modalityId,
      modalityName,
    }: {
      modalityId: number;
      modalityName: string;
    }) => {
      const res = await apiDelete(`/api/llm-supported-modalities/${modalityId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'modalitiesSection.removeFailed'));
      }
      return modalityName;
    },
    onSuccess: (modalityName) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.supportedModalities(modelId) });
      toast.success(t('modalitiesSection.removeSuccess', { name: modalityName }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const existingInputCodes = new Set(
    modalityData
      .filter(
        (row) => row.modality_code && row.llm_supported_modality_id != null && row.is_input === true
      )
      .map((row) => row.modality_code as string)
  );

  const existingOutputCodes = new Set(
    modalityData
      .filter(
        (row) =>
          row.modality_code && row.llm_supported_modality_id != null && row.is_input === false
      )
      .map((row) => row.modality_code as string)
  );

  const availableModalitiesToAdd = modalities.filter((m) => {
    if (directions.input && !existingInputCodes.has(m.modality_code)) return true;
    if (directions.output && !existingOutputCodes.has(m.modality_code)) return true;
    return false;
  });

  const handleAddModalities = () => {
    if (!directions.input && !directions.output) {
      toast.error(t('modalitiesSection.pickDirection'));
      return;
    }
    if (!selectedModalityCodes.length) {
      toast.error(t('modalitiesSection.pickOne'));
      return;
    }
    const uniqueCodes = Array.from(new Set(selectedModalityCodes)).filter(Boolean);
    const tasks: Array<{ modality_code: string; is_input: boolean }> = [];
    for (const code of uniqueCodes) {
      if (directions.input && !existingInputCodes.has(code)) {
        tasks.push({ modality_code: code, is_input: true });
      }
      if (directions.output && !existingOutputCodes.has(code)) {
        tasks.push({ modality_code: code, is_input: false });
      }
    }
    if (!tasks.length) {
      toast.error(t('modalitiesSection.pickOne'));
      return;
    }
    addModalitiesMutation.mutate(tasks);
  };

  const handleDeleteModality = (modalityId: number | undefined, modalityName: string) => {
    if (!modalityId || isNaN(Number(modalityId))) {
      toast.error(t('modalitiesSection.idInvalid'));
      return;
    }
    deleteModalityMutation.mutate({ modalityId, modalityName });
  };

  const inputModalities = modalityData.filter(
    (row) =>
      row.is_input === true && row.modality_name && row.modality_name.toString().trim() !== ''
  );

  const outputModalities = modalityData.filter(
    (row) =>
      row.is_input === false && row.modality_name && row.modality_name.toString().trim() !== ''
  );

  const hasModalities = modalityData.some(
    (row) => row.modality_name && row.modality_name.toString().trim() !== ''
  );

  const modalityColorMap = buildColorMap([...inputModalities, ...outputModalities]);

  const getModalityColor = (row: ModalityRow) => {
    const key = row.modality_code || row.modality_name?.toLowerCase() || '';
    return modalityColorMap.get(key) || PASTEL_CHIP_CLASSNAMES[0]!;
  };

  const renderModalityChip = (row: ModalityRow, index: number) => {
    const colorClass = getModalityColor(row);
    const modalityName = row.modality_name?.toLowerCase() || '';
    const modalityId = row.llm_supported_modality_id;
    return (
      <span
        key={modalityId || index}
        className={`${isDeletingModality ? 'px-3 pr-2' : 'px-3'} py-1 rounded-md text-sm font-medium flex items-center gap-1 ${colorClass}`}
      >
        {modalityName}
        {isDeletingModality && modalityId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteModality(modalityId, row.modality_name || '');
            }}
            className="ml-1 hover:bg-muted/80 rounded-full p-0.5 transition-colors flex-shrink-0"
            title={t('modalitiesSection.deleteChipTitle')}
          >
            <X className="h-3 w-3 text-foreground" />
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold">{t('modalitiesSection.title')}</h3>
        <div className="flex gap-1">
          {hasModalities && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDeletingModality(!isDeletingModality)}
              className={`p-1 ${isDeletingModality ? 'text-destructive' : 'hover:text-destructive'}`}
              title={
                isDeletingModality
                  ? t('modalitiesSection.stopDeleting')
                  : t('modalitiesSection.deleteModalities')
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedModalityCodes([]);
              setDirections(defaultDirections);
              setIsAddingModality(true);
            }}
            className="p-1 text-muted-foreground hover:text-foreground"
            title={t('modalitiesSection.addModality')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton items={3} />
      ) : inputModalities.length === 0 && outputModalities.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('modalitiesSection.noData')}</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              {t('modalitiesSection.inputTokens')}
            </p>
            {inputModalities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {inputModalities.map((row, index) => renderModalityChip(row, index))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('modalitiesSection.none')}</p>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              {t('modalitiesSection.outputTokens')}
            </p>
            {outputModalities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {outputModalities.map((row, index) => renderModalityChip(row, index))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('modalitiesSection.none')}</p>
            )}
          </div>
        </div>
      )}

      {isAddingModality && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('modalitiesSection.addTitle')}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingModality(false);
                  setSelectedModalityCodes([]);
                  setDirections(defaultDirections);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddModalities();
              }}
              className="p-6"
              noValidate
            >
              <Field>
                <FieldLabel>
                  {t('modalitiesSection.tokenType')} <RequiredMark />
                </FieldLabel>
                <div className="flex gap-6 mt-2 mb-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={directions.input}
                      onChange={(e) => {
                        setDirections((prev) => ({ ...prev, input: e.target.checked }));
                        setSelectedModalityCodes([]);
                      }}
                      className="text-primary"
                    />
                    {t('modalitiesSection.input')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={directions.output}
                      onChange={(e) => {
                        setDirections((prev) => ({ ...prev, output: e.target.checked }));
                        setSelectedModalityCodes([]);
                      }}
                      className="text-primary"
                    />
                    {t('modalitiesSection.output')}
                  </label>
                </div>
              </Field>
              <Field>
                <FieldLabel>
                  {t('modalitiesSection.modalitiesLabel')} <RequiredMark />
                </FieldLabel>
                {isLoadingModalities ? (
                  <p className="text-sm text-muted-foreground mt-2">{t('common.loading')}</p>
                ) : availableModalitiesToAdd.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    {t('modalitiesSection.allAdded')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableModalitiesToAdd.map((modality) => {
                      const isSelected = selectedModalityCodes.includes(modality.modality_code);
                      return (
                        <button
                          key={modality.modality_code}
                          type="button"
                          onClick={() => {
                            setSelectedModalityCodes((prev) => {
                              if (prev.includes(modality.modality_code)) {
                                return prev.filter((c) => c !== modality.modality_code);
                              }
                              return [...prev, modality.modality_code];
                            });
                          }}
                          className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${
                            isSelected
                              ? 'bg-neutral-500 text-neutral-50 hover:bg-neutral-600 dark:bg-neutral-600 dark:text-neutral-50 dark:hover:bg-neutral-500 border-neutral-600/40'
                              : 'bg-muted text-foreground hover:bg-muted/80'
                          }`}
                          title={t('modalitiesSection.selectToAdd')}
                        >
                          {modality.modality_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <div className="flex justify-end gap-2 pt-4 mt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddingModality(false);
                    setSelectedModalityCodes([]);
                    setDirections(defaultDirections);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit">{t('common.save')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
