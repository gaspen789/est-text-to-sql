import { useState } from 'react';
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from '@/lib/toast';
import { Edit, ExternalLink, Plus, ToggleLeft, ToggleRight, X } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CardSkeleton } from '@/components/table-skeleton';
import { DbmsClassifiersSection } from '@/components/DbmsClassifiersSection';
import { useModal } from '@/contexts/modal-context';
import { apiDelete, apiFetchJson, apiPost, apiPut, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

export const Route = createFileRoute('/databases' as any)({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
      throw redirect({ to: '/login' as any });
    }

    // Enforce admin-only access even if someone types the URL.
    let roles: { user_role_code: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      throw redirect({ to: '/login' as any });
    }
    const isAdmin = roles.some((r) => r.user_role_code === 'ADM');
    if (!isAdmin) throw redirect({ to: '/' as any });
  },
  component: DatabasesAdminPage,
});

type DatabaseRow = {
  database_id: number;
  database_name: string;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active_database: boolean;
  host_name: string | null;
  port: number | null;
  username: string | null;
  dbms_version_id: number | null;
  dbms_code: string | null;
  dbms_name: string | null;
  dbms_version: string | null;
  dbms_version_description: string | null;
  is_active_credential: boolean | null;
  is_admin_credential: boolean | null;
};

type DbmsVersionOption = {
  dbms_version_id: number;
  dbms_code: string;
  dbms_name: string;
  version: string;
};

type ModalState =
  | { open: false }
  | {
      open: true;
      mode: 'add' | 'edit';
      database_id?: number;
      database_name: string;
      description_for_llm: string;
      comment_for_user: string;
      dbms_version_id: number | null;
      host_name: string;
      port: number | null;
      username: string;
      encrypted_password: string; // empty => keep existing on edit
      is_active: boolean;
      is_admin: boolean;
    };

