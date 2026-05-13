import { createFileRoute, redirect } from '@tanstack/react-router';

import { PageHeader } from '@/components/page-header';
import { useTranslation } from '@/hooks/useTranslation';
import { apiFetchJson } from '@/lib/api';
import { DbmsClassifiersSection } from '@/components/DbmsClassifiersSection';
import {
  LlmClassifiersSection,
  ResultTypeClassifiersSection,
  UserClassifiersSection,
} from '@/components/UserClassifiersSection';

export const Route = createFileRoute('/admin/classifiers' as any)({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) throw redirect({ to: '/login' as any });

    let roles: { user_role_code: string; user_role_name: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      throw redirect({ to: '/login' as any });
    }
    if (!roles.some((r) => r.user_role_code === 'ADM')) throw redirect({ to: '/' as any });
  },
  component: AdminClassifiersPage,
});

export default function AdminClassifiersPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('adminClassifiers.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">{t('adminClassifiers.intro')}</p>
          </div>

          <div className="space-y-8">
            <DbmsClassifiersSection rootId="admin-classifiers-dbms-section" />
            <UserClassifiersSection rootId="admin-classifiers-user-section" />
            <LlmClassifiersSection rootId="admin-classifiers-llm-section" />
            <ResultTypeClassifiersSection rootId="admin-classifiers-result-section" />
          </div>
        </div>
      </div>
    </div>
  );
}
