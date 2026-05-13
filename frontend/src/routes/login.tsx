import { LoginForm } from '@/components/login-form';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import toast from '@/lib/toast';
import { useTranslation } from '@/hooks/useTranslation';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';

    if (isAuthenticated) {
      throw redirect({
        to: '/' as any,
      });
    }
  },
  component: Login,
});

export default function Login() {
  const { t } = useTranslation();

  useEffect(() => {
    const flag = sessionStorage.getItem('authDeactivated');
    if (flag === '1') {
      sessionStorage.removeItem('authDeactivated');
      toast.error(t('auth.accountDeactivated'), { duration: 12000 });
    }
  }, [t]);

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
