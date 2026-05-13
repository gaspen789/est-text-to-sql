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

interface LanguageRow {
  llm_id?: number;
  llm_name?: string;
  is_active_llm?: boolean;
  language_code?: string;
  language_name?: string;
}

interface AvailableLanguage {
  language_code: string;
  language_name: string;
}

interface LanguagesSectionProps {
  modelId: number;
}

export function LanguagesSection({ modelId }: LanguagesSectionProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isAddingLanguage, setIsAddingLanguage] = useState(false);
  const [isDeletingLanguage, setIsDeletingLanguage] = useState(false);
  const [selectedLanguageCodes, setSelectedLanguageCodes] = useState<string[]>([]);

  const { data: supportedLanguageData = [], isLoading } = useQuery({
    queryKey: queryKeys.supportedLanguages(modelId),
    queryFn: () => apiFetchJson<LanguageRow[]>(`/api/llm-supported-language/${modelId}`),
  });

  const { data: languages = [], isLoading: isLoadingLanguages } = useQuery({
    queryKey: queryKeys.languages,
    queryFn: () => apiFetchJson<AvailableLanguage[]>('/api/keeled'),
    enabled: isAddingLanguage,
  });

  const addLanguagesMutation = useMutation({
    mutationFn: async (languageCodes: string[]) => {
      const uniqueCodes = Array.from(new Set(languageCodes)).filter(Boolean);
      await Promise.all(
        uniqueCodes.map(async (language_code) => {
          const res = await apiPost('/api/llm-supported-language', {
            language_code,
            llm_id: modelId,
          });
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(formatApiErrorMessage(t, errorData, 'languagesSection.addFailed'));
          }
        })
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.supportedLanguages(modelId) });
      toast.success(t('languagesSection.addSuccess', { count: variables.length }));
      setIsAddingLanguage(false);
      setSelectedLanguageCodes([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLanguageMutation = useMutation({
    mutationFn: async ({
      languageCode,
      languageName,
    }: {
      languageCode: string;
      languageName: string;
    }) => {
      const res = await apiDelete(
        `/api/llm-supported-language?llm_id=${modelId}&language_code=${languageCode}`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'languagesSection.removeFailed'));
      }
      return languageName;
    },
    onSuccess: (languageName) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.supportedLanguages(modelId) });
      toast.success(t('languagesSection.removeSuccess', { name: languageName.toLowerCase() }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleAddLanguages = () => {
    if (!selectedLanguageCodes.length) {
      toast.error(t('languagesSection.pickOne'));
      return;
    }
    addLanguagesMutation.mutate(selectedLanguageCodes);
  };

  const handleDeleteLanguage = (languageCode: string | undefined, languageName: string) => {
    if (!languageCode) {
      toast.error(t('languagesSection.codeMissing'));
      return;
    }
    deleteLanguageMutation.mutate({ languageCode, languageName });
  };

  const sortedLanguages = [...supportedLanguageData]
    .filter((row) => row.language_name && row.language_name.toString().trim() !== '')
    .sort((a, b) => {
      const nameA = (a.language_name || '').toString().toLowerCase();
      const nameB = (b.language_name || '').toString().toLowerCase();
      return nameA.localeCompare(nameB, 'et', { sensitivity: 'base' });
    });

  const supportedLanguageCodeSet = new Set(
    supportedLanguageData
      .map((row) => row.language_code)
      .filter((code): code is string => Boolean(code))
  );

  const availableLanguagesToAdd = languages.filter(
    (lang) => !supportedLanguageCodeSet.has(lang.language_code)
  );

  const hasLanguages = sortedLanguages.length > 0;

  return (
    <div className="bg-card border border-border rounded-lg p-6 relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold">{t('languagesSection.title')}</h3>
        <div className="flex gap-1">
          {hasLanguages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDeletingLanguage(!isDeletingLanguage)}
              className={`p-1 ${isDeletingLanguage ? 'text-destructive' : 'hover:text-destructive'}`}
              title={
                isDeletingLanguage
                  ? t('languagesSection.stopDeleting')
                  : t('languagesSection.deleteLanguages')
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedLanguageCodes([]);
              setIsAddingLanguage(true);
            }}
            className="p-1 text-muted-foreground hover:text-foreground"
            title={t('languagesSection.addLanguage')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton items={3} />
      ) : sortedLanguages.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('languagesSection.noData')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sortedLanguages.map((row, index) => {
            const languageName = row.language_name?.toLowerCase() || '';
            const languageCode = row.language_code;
            return (
              <span
                key={languageCode || index}
                className={`${isDeletingLanguage ? 'px-3 pr-2' : 'px-3'} py-1 rounded-md text-sm font-medium flex items-center gap-1 bg-muted text-foreground`}
              >
                {languageName}
                {isDeletingLanguage && languageCode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLanguage(languageCode, row.language_name || '');
                    }}
                    className="ml-1 hover:bg-muted/80 rounded-full p-0.5 transition-colors flex-shrink-0"
                    title={t('languagesSection.deleteChipTitle')}
                  >
                    <X className="h-3 w-3 text-foreground" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {isAddingLanguage && (
        <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-[15px] font-semibold">{t('languagesSection.addTitle')}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingLanguage(false);
                  setSelectedLanguageCodes([]);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddLanguages();
              }}
              className="p-6"
              noValidate
            >
              <Field>
                <FieldLabel>
                  {t('languagesSection.languagesLabel')} <RequiredMark />
                </FieldLabel>

                {isLoadingLanguages ? (
                  <p className="text-[13px] text-muted-foreground mt-2">{t('common.loading')}</p>
                ) : availableLanguagesToAdd.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground mt-2">
                    {t('languagesSection.allAdded')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableLanguagesToAdd.map((lang) => {
                      const isSelected = selectedLanguageCodes.includes(lang.language_code);
                      return (
                        <button
                          key={lang.language_code}
                          type="button"
                          onClick={() => {
                            setSelectedLanguageCodes((prev) => {
                              if (prev.includes(lang.language_code)) {
                                return prev.filter((c) => c !== lang.language_code);
                              }
                              return [...prev, lang.language_code];
                            });
                          }}
                          className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${
                            isSelected
                              ? 'bg-neutral-500 text-neutral-50 hover:bg-neutral-600 dark:bg-neutral-600 dark:text-neutral-50 dark:hover:bg-neutral-500 border-neutral-600/40'
                              : 'bg-muted text-foreground hover:bg-muted/80'
                          }`}
                          title={t('languagesSection.selectToAdd')}
                        >
                          {(lang.language_name ?? '').toLowerCase()}
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
                    setIsAddingLanguage(false);
                    setSelectedLanguageCodes([]);
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
