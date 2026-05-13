import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import toast from '@/lib/toast';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useNavigate } from '@tanstack/react-router';
import { getClientAcceptLanguage } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

export function LoginForm({ className, ...props }: React.ComponentProps<'div'>) {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const { login } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogin = async (event: any) => {
    event.preventDefault();

    if (!email || email.trim() === '') {
      toast.error(t('login.emailRequired'));
      return;
    }

    if (!email.includes('@')) {
      toast.error(t('login.emailInvalid'));
      return;
    }

    if (!password || password.trim() === '') {
      toast.error(t('login.passwordRequired'));
      return;
    }

    setIsLoading(true);

    try {
      const body = { email, password };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': getClientAcceptLanguage(),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        sessionStorage.setItem('userId', data.success.toString());
        login(email);
        toast.success(t('login.success'));
        navigate({ to: '/' as any });
      } else {
        toast.error(formatApiErrorMessage(t, data, 'login.failed'));
      }
    } catch (err) {
      toast.error(t('login.connectionError'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const closeForgotModal = () => {
    setForgotOpen(false);
    setForgotEmail('');
  };

  const handleForgotPassword = async (event: any) => {
    event.preventDefault();
    const e = forgotEmail.trim();

    if (!e) {
      toast.error(t('login.emailRequired'));
      return;
    }
    if (!e.includes('@')) {
      toast.error(t('login.emailInvalid'));
      return;
    }

    setIsForgotLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': getClientAcceptLanguage(),
        },
        body: JSON.stringify({ email: e }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        toast.success(t('login.resetLinkSent'));
        closeForgotModal();
        navigate({ to: '/login' as any, replace: true });
      } else {
        toast.error(formatApiErrorMessage(t, data, 'login.resetLinkFailed'));
      }
    } catch (err) {
      toast.error(t('login.connectionError'));
      console.error(err);
    } finally {
      setIsForgotLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">{t('login.welcome')}</CardTitle>
          <CardDescription className="text-[13px]">{t('login.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">
                  {t('login.email')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="email"
                  type="text"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">
                  {t('login.password')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? t('login.submitting') : t('login.submit')}
                </Button>
              </Field>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  className="text-[13px] text-primary underline underline-offset-4 hover:opacity-90"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotOpen(true);
                  }}
                >
                  {t('login.forgotPassword')}
                </button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {forgotOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            aria-label={t('common.cancel')}
            onClick={closeForgotModal}
            disabled={isForgotLoading}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-title"
            className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
          >
            <h2 id="forgot-title" className="text-[15px] font-semibold mb-1">
              {t('login.forgotPasswordTitle')}
            </h2>
            <p className="text-[13px] text-muted-foreground mb-4">
              {t('login.forgotPasswordHint')}
            </p>

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <FieldLabel htmlFor="forgot-email">
                  {t('login.email')} <RequiredMark />
                </FieldLabel>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={forgotEmail}
                  onChange={(event) => setForgotEmail(event.target.value)}
                  disabled={isForgotLoading}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeForgotModal}
                  disabled={isForgotLoading}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={isForgotLoading}>
                  {isForgotLoading ? t('login.sendingResetLink') : t('login.sendResetLink')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
