import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { getClientAcceptLanguage } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

type ResetSearch = { token?: string };

export const Route = createFileRoute('/reset-password' as any)({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

type VerifyState =
  | { status: 'checking' }
  | { status: 'valid' }
  | { status: 'invalid'; errorCode: string };

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [verify, setVerify] = useState<VerifyState>({ status: 'checking' });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        if (!cancelled) setVerify({ status: 'invalid', errorCode: 'RESET_TOKEN_INVALID' });
        return;
      }
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/reset-password/verify?token=${encodeURIComponent(token)}`,
          {
            method: 'GET',
            headers: {
              'Accept-Language': getClientAcceptLanguage(),
            },
          }
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.valid) {
          setVerify({ status: 'valid' });
        } else {
          const code = typeof data?.code === 'string' ? data.code : 'RESET_TOKEN_INVALID';
          setVerify({ status: 'invalid', errorCode: code });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setVerify({ status: 'invalid', errorCode: 'RESET_TOKEN_INVALID' });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (verify.status !== 'valid' || !token) return;

    const p = newPassword;
    const c = confirmPassword;

    if (!p) {
      toast.error(t('login.passwordRequired'));
      return;
    }
    if (p.length < 15) {
      toast.error(t('resetPassword.passwordTooShort'));
      return;
    }
    if (p !== c) {
      toast.error(t('resetPassword.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': getClientAcceptLanguage(),
        },
        body: JSON.stringify({ token, new_password: p }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success) {
        toast.success(t('resetPassword.success'));
        navigate({ to: '/login' as any });
      } else {
        const code = typeof data?.code === 'string' ? data.code : null;
        if (
          code === 'RESET_TOKEN_INVALID' ||
          code === 'RESET_TOKEN_EXPIRED' ||
          code === 'RESET_TOKEN_USED'
        ) {
          setVerify({ status: 'invalid', errorCode: code });
        }
        toast.error(formatApiErrorMessage(t, data, 'resetPassword.failed'));
      }
    } catch (err) {
      toast.error(t('login.connectionError'));
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">{t('resetPassword.title')}</CardTitle>
            <CardDescription className="text-[13px]">
              {verify.status === 'valid'
                ? t('resetPassword.hint')
                : verify.status === 'checking'
                  ? t('resetPassword.checking')
                  : t(`apiErrors.${verify.errorCode}`)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {verify.status === 'valid' ? (
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="reset-new-password">
                      {t('resetPassword.newPassword')} <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="reset-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reset-confirm-password">
                      {t('resetPassword.confirmPassword')} <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="reset-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </Field>
                  <Field>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            ) : (
              <div className="flex justify-end pt-2">
                <Button type="button" onClick={() => navigate({ to: '/login' as any })}>
                  {t('resetPassword.backToLogin')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
