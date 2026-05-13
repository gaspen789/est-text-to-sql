import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import toast from '@/lib/toast';
import type { LanguageModel, ModelGroup } from '@/types';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useTranslation } from '@/hooks/useTranslation';

interface EditFormProps {
  llm: LanguageModel;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedLLM: LanguageModel) => void;
  onDelete?: () => void;
  isCreating?: boolean;
  isDeleting?: boolean;
}

export function ModelEditForm({
  llm,
  isOpen,
  onClose,
  onSave,
  onDelete,
  isCreating = false,
  isDeleting = false,
}: EditFormProps) {
  const { t } = useTranslation();
  // Convert object parameters to array format if needed
  const initialParams = Array.isArray(llm.llm_other_parameters)
    ? llm.llm_other_parameters
    : Object.entries(llm.llm_other_parameters || {}).map(([key, value]) => ({
        key,
        value,
      }));

  // Check if original llm had meaningful parameters
  const hasOriginalParameters = initialParams.some(
    (param) =>
      param.key && param.key.trim() !== '' && param.value && param.value.toString().trim() !== ''
  );

  const [formData, setFormData] = useState<LanguageModel>({
    ...llm,
    llm_other_parameters: initialParams,
  });
  const [duplicateKeyErrors, setDuplicateKeyErrors] = useState<Set<number>>(new Set());
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Set<number>>(new Set());
  const [mandatoryFieldErrors, setMandatoryFieldErrors] = useState<Set<string>>(new Set());
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [groupResolveKey, setGroupResolveKey] = useState<string | null>(null);
  const [existingOtherParamKeys, setExistingOtherParamKeys] = useState<string[]>([]);
  const [similarKeySuggestions, setSimilarKeySuggestions] = useState<Record<number, string[]>>({});

  // Ensure there's always at least one parameter row for creating, but not for editing empty llm
  if (formData.llm_other_parameters.length === 0 && (isCreating || hasOriginalParameters)) {
    setFormData((prev) => ({
      ...prev,
      llm_other_parameters: [{ key: '', value: '' }],
    }));
  }

  const paramsLength = formData.llm_other_parameters.length;
  const sanitizedInputValues = useMemo(() => {
    const next = { ...inputValues };
    Object.keys(next).forEach((inputKey) => {
      if (inputKey.startsWith('param_')) {
        const index = parseInt(inputKey.split('_')[1], 10);
        if (index >= paramsLength) {
          delete next[inputKey];
        }
      }
    });
    return next;
  }, [inputValues, paramsLength]);

  const sanitizedDuplicateKeyErrors = useMemo(
    () => new Set([...duplicateKeyErrors].filter((i) => i < paramsLength)),
    [duplicateKeyErrors, paramsLength]
  );

  const sanitizedValidationErrors = useMemo(
    () => new Set([...validationErrors].filter((i) => i < paramsLength)),
    [validationErrors, paramsLength]
  );

  // Fetch mudeli grupid on component mount
  useEffect(() => {
    const fetchModelGroups = async () => {
      try {
        const response = await apiGet('/api/llm-groups');
        if (response.ok) {
          const data = await response.json();
          setModelGroups(data);
        }
      } catch {
        // silently ignore fetch errors
      }
    };

    fetchModelGroups();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const fetchExistingKeys = async () => {
      try {
        const response = await apiGet('/api/llms/other-parameter-keys');
        if (!response.ok) return;
        const data = (await response.json()) as unknown;
        if (Array.isArray(data)) {
          setExistingOtherParamKeys(
            data
              .map((v) =>
                String(v ?? '')
                  .trim()
                  .toLowerCase()
              )
              .filter((v) => v !== '')
          );
        }
      } catch {
        // silently ignore fetch errors
      }
    };
    fetchExistingKeys();
  }, [isOpen]);

  const groupMatchAttemptKey = `${llm.llm_id ?? 'new'}|${llm.llm_group_name ?? ''}|${modelGroups.length}|${llm.llm_group_id ?? ''}`;
  if (
    llm.llm_group_name &&
    modelGroups.length > 0 &&
    !llm.llm_group_id &&
    groupMatchAttemptKey !== groupResolveKey
  ) {
    const matchingGroup = modelGroups.find((group) => group.llm_group_name === llm.llm_group_name);
    if (matchingGroup) {
      setGroupResolveKey(groupMatchAttemptKey);
      setFormData((prev) => ({
        ...prev,
        llm_group_id: matchingGroup.llm_group_id,
      }));
    }
  }

  const validateParameters = () => {
    const params = formData.llm_other_parameters;
    const newValidationErrors = new Set<number>();

    params.forEach((param, index) => {
      const currentKey =
        sanitizedInputValues[`param_${index}_key`] !== undefined
          ? sanitizedInputValues[`param_${index}_key`]
          : param.key;
      const currentValue =
        sanitizedInputValues[`param_${index}_value`] !== undefined
          ? sanitizedInputValues[`param_${index}_value`]
          : param.value;

      const keyFilled = currentKey && currentKey.trim() !== '';
      const valueFilled = currentValue && currentValue.toString().trim() !== '';

      // If only one of key or value is filled, it's a validation error
      if ((keyFilled && !valueFilled) || (!keyFilled && valueFilled)) {
        newValidationErrors.add(index);
      }
    });

    setValidationErrors(newValidationErrors);
    return newValidationErrors.size === 0;
  };

  const validateMandatoryFields = (): Set<string> => {
    const errors = new Set<string>();

    if (
      !formData.llm_name ||
      formData.llm_name.trim() === '' ||
      !/^[a-z][a-z0-9._:/-]*$/.test(formData.llm_name.trim())
    ) {
      errors.add('llm_name');
    }

    if (!formData.llm_group_id) {
      errors.add('llm_group_id');
    }

    const ctx = formData.llm_context_length;
    if (
      ctx === undefined ||
      ctx === null ||
      !Number.isFinite(ctx) ||
      !Number.isInteger(ctx) ||
      ctx <= 0
    ) {
      errors.add('llm_context_length');
    }

    const mot = formData.llm_max_output_tokens;
    if (mot !== undefined && mot !== null) {
      if (!Number.isFinite(mot) || !Number.isInteger(mot) || mot <= 0) {
        errors.add('llm_max_output_tokens');
      }
    }

    setMandatoryFieldErrors(errors);
    return errors;
  };

  // Helper function to normalize values for comparison
  const normalizeValue = (value: any): any => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value
        .filter((item) => {
          if (typeof item === 'object' && item !== null) {
            const keyFilled = item.key && item.key.trim() !== '';
            const valueFilled = item.value && item.value.toString().trim() !== '';
            return keyFilled && valueFilled;
          }
          return true;
        })
        .map((item) => ({
          key: item.key?.trim() || '',
          value: item.value,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    }
    return value;
  };

  // Helper function to normalize date for comparison
  const normalizeDate = (dateStr: string | null | undefined): string | null => {
    if (!dateStr) return null;
    // Extract date part (YYYY-MM-DD) from ISO string
    if (dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    return dateStr.substring(0, 10);
  };

  // Check if form data has changed from original
  const hasChanges = (cleanedFormData: LanguageModel): boolean => {
    if (isCreating) return true; // Always save when creating

    // Normalize original parameters
    const originalParams = normalizeValue(llm.llm_other_parameters) || [];
    const cleanedParams = normalizeValue(cleanedFormData.llm_other_parameters) || [];

    // Compare all relevant fields
    const fieldsToCompare: (keyof LanguageModel)[] = [
      'llm_name',
      'llm_group_id',
      'llm_version',
      'llm_context_length',
      'llm_max_output_tokens',
      'is_local_llm',
      'is_active_llm',
    ];

    // Compare simple fields
    for (const field of fieldsToCompare) {
      const original = normalizeValue(llm[field]);
      const current = normalizeValue(cleanedFormData[field]);
      if (original !== current) {
        return true;
      }
    }

    // Compare date field
    const originalDate = normalizeDate(llm.llm_release_date);
    const currentDate = normalizeDate(cleanedFormData.llm_release_date);
    if (originalDate !== currentDate) {
      return true;
    }

    // Compare parameters arrays
    if (originalParams.length !== cleanedParams.length) {
      return true;
    }

    for (let i = 0; i < originalParams.length; i++) {
      const orig = originalParams[i];
      const curr = cleanedParams[i];
      if (orig.key !== curr.key || String(orig.value) !== String(curr.value)) {
        return true;
      }
    }

    return false;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const mandatoryErrors = validateMandatoryFields();
    if (mandatoryErrors.size > 0) {
      const numericIssue =
        mandatoryErrors.has('llm_context_length') || mandatoryErrors.has('llm_max_output_tokens');
      const missingBasics = mandatoryErrors.has('llm_name') || mandatoryErrors.has('llm_group_id');
      const msg =
        numericIssue && !missingBasics
          ? t('editForm.invalidPositiveInt')
          : t('editForm.fillRequired');
      toast.error(msg);
      return;
    }

    // Validate parameters before saving
    if (!validateParameters()) {
      return; // Don't save if validation fails
    }

    // Clean up parameters - remove any where both key and value are empty
    const cleanedParams = formData.llm_other_parameters.filter((param) => {
      const keyFilled = param.key && param.key.trim() !== '';
      const valueFilled = param.value && param.value.toString().trim() !== '';
      return keyFilled && valueFilled;
    });

    const cleanedFormData = {
      ...formData,
      llm_other_parameters: cleanedParams,
    };

    // Check if there are any changes before saving
    if (!hasChanges(cleanedFormData)) {
      // No changes, just close the form without showing success message
      onClose();
      return;
    }

    onSave(cleanedFormData);
    onClose();
  };

  const handleChange = (field: keyof LanguageModel, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const normalizeOtherParamKey = (value: string) => value.trim().toLowerCase();

  const levenshteinDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  };

  const canonicalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  const getSimilarKeySuggestions = (rawInput: string): string[] => {
    const input = normalizeOtherParamKey(rawInput);
    if (input.length < 2) return [];

    const inputCanon = canonicalize(input);
    if (inputCanon.length < 2) return [];

    const scored: Array<{ key: string; score: number }> = [];
    for (const k of existingOtherParamKeys) {
      if (!k) continue;
      const existing = k.toLowerCase();
      if (existing === input) continue;
      const existingCanon = canonicalize(existing);
      if (!existingCanon) continue;

      let score = 0;
      if (existing === input) score = 100;
      else if (existing.startsWith(input) || input.startsWith(existing)) score = 85;
      else if (existingCanon === inputCanon) score = 90;
      else if (existingCanon.startsWith(inputCanon) || inputCanon.startsWith(existingCanon))
        score = 75;
      else {
        const d = levenshteinDistance(existingCanon, inputCanon);
        if (d <= 1) score = 78;
        else if (d === 2) score = 68;
        else if (d === 3) score = 60;
      }
      if (score >= 60) scored.push({ key: existing, score });
    }

    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, 'et'));
    return Array.from(new Set(scored.map((s) => s.key))).slice(0, 3);
  };

  const handleKeyInputChange = (paramIndex: number, inputValue: string) => {
    // Update local input state
    const inputKey = `param_${paramIndex}_key`;
    setInputValues((prev) => ({
      ...prev,
      [inputKey]: inputValue,
    }));

    const currentParams = [...formData.llm_other_parameters];
    const trimmedInput = inputValue.trim();
    const normalizedInput = normalizeOtherParamKey(trimmedInput);

    const suggestions = normalizedInput === '' ? [] : getSimilarKeySuggestions(normalizedInput);
    setSimilarKeySuggestions((prev) => ({
      ...prev,
      [paramIndex]: suggestions,
    }));

    // Check for duplicate keys (compare against other parameters in the array)
    const hasDuplicate =
      normalizedInput &&
      currentParams.some(
        (param, index) =>
          index !== paramIndex &&
          normalizeOtherParamKey(String(param.key ?? '')) === normalizedInput
      );

    if (hasDuplicate) {
      // Duplicate key found - add to error set
      setDuplicateKeyErrors((prev) => new Set([...prev, paramIndex]));
    } else {
      // Clear error for this parameter if it was previously in error
      setDuplicateKeyErrors((prev) => {
        const newErrors = new Set(prev);
        newErrors.delete(paramIndex);
        return newErrors;
      });

      // Update the parameter in the array
      currentParams[paramIndex] = {
        ...currentParams[paramIndex],
        key: normalizedInput,
      };

      handleChange('llm_other_parameters', currentParams);
    }

    // Validate after key change
    setTimeout(() => validateParameters(), 0);
  };

  const handleKeyBlur = (paramIndex: number) => {
    // Clear any pending input values for this parameter
    const inputKey = `param_${paramIndex}_key`;
    setInputValues((prev) => {
      const newState = { ...prev };
      delete newState[inputKey];
      return newState;
    });

    // Ensure key is lowercased in form data on blur as well
    const currentParams = [...formData.llm_other_parameters];
    const current = currentParams[paramIndex];
    if (current) {
      const nextKey = normalizeOtherParamKey(String(current.key ?? ''));
      if (nextKey !== String(current.key ?? '')) {
        currentParams[paramIndex] = { ...current, key: nextKey };
        handleChange('llm_other_parameters', currentParams);
      }
    }
  };

  const handleValueChange = (paramIndex: number, value: string) => {
    const currentParams = [...formData.llm_other_parameters];
    currentParams[paramIndex] = {
      ...currentParams[paramIndex],
      value: value,
    };
    handleChange('llm_other_parameters', currentParams);

    // Validate after value change
    setTimeout(() => validateParameters(), 0);
  };

  const addParamRow = () => {
    const currentParams = [...formData.llm_other_parameters];

    // Count empty rows (rows where key is empty AND value is empty)
    const emptyRowsCount = currentParams.filter(
      (param) =>
        (!param.key || param.key.trim() === '') &&
        (!param.value || param.value.toString().trim() === '')
    ).length;

    // If there are 3 or more empty rows, show warning
    if (emptyRowsCount >= 3) {
      toast.error(t('editForm.tooManyEmptyParams'));
      return;
    }

    // Add new row
    const newParam = { key: '', value: '' };
    const updatedParams = [...currentParams, newParam];
    handleChange('llm_other_parameters', updatedParams);
  };

  const removeParamRow = (paramIndex: number) => {
    const currentParams = [...formData.llm_other_parameters];
    currentParams.splice(paramIndex, 1);
    handleChange('llm_other_parameters', currentParams);

    // Clear any errors and input values for the removed parameter
    setDuplicateKeyErrors((prev) => {
      const newErrors = new Set(prev);
      // Shift down all error indices that are higher than the removed index
      const updatedErrors = new Set<number>();
      [...newErrors].forEach((errorIndex) => {
        if (errorIndex < paramIndex) {
          updatedErrors.add(errorIndex);
        } else if (errorIndex > paramIndex) {
          updatedErrors.add(errorIndex - 1);
        }
        // Skip the removed index
      });
      return updatedErrors;
    });

    setValidationErrors((prev) => {
      const newErrors = new Set(prev);
      // Shift down all error indices that are higher than the removed index
      const updatedErrors = new Set<number>();
      [...newErrors].forEach((errorIndex) => {
        if (errorIndex < paramIndex) {
          updatedErrors.add(errorIndex);
        } else if (errorIndex > paramIndex) {
          updatedErrors.add(errorIndex - 1);
        }
        // Skip the removed index
      });
      return updatedErrors;
    });

    setInputValues((prev) => {
      const newValues = { ...prev };
      // Remove input values for the removed parameter and shift indices
      Object.keys(newValues).forEach((key) => {
        if (key.startsWith('param_')) {
          const index = parseInt(key.split('_')[1]);
          if (index === paramIndex) {
            delete newValues[key];
          } else if (index > paramIndex) {
            newValues[`param_${index - 1}_${key.split('_')[2]}`] = newValues[key];
            delete newValues[key];
          }
        }
      });
      return newValues;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b shrink-0">
          <h2 className="text-xl font-semibold">
            {isCreating ? t('editForm.createTitle') : t('editForm.editTitle')}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="llm_name">
                  {t('manager.modelName')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="llm_name"
                  value={formData.llm_name}
                  onChange={(e) => {
                    handleChange('llm_name', e.target.value);
                    if (/^[a-z][a-z0-9._:/-]*$/.test(e.target.value.trim())) {
                      setMandatoryFieldErrors((prev) => {
                        const newErrors = new Set(prev);
                        newErrors.delete('llm_name');
                        return newErrors;
                      });
                    }
                  }}
                  className={
                    mandatoryFieldErrors.has('llm_name')
                      ? 'border-destructive focus-visible:border-destructive'
                      : ''
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="llm_group_id">
                  {t('editForm.modelGroup')} <RequiredMark />
                </FieldLabel>
                <SearchableSelect
                  id="llm_group_id"
                  value={formData.llm_group_id ? String(formData.llm_group_id) : ''}
                  onChange={(next) => {
                    const value = next ? parseInt(next) : undefined;
                    handleChange('llm_group_id', value);
                    if (value) {
                      setMandatoryFieldErrors((prev) => {
                        const newErrors = new Set(prev);
                        newErrors.delete('llm_group_id');
                        return newErrors;
                      });
                    }
                  }}
                  options={modelGroups.map((grupp) => ({
                    value: String(grupp.llm_group_id),
                    label: grupp.llm_group_name,
                  }))}
                  placeholder={t('editForm.selectGroup')}
                  hasError={mandatoryFieldErrors.has('llm_group_id')}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="llm_version">{t('manager.version')}</FieldLabel>
                <Input
                  id="llm_version"
                  value={formData.llm_version ?? ''}
                  onChange={(e) => handleChange('llm_version', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="llm_context_length">
                  {t('manager.contextLength')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="llm_context_length"
                  type="number"
                  min={1}
                  value={formData.llm_context_length ?? ''}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : undefined;
                    handleChange('llm_context_length', value);
                    // Clear error when user enters a value
                    if (value !== undefined && value !== null) {
                      setMandatoryFieldErrors((prev) => {
                        const newErrors = new Set(prev);
                        newErrors.delete('llm_context_length');
                        return newErrors;
                      });
                    }
                  }}
                  className={
                    mandatoryFieldErrors.has('llm_context_length')
                      ? 'border-destructive focus-visible:border-destructive'
                      : ''
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="llm_max_output_tokens">
                  {t('manager.maxOutputTokens')}
                </FieldLabel>
                <Input
                  id="llm_max_output_tokens"
                  type="number"
                  min={1}
                  value={formData.llm_max_output_tokens ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      handleChange('llm_max_output_tokens', undefined);
                    } else {
                      const n = Number(raw);
                      handleChange(
                        'llm_max_output_tokens',
                        Number.isFinite(n) ? Math.trunc(n) : undefined
                      );
                    }
                    setMandatoryFieldErrors((prev) => {
                      const next = new Set(prev);
                      next.delete('llm_max_output_tokens');
                      return next;
                    });
                  }}
                  className={
                    mandatoryFieldErrors.has('llm_max_output_tokens')
                      ? 'border-destructive focus-visible:border-destructive'
                      : ''
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="llm_release_date">{t('manager.releaseDate')}</FieldLabel>
                <Input
                  id="llm_release_date"
                  type="date"
                  value={
                    formData.llm_release_date
                      ? (() => {
                          const date = new Date(formData.llm_release_date);
                          const localTimezoneOffset = date.getTimezoneOffset();
                          const localDate = new Date(
                            date.getTime() - localTimezoneOffset * 60 * 1000
                          );
                          return localDate.toISOString().split('T')[0];
                        })()
                      : ''
                  }
                  onChange={(e) => {
                    const date = new Date(e.target.value);
                    const localTimezoneOffset = date.getTimezoneOffset();
                    const localDate = new Date(date.getTime() - localTimezoneOffset * 60 * 1000);
                    handleChange('llm_release_date', localDate.toISOString());
                  }}
                />
              </Field>

              <Field className="col-span-2">
                <FieldLabel>{t('modelDetail.otherParams')}</FieldLabel>
                <div className="space-y-2">
                  {(() => {
                    const params = formData.llm_other_parameters;

                    // For editing existing llm with no original parameters, don't show any inputs
                    if (!isCreating && !hasOriginalParameters && params.length === 0) {
                      return null;
                    }

                    // Show all params
                    return params.map((param, index) => {
                      // Show input value if user is currently editing, otherwise show form data
                      const inputKey = `param_${index}_key`;
                      const displayKey =
                        sanitizedInputValues[inputKey] !== undefined
                          ? sanitizedInputValues[inputKey]
                          : param.key;

                      return (
                        <div key={`param_${index}`} className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <Input
                              placeholder={t('editForm.paramNamePlaceholder')}
                              value={displayKey}
                              onChange={(e) => handleKeyInputChange(index, e.target.value)}
                              onBlur={() => handleKeyBlur(index)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleKeyBlur(index);
                                }
                              }}
                              className={`text-sm ${sanitizedDuplicateKeyErrors.has(index) || sanitizedValidationErrors.has(index) ? 'border-destructive focus-visible:border-destructive' : ''}`}
                            />
                            {(() => {
                              const sug = similarKeySuggestions[index] || [];
                              const current = normalizeOtherParamKey(
                                String(
                                  sanitizedInputValues[`param_${index}_key`] !== undefined
                                    ? sanitizedInputValues[`param_${index}_key`]
                                    : param.key
                                )
                              );
                              if (!current || sug.length === 0) return null;
                              return (
                                <div className="text-[11px] leading-snug text-muted-foreground">
                                  {t('editForm.similarParamHint', { keys: sug.join(', ') })}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              placeholder={t('editForm.valuePlaceholder')}
                              value={String(param.value || '')}
                              onChange={(e) => handleValueChange(index, e.target.value)}
                              className={`text-sm ${sanitizedValidationErrors.has(index) ? 'border-destructive focus-visible:border-destructive' : ''}`}
                            />
                            {params.length > 1 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => removeParamRow(index)}
                                className="px-2"
                              >
                                ✕
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addParamRow}
                    className="w-full"
                  >
                    {t('editForm.addParameter')}
                  </Button>
                </div>
              </Field>

              <Field>
                <FieldLabel>{t('manager.isLocal')}</FieldLabel>
                <div className="flex gap-6 mt-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="is_local_llm"
                      value="true"
                      checked={formData.is_local_llm === true}
                      onChange={(e) => handleChange('is_local_llm', e.target.value === 'true')}
                      className="text-primary"
                    />
                    {t('common.yes')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="is_local_llm"
                      value="false"
                      checked={formData.is_local_llm === false}
                      onChange={(e) => handleChange('is_local_llm', e.target.value === 'true')}
                      className="text-primary"
                    />
                    {t('common.no')}
                  </label>
                </div>
              </Field>

              <Field>
                <FieldLabel>{t('manager.isActive')}</FieldLabel>
                <div className="flex gap-6 mt-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="is_active_llm"
                      value="true"
                      checked={formData.is_active_llm === true}
                      onChange={(e) => handleChange('is_active_llm', e.target.value === 'true')}
                      className="text-primary"
                    />
                    {t('common.yes')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="is_active_llm"
                      value="false"
                      checked={formData.is_active_llm === false}
                      onChange={(e) => handleChange('is_active_llm', e.target.value === 'true')}
                      className="text-primary"
                    />
                    {t('common.no')}
                  </label>
                </div>
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t shrink-0">
            <div className="flex flex-wrap gap-2">
              {!isCreating && onDelete ? (
                <span className="group relative inline-flex">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={onDelete}
                    disabled={Boolean(llm.is_active_llm) || isDeleting}
                  >
                    {t('modelDetail.deleteModel')}
                  </Button>
                  {llm.is_active_llm ? (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-75"
                    >
                      {t('modelDetail.cannotDeleteActive')}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit">
                {isCreating ? t('editForm.createSubmit') : t('editForm.saveChanges')}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