function DatabasesAdminPage() {
  const { t } = useTranslation();
  const { confirm } = useModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isDatabaseDetailRoute = Boolean(matchRoute({ to: '/databases/$databaseId' }));
  const [openTiles, setOpenTiles] = useState<Set<number>>(new Set());

  const { data: databases = [], isLoading } = useQuery({
    queryKey: queryKeys.adminDatabases,
    queryFn: () => apiFetchJson<DatabaseRow[]>('/api/admin/databases'),
  });

  const { data: activeDbmsVersions = [], isLoading: isLoadingDbmsVersions } = useQuery({
    queryKey: queryKeys.adminDbmsVersionsActive,
    queryFn: () => apiFetchJson<DbmsVersionOption[]>('/api/admin/classifiers/dbms-versions/active'),
  });

  const [modal, setModal] = useState<ModalState>({ open: false });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const openAdd = () => {
    setModal({
      open: true,
      mode: 'add',
      database_name: '',
      description_for_llm: '',
      comment_for_user: '',
      dbms_version_id: activeDbmsVersions[0]?.dbms_version_id ?? null,
      host_name: '',
      port: null,
      username: '',
      encrypted_password: '',
      is_active: true,
      is_admin: false,
    });
  };

  const openEdit = (row: DatabaseRow) => {
    setModal({
      open: true,
      mode: 'edit',
      database_id: row.database_id,
      database_name: row.database_name ?? '',
      description_for_llm: row.description_for_llm ?? '',
      comment_for_user: row.comment_for_user ?? '',
      dbms_version_id: row.dbms_version_id ?? null,
      host_name: row.host_name ?? '',
      port: row.port ?? null,
      username: row.username ?? '',
      encrypted_password: '',
      is_active: row.is_active_database,
      is_admin: Boolean(row.is_admin_credential),
    });
  };

  const closeModal = () => {
    setModal({ open: false });
    setDeleteConfirmOpen(false);
    setDeleteConfirmText('');
  };

  const createMutation = useMutation({
    mutationFn: async (
      payload: Omit<Extract<ModalState, { open: true }>, 'open' | 'mode' | 'database_id'>
    ) => {
      const res = await apiPost('/api/admin/databases', payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.createFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
      toast.success(t('databases.createSuccess'));
      closeModal();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      database_id: number;
      database_name: string;
      description_for_llm: string | null;
      comment_for_user: string | null;
      dbms_version_id: number;
      host_name: string;
      port: number;
      username: string;
      encrypted_password?: string;
      is_active: boolean;
      is_admin: boolean;
      confirm_replace_admin?: boolean;
    }) => {
      const { database_id, confirm_replace_admin, ...body } = payload;
      const res = await apiPut(`/api/admin/databases/${database_id}`, {
        ...body,
        ...(confirm_replace_admin ? { confirm_replace_admin: true } : {}),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message = formatApiErrorMessage(t, errorData, 'databases.updateFailed');
        const err = new Error(message) as Error & { status?: number; apiCode?: string };
        err.status = res.status;
        err.apiCode = typeof errorData?.code === 'string' ? errorData.code : undefined;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
      toast.success(t('databases.updateSuccess'));
      closeModal();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (payload: { database_id: number; nextActive: boolean }) => {
      const endpoint = payload.nextActive
        ? `/api/admin/databases/${payload.database_id}/activate`
        : `/api/admin/databases/${payload.database_id}/deactivate`;
      const res = await apiPost(endpoint);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (payload: { database_id: number }) => {
      const res = await apiDelete(`/api/admin/databases/${payload.database_id}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
      toast.success(t('databases.deleteSuccess'));
      closeModal();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmitModal = async () => {
    if (!modal.open) return;
    const m = modal;

    const database_name = m.database_name.trim();
    const description_for_llm = m.description_for_llm.trim() || null;
    const comment_for_user = m.comment_for_user.trim() || null;
    const host_name = m.host_name.trim();
    const username = m.username.trim();

    if (
      !database_name ||
      !m.dbms_version_id ||
      !host_name ||
      m.port === null ||
      !username ||
      (!Number.isInteger(m.port) && m.port !== null)
    ) {
      toast.error(t('databases.fillRequired'));
      return;
    }

    if (m.mode === 'add' && !m.encrypted_password.trim()) {
      toast.error(t('databases.passwordRequired'));
      return;
    }

    const port = m.port;
    if (!port || !Number.isInteger(port)) {
      toast.error(t('databases.fillRequired'));
      return;
    }

    const baseBody = {
      database_name,
      description_for_llm,
      comment_for_user,
      dbms_version_id: m.dbms_version_id,
      host_name,
      port,
      username,
      encrypted_password:
        m.mode === 'add' ? m.encrypted_password.trim() : m.encrypted_password.trim() || undefined,
      is_active: m.is_active,
      is_admin: m.is_admin,
    };

    if (m.mode === 'add') {
      createMutation.mutate(baseBody as any);
      return;
    }

    if (!m.database_id) {
      toast.error(t('databases.fillRequired'));
      return;
    }

    try {
      await updateMutation.mutateAsync({
        database_id: m.database_id,
        ...baseBody,
        confirm_replace_admin: false,
      });
    } catch (e: unknown) {
      const err = e as Error & { status?: number; apiCode?: string };
      if (
        err.status === 409 &&
        err.apiCode === 'ADMIN_CREDENTIAL_REPLACE_CONFIRMATION_REQUIRED' &&
        m.is_admin
      ) {
        const ok = await confirm({
          title: t('databases.adminCredentialReplaceTitle'),
          message: t('databases.adminCredentialReplaceMessage'),
          confirmText: t('databases.adminCredentialReplaceConfirm'),
          cancelText: t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
        try {
          await updateMutation.mutateAsync({
            database_id: m.database_id,
            ...baseBody,
            confirm_replace_admin: true,
          });
        } catch (e2: unknown) {
          toast.error(e2 instanceof Error ? e2.message : t('databases.updateFailed'));
        }
        return;
      }
      toast.error(err.message);
    }
  };

  const isSaving =
    createMutation.isPending || updateMutation.isPending || toggleActiveMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  const tilesOpen = databases.length > 0 && openTiles.size === databases.length;

  const openAllTiles = () => {
    setOpenTiles(new Set(databases.map((d) => d.database_id)));
  };

  const closeAllTiles = () => {
    setOpenTiles(new Set());
  };

  if (isDatabaseDetailRoute) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('databases.title')} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-8">
          <div id="databases-management-section" className="scroll-mt-24 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">{t('databases.manageConnectionsTitle')}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('databases.manageConnectionsIntro')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => (tilesOpen ? closeAllTiles() : openAllTiles())}
                  disabled={isLoading || databases.length === 0}
                >
                  {tilesOpen ? t('manager.closeDetails') : t('manager.openDetails')}
                </Button>
                <Button onClick={openAdd} disabled={isLoadingDbmsVersions || isSaving}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t('databases.addConnection')}
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 @min-[516px]:grid-cols-2 @min-[1000px]:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} lines={5} />
                ))}
              </div>
            ) : databases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('databases.noConnectedDatabases')}</p>
            ) : (
              <div className="grid grid-cols-1 @min-[516px]:grid-cols-2 @min-[1000px]:grid-cols-3 gap-6">
                {databases.map((row) => {
                  const id = row.database_id;
                  const expanded = openTiles.has(id);
                  return (
                    <div
                      key={id}
                      className="@container bg-card border border-border rounded-lg p-6 flex flex-col gap-4"
                    >
                      <div className="flex w-full min-w-0 flex-col-reverse flex-wrap gap-3 @[280px]:flex-row @[280px]:items-start">
                        <div className="min-w-0 w-full @[280px]:flex-1">
                          <label className="text-sm font-medium text-muted-foreground">
                            {t('databases.databaseName')}
                          </label>
                          <p className="mt-1 text-base font-semibold break-words">
                            {row.database_name || '—'}
                          </p>
                        </div>
                        <div className="flex w-full shrink-0 flex-wrap justify-start gap-1 -ml-2 @[280px]:w-auto @[280px]:justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-green-600"
                            title={t('databases.openDetailPage')}
                            onClick={() =>
                              navigate({
                                to: '/databases/$databaseId',
                                params: { databaseId: String(id) },
                              })
                            }
                            disabled={isSaving}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-green-600"
                            onClick={() => openEdit(row)}
                            disabled={isSaving}
                            title={t('databases.editConnection')}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={isSaving}
                            className={
                              row.is_active_database
                                ? 'hover:text-destructive'
                                : 'hover:text-green-600'
                            }
                            onClick={() =>
                              void toggleActiveMutation.mutateAsync({
                                database_id: id,
                                nextActive: !row.is_active_database,
                              })
                            }
                            title={
                              row.is_active_database
                                ? t('databases.deactivate')
                                : t('databases.activate')
                            }
                            data-testid="database-toggle-btn"
                          >
                            {row.is_active_database ? (
                              <ToggleRight className="h-4 w-4" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="min-w-0 flex-grow space-y-4">
                        {expanded ? (
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.dbmsVersion')}
                              </label>
                              <p className="mt-1 text-base">
                                {row.dbms_name ? (
                                  <>
                                    {row.dbms_name}
                                    {row.dbms_version ? (
                                      <span className="font-mono"> {row.dbms_version}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.host')}
                              </label>
                              <p className="mt-1 text-base break-all">{row.host_name ?? '—'}</p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.port')}
                              </label>
                              <p className="mt-1 text-base">{row.port ?? '—'}</p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.username')}
                              </label>
                              <p className="mt-1 text-base break-all">{row.username ?? '—'}</p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.active')}
                              </label>
                              <p className="mt-1 text-base">
                                {row.is_active_database ? t('common.yes') : t('common.no')}
                              </p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.descriptionForLlm')}
                              </label>
                              <p className="mt-1 text-sm whitespace-pre-wrap">
                                {(row.description_for_llm ?? '').trim() || '—'}
                              </p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.commentForUser')}
                              </label>
                              <p className="mt-1 text-sm whitespace-pre-wrap">
                                {(row.comment_for_user ?? '').trim() || '—'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.dbmsVersion')}
                              </label>
                              <p className="mt-1 text-base">
                                {row.dbms_name ? (
                                  <>
                                    {row.dbms_name}
                                    {row.dbms_version ? (
                                      <span className="font-mono"> {row.dbms_version}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.active')}
                              </label>
                              <p className="mt-1 text-base">
                                {row.is_active_database ? t('common.yes') : t('common.no')}
                              </p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-muted-foreground">
                                {t('databases.host')}
                              </label>
                              <p className="mt-1 text-base break-all">{row.host_name ?? '—'}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div id="databases-classifiers-section" className="scroll-mt-24">
            <DbmsClassifiersSection showAdminClassifiersLink />
          </div>
        </div>

        {modal.open && (
          <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t('common.cancel')}
              onClick={closeModal}
              disabled={isSaving}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-lg font-semibold">
                  {modal.mode === 'add'
                    ? t('databases.addConnection')
                    : t('databases.editConnection')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeModal}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>
                    {t('databases.databaseName')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={modal.database_name}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, database_name: e.target.value } : m))
                    }
                    disabled={isSaving}
                    data-testid="db-form-name"
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('databases.dbmsVersion')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={modal.dbms_version_id != null ? String(modal.dbms_version_id) : ''}
                    onChange={(next) =>
                      setModal((m) =>
                        m.open ? { ...m, dbms_version_id: next ? Number(next) : null } : m
                      )
                    }
                    options={activeDbmsVersions.map((v) => ({
                      value: String(v.dbms_version_id),
                      label: `${v.dbms_name} ${v.version}`,
                    }))}
                    placeholder={
                      activeDbmsVersions.length === 0
                        ? t('databases.noActiveDbmsVersions')
                        : t('common.select')
                    }
                    disabled={isSaving || isLoadingDbmsVersions || activeDbmsVersions.length === 0}
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('databases.host')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={modal.host_name}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, host_name: e.target.value } : m))
                    }
                    disabled={isSaving}
                    data-testid="db-form-host"
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('databases.port')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    type="number"
                    value={modal.port ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = raw === '' ? null : Number(raw);
                      setModal((m) => (m.open ? { ...m, port: n } : m));
                    }}
                    disabled={isSaving}
                    data-testid="db-form-port"
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('databases.username')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={modal.username}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, username: e.target.value } : m))
                    }
                    disabled={isSaving}
                    data-testid="db-form-username"
                  />
                </Field>

                <Field>
                  <FieldLabel>
                    {t('databases.password')}
                    {modal.mode === 'add' ? (
                      <>
                        {' '}
                        <RequiredMark />
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs ml-2">
                        {t('databases.passwordOptional')}
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    type="password"
                    value={modal.encrypted_password}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, encrypted_password: e.target.value } : m))
                    }
                    disabled={isSaving}
                    placeholder={
                      modal.mode === 'edit' ? t('databases.passwordLeaveEmpty') : undefined
                    }
                    data-testid="db-form-password"
                  />
                </Field>

                <div className="md:col-span-2 flex items-center gap-2">
                  <Checkbox
                    id="db-active"
                    checked={modal.is_active}
                    onCheckedChange={(v) =>
                      setModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="db-active" className="text-sm font-normal cursor-pointer">
                    {t('databases.active')}
                  </Label>
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <Checkbox
                    id="db-admin"
                    checked={modal.is_admin}
                    onCheckedChange={(v) =>
                      setModal((m) => (m.open ? { ...m, is_admin: v === true } : m))
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="db-admin" className="text-sm font-normal cursor-pointer">
                    {t('databases.isAdmin')}
                  </Label>
                </div>

                <Field className="md:col-span-2">
                  <FieldLabel>{t('databases.descriptionForLlm')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={modal.description_for_llm}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, description_for_llm: e.target.value } : m))
                    }
                    disabled={isSaving}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>{t('databases.commentForUser')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={modal.comment_for_user}
                    onChange={(e) =>
                      setModal((m) => (m.open ? { ...m, comment_for_user: e.target.value } : m))
                    }
                    disabled={isSaving}
                  />
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="flex flex-wrap gap-2">
                  {modal.mode === 'edit' ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        setDeleteConfirmText('');
                        setDeleteConfirmOpen(true);
                      }}
                      disabled={isSaving || isDeleting}
                    >
                      {t('databases.deleteDatabase')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeModal} disabled={isSaving}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" onClick={handleSubmitModal} disabled={isSaving}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {modal.open && modal.mode === 'edit' && deleteConfirmOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="databases-delete-title"
              className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="databases-delete-title" className="text-[15px] font-semibold mb-1">
                {t('databases.deleteTitle')}
              </h2>
              <p className="text-[13px] text-muted-foreground mb-4">
                {t('databases.deleteWarning')}
              </p>

              <div className="space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('databases.databaseName')}: </span>
                  <span className="font-medium break-all">{modal.database_name}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('databases.deleteTypeNameHint')}
                </div>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={modal.database_name}
                  disabled={isDeleting}
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(false)}
                  disabled={isDeleting}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    isDeleting ||
                    deleteConfirmText.trim() !== String(modal.database_name ?? '').trim() ||
                    !modal.database_id
                  }
                  onClick={() =>
                    modal.database_id && deleteMutation.mutate({ database_id: modal.database_id })
                  }
                >
                  {t('databases.deleteConfirm')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
