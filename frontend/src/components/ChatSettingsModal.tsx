import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import toast from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Separator } from '@/components/ui/separator';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { apiFetchJson, apiPost, apiPut, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

type GlobalInstructionResponse = {
  llm_custom_global_instruction: string | null;
  preferred_llm_language: string;
};

type LanguageRow = { language_code: string; language_name: string };

type ChatSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function ChatSettingsModal({ open, onClose }: ChatSettingsModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data, isFetching } = useQuery({
    queryKey: queryKeys.userGlobalInstruction,
    queryFn: () => apiFetchJson<GlobalInstructionResponse>('/api/user/global-instruction'),
    enabled: open,
    staleTime: 0,
  });

  const { data: availableLanguages = [] } = useQuery({
    queryKey: queryKeys.languages,
    queryFn: () => apiFetchJson<LanguageRow[]>('/api/keeled'),
    enabled: open,
    staleTime: 60_000,
  });

  const [instructionDraft, setInstructionDraft] = useState('');
  const [savingInstruction, setSavingInstruction] = useState(false);

  const [languageDraft, setLanguageDraft] = useState('');
  const [savingLanguage, setSavingLanguage] = useState(false);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [reportBody, setReportBody] = useState('');
  const [sendingReport, setSendingReport] = useState(false);

  useEffect(() => {
    if (!open || data === undefined) return;
    setInstructionDraft(data.llm_custom_global_instruction ?? '');
    setLanguageDraft((data.preferred_llm_language ?? '').trim());
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (passwordModalOpen) {
        setPasswordModalOpen(false);
        return;
      }
      if (feedbackModalOpen) {
        setFeedbackModalOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, passwordModalOpen, feedbackModalOpen]);

  useEffect(() => {
    if (!open) {
      setPasswordModalOpen(false);
      setFeedbackModalOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setReportBody('');
    }
  }, [open]);

  useEffect(() => {
    if (!passwordModalOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [passwordModalOpen]);

  useEffect(() => {
    if (!feedbackModalOpen) {
      setReportBody('');
    }
  }, [feedbackModalOpen]);

  const handleSavePreferredLanguage = async () => {
    const trimmed = languageDraft.trim();
    if (!trimmed) {
      toast.error(t('users.preferredLanguageRequired'));
      return;
    }
    setSavingLanguage(true);
    try {
      const res = await apiPut('/api/user/preferred-llm-language', {
        preferred_llm_language: trimmed,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiErrorMessage(t, resData, 'settings.preferredLanguageSaveFailed'));
      }
      toast.success(t('settings.preferredLanguageSaved'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.userGlobalInstruction });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.preferredLanguageSaveFailed'));
    } finally {
      setSavingLanguage(false);
    }
  };

  const handleSaveInstruction = async () => {
    setSavingInstruction(true);
    try {
      const body =
        instructionDraft.trim() === ''
          ? { llm_custom_global_instruction: null }
          : { llm_custom_global_instruction: instructionDraft.trim() };
      const res = await apiPut('/api/user/global-instruction', body);
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiErrorMessage(t, resData, 'settings.instructionSaveFailed'));
      }
      toast.success(t('settings.instructionSaved'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.userGlobalInstruction });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.instructionSaveFailed'));
    } finally {
      setSavingInstruction(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.passwordMismatch'));
      return;
    }
    if (newPassword.length < 15) {
      toast.error(t('settings.passwordTooShort'));
      return;
    }
    setChangingPassword(true);
    try {
      const res = await apiPost('/api/user/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiErrorMessage(t, resData, 'settings.passwordChangeFailed'));
      }
      toast.success(t('settings.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.passwordChangeFailed'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSendReport = async () => {
    const trimmed = reportBody.trim();
    if (trimmed.length < 3) {
      toast.error(t('settings.reportTooShort'));
      return;
    }
    setSendingReport(true);
    try {
      const res = await apiPost('/api/user/report-to-admins', { message_body: trimmed });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiErrorMessage(t, resData, 'settings.reportFailed'));
      }
      toast.success(t('settings.reportSent'));
      setReportBody('');
      setFeedbackModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.reportFailed'));
    } finally {
      setSendingReport(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label={t('common.closeSettings')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-settings-title"
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg text-card-foreground"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div>
            <h2 id="chat-settings-title" className="text-[15px] font-semibold leading-tight">
              {t('settings.title')}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <section className="space-y-2.5">
            <FieldLabel>{t('settings.preferredLlmLanguage')}</FieldLabel>
            <FieldDescription>{t('settings.preferredLlmLanguageDescription')}</FieldDescription>
            <SearchableSelect
              value={languageDraft}
              onChange={setLanguageDraft}
              options={availableLanguages.map((l) => ({
                value: l.language_code,
                label: `${l.language_name} (${l.language_code})`,
              }))}
              disabled={savingLanguage || (isFetching && data === undefined)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={
                savingLanguage ||
                (isFetching && data === undefined) ||
                languageDraft.trim() === (data?.preferred_llm_language ?? '').trim()
              }
              onClick={() => void handleSavePreferredLanguage()}
            >
              {t('settings.savePreferredLanguage')}
            </Button>
          </section>

          <Separator />

          <section className="space-y-2.5">
            <FieldLabel>{t('settings.customInstruction')}</FieldLabel>
            <FieldDescription>{t('settings.instructionDescription')}</FieldDescription>
            <textarea
              value={instructionDraft}
              onChange={(e) => setInstructionDraft(e.target.value)}
              disabled={isFetching && data === undefined}
              rows={4}
              className="w-full min-h-[80px] resize-none rounded-md border border-input bg-card px-3 py-2 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
              placeholder={t('settings.instructionPlaceholder')}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={savingInstruction || (isFetching && data === undefined)}
              onClick={() => void handleSaveInstruction()}
            >
              {t('settings.saveInstruction')}
            </Button>
          </section>

          <Separator />

          <section className="space-y-2.5">
            <FieldLabel>{t('sidebar.myAccessibleData')}</FieldLabel>
            <FieldDescription>{t('settings.accessibleDataDescription')}</FieldDescription>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => {
                onClose();
                navigate({ to: '/my-data' });
              }}
            >
              {t('settings.openAccessibleData')}
            </Button>
          </section>

          <Separator />

          <Button
            type="button"
            variant="outline"
            className="w-full justify-center"
            onClick={() => setPasswordModalOpen(true)}
          >
            {t('settings.openChangePassword')}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full justify-center"
            onClick={() => setFeedbackModalOpen(true)}
          >
            {t('settings.openSendFeedback')}
          </Button>
        </div>
      </div>

      {passwordModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            aria-label={t('common.cancel')}
            onClick={() => setPasswordModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-settings-password-title"
            className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg text-card-foreground"
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
              <h2 id="chat-settings-password-title" className="text-[15px] font-semibold">
                {t('settings.changePassword')}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setPasswordModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-5 py-5 space-y-3">
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">
                  {t('settings.currentPassword')} <RequiredMark />
                </FieldLabel>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">
                  {t('settings.newPassword')} <RequiredMark />
                </FieldLabel>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">
                  {t('settings.confirmPassword')} <RequiredMark />
                </FieldLabel>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              <Button
                type="button"
                className="w-full justify-center"
                disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                onClick={() => void handleChangePassword()}
              >
                {t('settings.savePassword')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {feedbackModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            aria-label={t('common.cancel')}
            onClick={() => setFeedbackModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-settings-feedback-title"
            className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg text-card-foreground"
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
              <h2 id="chat-settings-feedback-title" className="text-[15px] font-semibold">
                {t('settings.reportToAdmins')}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setFeedbackModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-5 py-5 space-y-3">
              <Field>
                <FieldLabel className="text-sm">
                  {t('settings.reportMessage')} <RequiredMark />
                </FieldLabel>
                <FieldDescription>{t('settings.reportDescription')}</FieldDescription>
              </Field>
              <textarea
                value={reportBody}
                onChange={(e) => setReportBody(e.target.value)}
                rows={4}
                className="w-full min-h-[80px] resize-none rounded-md border border-input bg-card px-3 py-2 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                placeholder={t('settings.reportPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center"
                disabled={sendingReport || reportBody.trim().length < 3}
                onClick={() => void handleSendReport()}
              >
                {t('settings.sendReport')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
