import { useState, type ReactNode } from 'react';
import { createFileRoute, Link, redirect, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from '@/lib/toast';
import { ArrowLeft, Edit, Plus, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useModal } from '@/contexts/modal-context';
import { apiDelete, apiFetchJson, apiPost, apiPut, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

type IsoTimestamp = string | null | undefined;

function formatDetailTimestamp(value: IsoTimestamp): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

type ConnectionCredentialRow = {
  database_connection_credential_id: number;
  host_name: string | null;
  port: number | null;
  username: string | null;
  dbms_version_id: number | null;
  is_active: boolean;
  is_admin: boolean;
  created_at_time?: IsoTimestamp;
  modified_at_time?: IsoTimestamp;
  dbms_code: string | null;
  dbms_name: string | null;
  dbms_version: string | null;
  dbms_version_description: string | null;
};

type DatabaseDetailPayload = {
  database_id: number;
  database_name: string;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active_database: boolean;
  resource_created_at_time?: IsoTimestamp;
  resource_modified_at_time?: IsoTimestamp;
  credentials?: ConnectionCredentialRow[];
};

type ColumnNode = {
  column_id: number;
  name: string;
  data_type?: string | null;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active: boolean;
};

type TableNode = {
  table_id: number;
  name: string;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active: boolean;
  columns: ColumnNode[];
};

type ViewNode = {
  view_id: number;
  name: string;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active: boolean;
  columns: ColumnNode[];
};

type SchemaNode = {
  schema_id: number;
  name: string;
  description_for_llm: string | null;
  comment_for_user: string | null;
  is_active: boolean;
  tables: TableNode[];
  views: ViewNode[];
  materialized_views?: ViewNode[];
};

type ResourcesPayload = {
  database_id: number;
  schemas: SchemaNode[];
};

function DetailTimestampSection({
  created,
  modified,
}: {
  created: IsoTimestamp;
  modified: IsoTimestamp;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 pt-3 border-t border-border/80">
      <div className="flex flex-col gap-1 text-xs">
        <div>
          <span className="text-muted-foreground">{t('manager.createdAt')}: </span>
          {formatDetailTimestamp(created)}
        </div>
        <div>
          <span className="text-muted-foreground">{t('manager.lastModifiedAt')}: </span>
          {formatDetailTimestamp(modified)}
        </div>
      </div>
    </div>
  );
}

const detailInfoTileFieldGridClass = 'grid gap-2 text-sm';

function DatabaseDetailInfoTile({
  title,
  actions,
  children,
  created,
  modified,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  created: IsoTimestamp;
  modified: IsoTimestamp;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div
        className={`flex flex-wrap items-start gap-2 ${title ? 'justify-between' : 'justify-end'}`}
      >
        {title ? <h2 className="text-sm font-semibold min-w-0 flex-1">{title}</h2> : null}
        {actions ? <div className="flex shrink-0 flex-wrap gap-1">{actions}</div> : null}
      </div>
      {children}
      <DetailTimestampSection created={created} modified={modified} />
    </div>
  );
}

type FormModalState =
  | { open: false }
  | {
      open: true;
      kind: 'schema' | 'table' | 'column';
      mode: 'add' | 'edit';
      allowKindChange?: boolean;
      schemaId?: number;
      tableId?: number;
      resourceId?: number;
      name: string;
      description_for_llm: string;
      comment_for_user: string;
      is_active: boolean;
    };

type DbmsVersionOption = {
  dbms_version_id: number;
  dbms_code: string;
  dbms_name: string;
  version: string;
};

type ResourceEditModalState =
  | { open: false }
  | {
      open: true;
      database_name: string;
      description_for_llm: string;
      comment_for_user: string;
      is_active: boolean;
    };

type CredentialEditModalState =
  | { open: false }
  | {
      open: true;
      database_connection_credential_id: number;
      dbms_version_id: number | null;
      host_name: string;
      port: number | null;
      username: string;
      encrypted_password: string;
      is_active: boolean;
      is_admin: boolean;
    };

type CredentialAddModalState =
  | { open: false }
  | {
      open: true;
      dbms_version_id: number | null;
      host_name: string;
      port: number | null;
      username: string;
      encrypted_password: string;
      is_active: boolean;
      is_admin: boolean;
    };

export const Route = createFileRoute('/databases/$databaseId')({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
      throw redirect({ to: '/login' as any });
    }
    let roles: { user_role_code: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      throw redirect({ to: '/login' as any });
    }
    const isAdmin = roles.some((r) => r.user_role_code === 'ADM');
    if (!isAdmin) throw redirect({ to: '/' as any });
  },
  component: DatabaseDetailPage,
});

function DatabaseDetailPage() {
  const { databaseId: databaseIdParam } = useParams({ from: '/databases/$databaseId' });
  const databaseId = parseInt(databaseIdParam, 10);
  const { t } = useTranslation();
  const { confirm } = useModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showManualActions, setShowManualActions] = useState(false);
  const [showHierarchyMeta, setShowHierarchyMeta] = useState(false);
  const [expandedSchemaIds, setExpandedSchemaIds] = useState<Set<number>>(() => new Set());
  const [expandedTableIds, setExpandedTableIds] = useState<Set<number>>(() => new Set());
  const [expandedViewIds, setExpandedViewIds] = useState<Set<number>>(() => new Set());
  const [formModal, setFormModal] = useState<FormModalState>({ open: false });
  const [resourceEditModal, setResourceEditModal] = useState<ResourceEditModalState>({
    open: false,
  });
  const [credentialEditModal, setCredentialEditModal] = useState<CredentialEditModalState>({
    open: false,
  });
  const [credentialAddModal, setCredentialAddModal] = useState<CredentialAddModalState>({
    open: false,
  });
  const [deleteDatabaseConfirmOpen, setDeleteDatabaseConfirmOpen] = useState(false);
  const [deleteDatabaseConfirmText, setDeleteDatabaseConfirmText] = useState('');

  const { data: activeDbmsVersions = [], isLoading: isLoadingDbmsVersions } = useQuery({
    queryKey: queryKeys.adminDbmsVersionsActive,
    queryFn: () => apiFetchJson<DbmsVersionOption[]>('/api/admin/classifiers/dbms-versions/active'),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.adminDatabaseDetail(databaseId),
    queryFn: () => apiFetchJson<DatabaseDetailPayload>(`/api/admin/databases/${databaseId}/detail`),
    enabled: Number.isFinite(databaseId) && databaseId > 0,
    retry: false,
  });
  const detail = detailQuery.data;
  const loadingDetail = detailQuery.isLoading;

  const { data: resources, isLoading: loadingResources } = useQuery({
    queryKey: queryKeys.adminDatabaseResources(databaseId),
    queryFn: () => apiFetchJson<ResourcesPayload>(`/api/admin/databases/${databaseId}/resources`),
    enabled: Number.isFinite(databaseId) && databaseId > 0,
  });

  const allSchemaIds = (resources?.schemas ?? []).map((s) => s.schema_id);
  const allTableIds = (resources?.schemas ?? []).flatMap((s) =>
    s.tables.map((tbl) => tbl.table_id)
  );
  const allOpen = allSchemaIds.length > 0 && allSchemaIds.every((id) => expandedSchemaIds.has(id));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabaseResources(databaseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabaseDetail(databaseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: { path: string; method: 'POST' | 'PUT'; body: object }) => {
      const res =
        payload.method === 'POST'
          ? await apiPost(payload.path, payload.body)
          : await apiPut(payload.path, payload.body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.resourceSaveFailed'));
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.detail.resourceSaved'));
      setFormModal({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await apiDelete(path);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.resourceDeleteFailed'));
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.detail.resourceDeleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateResourceMetadataMutation = useMutation({
    mutationFn: async (body: {
      database_name: string;
      description_for_llm: string | null;
      comment_for_user: string | null;
      is_active: boolean;
    }) => {
      const res = await apiPut(`/api/admin/databases/${databaseId}/resource`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.updateSuccess'));
      setResourceEditModal({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleResourceOnlyMutation = useMutation({
    mutationFn: async (nextActive: boolean) => {
      const path = nextActive
        ? `/api/admin/databases/${databaseId}/resource/activate`
        : `/api/admin/databases/${databaseId}/resource/deactivate`;
      const res = await apiPost(path);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCredentialMutation = useMutation({
    mutationFn: async (payload: {
      credentialId: number;
      body: {
        dbms_version_id: number;
        host_name: string;
        port: number;
        username: string;
        encrypted_password?: string;
        is_active: boolean;
        is_admin: boolean;
        confirm_replace_admin?: boolean;
      };
    }) => {
      const res = await apiPut(
        `/api/admin/databases/${databaseId}/credentials/${payload.credentialId}`,
        payload.body
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.updateSuccess'));
      setCredentialEditModal({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCredentialMutation = useMutation({
    mutationFn: async (body: {
      dbms_version_id: number;
      host_name: string;
      port: number;
      username: string;
      encrypted_password: string;
      is_active: boolean;
      is_admin: boolean;
      confirm_replace_admin?: boolean;
    }) => {
      const res = await apiPost(`/api/admin/databases/${databaseId}/credentials`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.createFailed'));
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.detail.credentialAdded'));
      setCredentialAddModal({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCredentialMutation = useMutation({
    mutationFn: async (payload: { credentialId: number; nextActive: boolean }) => {
      const path = payload.nextActive
        ? `/api/admin/databases/${databaseId}/credentials/${payload.credentialId}/activate`
        : `/api/admin/databases/${databaseId}/credentials/${payload.credentialId}/deactivate`;
      const res = await apiPost(path);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (credentialId: number) => {
      const res = await apiDelete(`/api/admin/databases/${databaseId}/credentials/${credentialId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.deleteFailed'));
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('databases.detail.credentialDeleted'));
      setCredentialEditModal({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDatabaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiDelete(`/api/admin/databases/${databaseId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.deleteFailed'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDatabases });
      queryClient.removeQueries({ queryKey: queryKeys.adminDatabaseDetail(databaseId) });
      queryClient.removeQueries({ queryKey: queryKeys.adminDatabaseResources(databaseId) });
      toast.success(t('databases.deleteSuccess'));
      setDeleteDatabaseConfirmOpen(false);
      setDeleteDatabaseConfirmText('');
      setResourceEditModal({ open: false });
      void navigate({ to: '/databases' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearAllCommentsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiPost(`/api/admin/databases/${databaseId}/clear-comments`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
      return res.json().catch(() => ({})) as Promise<{ updated?: number }>;
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(
        t('databases.detail.clearAllCommentsSuccess', { count: Number(data?.updated ?? 0) })
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openAdd = () => {
    const schemas = resources?.schemas ?? [];
    const hasSchema = schemas.length > 0;
    const hasTable = schemas.some((s) => s.tables.length > 0);
    const firstSchemaId = hasSchema ? schemas[0].schema_id : undefined;
    const firstTableId = hasTable
      ? (schemas.find((s) => s.tables.length > 0)?.tables[0]?.table_id ?? undefined)
      : undefined;
    setFormModal({
      open: true,
      kind: 'schema',
      mode: 'add',
      allowKindChange: true,
      schemaId: firstSchemaId,
      tableId: firstTableId,
      name: '',
      description_for_llm: '',
      comment_for_user: '',
      is_active: true,
    });
  };

  const openEditSchema = (s: SchemaNode) => {
    setFormModal({
      open: true,
      kind: 'schema',
      mode: 'edit',
      resourceId: s.schema_id,
      name: s.name,
      description_for_llm: s.description_for_llm ?? '',
      comment_for_user: s.comment_for_user ?? '',
      is_active: s.is_active,
    });
  };

  const openAddTable = (schemaId: number) => {
    setFormModal({
      open: true,
      kind: 'table',
      mode: 'add',
      schemaId,
      name: '',
      description_for_llm: '',
      comment_for_user: '',
      is_active: true,
    });
  };

  const openEditTable = (s: SchemaNode, tbl: TableNode) => {
    setFormModal({
      open: true,
      kind: 'table',
      mode: 'edit',
      schemaId: s.schema_id,
      resourceId: tbl.table_id,
      name: tbl.name,
      description_for_llm: tbl.description_for_llm ?? '',
      comment_for_user: tbl.comment_for_user ?? '',
      is_active: tbl.is_active,
    });
  };

  const openAddColumn = (tableId: number) => {
    setFormModal({
      open: true,
      kind: 'column',
      mode: 'add',
      tableId,
      name: '',
      description_for_llm: '',
      comment_for_user: '',
      is_active: true,
    });
  };

  const openEditColumn = (tbl: TableNode, col: ColumnNode) => {
    setFormModal({
      open: true,
      kind: 'column',
      mode: 'edit',
      tableId: tbl.table_id,
      resourceId: col.column_id,
      name: col.name,
      description_for_llm: col.description_for_llm ?? '',
      comment_for_user: col.comment_for_user ?? '',
      is_active: col.is_active,
    });
  };

  const submitFormModal = () => {
    if (!formModal.open) return;
    const m = formModal;
    const name = m.name.trim();
    if (!name) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    if (m.mode === 'add' && m.kind === 'table' && m.schemaId == null) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    if (m.mode === 'add' && m.kind === 'column' && m.tableId == null) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    const description_for_llm = m.description_for_llm.trim() || null;
    const body = {
      name,
      description_for_llm,
      comment_for_user: m.comment_for_user.trim() || null,
      is_active: m.is_active,
    };

    if (m.kind === 'schema') {
      if (m.mode === 'add') {
        saveMutation.mutate({
          path: `/api/admin/databases/${databaseId}/schemas`,
          method: 'POST',
          body,
        });
      } else if (m.resourceId != null) {
        saveMutation.mutate({
          path: `/api/admin/resource-schemas/${m.resourceId}`,
          method: 'PUT',
          body,
        });
      }
      return;
    }

    if (m.kind === 'table') {
      if (m.mode === 'add' && m.schemaId != null) {
        saveMutation.mutate({
          path: `/api/admin/resource-schemas/${m.schemaId}/tables`,
          method: 'POST',
          body,
        });
      } else if (m.mode === 'edit' && m.resourceId != null) {
        saveMutation.mutate({
          path: `/api/admin/resource-tables/${m.resourceId}`,
          method: 'PUT',
          body,
        });
      }
      return;
    }

    if (m.kind === 'column') {
      if (m.mode === 'add' && m.tableId != null) {
        saveMutation.mutate({
          path: `/api/admin/resource-tables/${m.tableId}/columns`,
          method: 'POST',
          body,
        });
      } else if (m.mode === 'edit' && m.resourceId != null) {
        saveMutation.mutate({
          path: `/api/admin/resource-columns/${m.resourceId}`,
          method: 'PUT',
          body,
        });
      }
    }
  };

  const handleDeleteSchema = async (s: SchemaNode) => {
    const ok = await confirm({
      title: t('common.confirmation'),
      message: t('databases.detail.deleteSchemaConfirm', { name: s.name }),
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    deleteMutation.mutate(`/api/admin/resource-schemas/${s.schema_id}`);
  };

  const handleDeleteTable = async (tbl: TableNode) => {
    const ok = await confirm({
      title: t('common.confirmation'),
      message: t('databases.detail.deleteTableConfirm', { name: tbl.name }),
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    deleteMutation.mutate(`/api/admin/resource-tables/${tbl.table_id}`);
  };

  const handleDeleteColumn = async (col: ColumnNode) => {
    const ok = await confirm({
      title: t('common.confirmation'),
      message: t('databases.detail.deleteColumnConfirm', { name: col.name }),
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    deleteMutation.mutate(`/api/admin/resource-columns/${col.column_id}`);
  };

  const handleDeleteCredential = async () => {
    if (!credentialEditModal.open) return;
    const label = [
      credentialEditModal.username,
      credentialEditModal.host_name,
      credentialEditModal.port,
    ]
      .filter(Boolean)
      .join('@');
    const ok = await confirm({
      title: t('common.confirmation'),
      message: t('databases.detail.deleteCredentialConfirm', { name: label }),
      confirmText: t('common.ok'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    deleteCredentialMutation.mutate(credentialEditModal.database_connection_credential_id);
  };

  const openResourceEdit = () => {
    if (!detail) return;
    setResourceEditModal({
      open: true,
      database_name: detail.database_name ?? '',
      description_for_llm: detail.description_for_llm ?? '',
      comment_for_user: detail.comment_for_user ?? '',
      is_active: detail.is_active_database,
    });
  };

  const submitResourceEdit = () => {
    if (!resourceEditModal.open) return;
    const m = resourceEditModal;
    const database_name = m.database_name.trim();
    if (!database_name) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    updateResourceMetadataMutation.mutate({
      database_name,
      description_for_llm: m.description_for_llm.trim() || null,
      comment_for_user: m.comment_for_user.trim() || null,
      is_active: m.is_active,
    });
  };

  const openCredentialEdit = (cred: ConnectionCredentialRow) => {
    setCredentialEditModal({
      open: true,
      database_connection_credential_id: cred.database_connection_credential_id,
      dbms_version_id: cred.dbms_version_id,
      host_name: cred.host_name ?? '',
      port: cred.port,
      username: cred.username ?? '',
      encrypted_password: '',
      is_active: cred.is_active,
      is_admin: cred.is_admin,
    });
  };

  const submitCredentialEdit = async () => {
    if (!credentialEditModal.open) return;
    const m = credentialEditModal;
    const host_name = m.host_name.trim();
    const username = m.username.trim();
    if (
      !m.dbms_version_id ||
      !host_name ||
      m.port === null ||
      !username ||
      !Number.isInteger(m.port)
    ) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    let confirm_replace_admin: boolean | undefined;
    if (m.is_admin && detail) {
      const otherAdmin = (detail.credentials ?? []).some(
        (c) =>
          c.is_admin && c.database_connection_credential_id !== m.database_connection_credential_id
      );
      if (otherAdmin) {
        const ok = await confirm({
          title: t('databases.adminCredentialReplaceTitle'),
          message: t('databases.adminCredentialReplaceMessage'),
          confirmText: t('databases.adminCredentialReplaceConfirm'),
          cancelText: t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
        confirm_replace_admin = true;
      }
    }
    updateCredentialMutation.mutate({
      credentialId: m.database_connection_credential_id,
      body: {
        dbms_version_id: m.dbms_version_id,
        host_name,
        port: m.port,
        username,
        encrypted_password: m.encrypted_password.trim() || undefined,
        is_active: m.is_active,
        is_admin: m.is_admin,
        ...(confirm_replace_admin ? { confirm_replace_admin: true } : {}),
      },
    });
  };

  const openCredentialAdd = () => {
    setCredentialAddModal({
      open: true,
      dbms_version_id: null,
      host_name: '',
      port: null,
      username: '',
      encrypted_password: '',
      is_active: true,
      is_admin: false,
    });
  };

  const submitCredentialAdd = async () => {
    if (!credentialAddModal.open) return;
    const m = credentialAddModal;
    const host_name = m.host_name.trim();
    const username = m.username.trim();
    const encrypted_password = m.encrypted_password.trim();
    if (
      !m.dbms_version_id ||
      !host_name ||
      m.port === null ||
      !username ||
      !encrypted_password ||
      !Number.isInteger(m.port)
    ) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    let confirm_replace_admin: boolean | undefined;
    if (m.is_admin && detail) {
      const otherAdmin = (detail.credentials ?? []).some((c) => c.is_admin);
      if (otherAdmin) {
        const ok = await confirm({
          title: t('databases.adminCredentialReplaceTitle'),
          message: t('databases.adminCredentialReplaceMessage'),
          confirmText: t('databases.adminCredentialReplaceConfirm'),
          cancelText: t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
        confirm_replace_admin = true;
      }
    }
    addCredentialMutation.mutate({
      dbms_version_id: m.dbms_version_id,
      host_name,
      port: m.port,
      username,
      encrypted_password,
      is_active: m.is_active,
      is_admin: m.is_admin,
      ...(confirm_replace_admin ? { confirm_replace_admin: true } : {}),
    });
  };

  const invalidId = !Number.isFinite(databaseId) || databaseId <= 0;
  const notFound = !invalidId && !loadingDetail && (detailQuery.isError || detail == null);

  if (invalidId || notFound) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <p className="text-muted-foreground">{t('databases.detail.notFound')}</p>
        <Button asChild variant="outline" className="mt-4 w-fit">
          <Link to="/databases">{t('databases.detail.backToList')}</Link>
        </Button>
      </div>
    );
  }

  const busy =
    saveMutation.isPending ||
    deleteMutation.isPending ||
    updateResourceMetadataMutation.isPending ||
    toggleResourceOnlyMutation.isPending ||
    updateCredentialMutation.isPending ||
    addCredentialMutation.isPending ||
    toggleCredentialMutation.isPending ||
    deleteCredentialMutation.isPending ||
    deleteDatabaseMutation.isPending ||
    clearAllCommentsMutation.isPending;
  const isDeletingDatabase = deleteDatabaseMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={detail?.database_name ?? t('databases.detail.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/databases" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t('databases.detail.backToList')}
              </Link>
            </Button>
          </div>

          {loadingDetail || !detail ? (
            <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <div className="space-y-6 w-full">
              <DatabaseDetailInfoTile
                title={t('databases.detail.resourceSectionTitle')}
                created={detail.resource_created_at_time}
                modified={detail.resource_modified_at_time}
                actions={
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      title={t('databases.detail.editResource')}
                      onClick={openResourceEdit}
                      disabled={busy}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={t('databases.detail.toggleResourceActive')}
                      className="text-muted-foreground hover:text-foreground"
                      disabled={busy}
                      onClick={() => toggleResourceOnlyMutation.mutate(!detail.is_active_database)}
                    >
                      {detail.is_active_database ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </Button>
                  </>
                }
              >
                <div className={detailInfoTileFieldGridClass}>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">{t('databases.databaseName')}: </span>
                    {detail.database_name || '—'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">
                      {t('databases.descriptionForLlm')}:{' '}
                    </span>
                    <span className="whitespace-pre-wrap">
                      {(detail.description_for_llm ?? '').trim() || '—'}
                    </span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">{t('databases.commentForUser')}: </span>
                    <span className="whitespace-pre-wrap">
                      {(detail.comment_for_user ?? '').trim() || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('databases.active')}: </span>
                    {detail.is_active_database ? t('common.yes') : t('common.no')}
                  </div>
                </div>
              </DatabaseDetailInfoTile>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {t('databases.detail.credentialsSectionTitle')}
                  </h2>
                  <Button type="button" size="sm" onClick={openCredentialAdd} disabled={busy}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t('databases.detail.addCredential')}
                  </Button>
                </div>
                {(detail.credentials ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('databases.detail.noCredentials')}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {(detail.credentials ?? []).map((cred) => (
                      <div
                        key={cred.database_connection_credential_id}
                        className="rounded-lg border border-border bg-card p-3 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1 space-y-2 text-[13px]">
                            <div>
                              <span className="text-muted-foreground">
                                {t('databases.dbmsVersion')}:{' '}
                              </span>
                              {cred.dbms_name ? (
                                <>
                                  {cred.dbms_name}
                                  {cred.dbms_version ? (
                                    <span className="font-mono"> {cred.dbms_version}</span>
                                  ) : null}
                                </>
                              ) : (
                                '—'
                              )}
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                {t('databases.active')}:{' '}
                              </span>
                              {cred.is_active ? t('common.yes') : t('common.no')}
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                {t('databases.isAdmin')}:{' '}
                              </span>
                              {cred.is_admin ? t('common.yes') : t('common.no')}
                            </div>
                            <div>
                              <span className="text-muted-foreground">{t('databases.host')}: </span>
                              {cred.host_name ?? '—'}
                            </div>
                            <div>
                              <span className="text-muted-foreground">{t('databases.port')}: </span>
                              {cred.port ?? '—'}
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                {t('databases.username')}:{' '}
                              </span>
                              {cred.username ?? '—'}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="hover:text-green-600"
                              title={t('databases.detail.editCredential')}
                              onClick={() => openCredentialEdit(cred)}
                              disabled={busy}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title={t('databases.detail.toggleCredentialActive')}
                              className={
                                cred.is_active ? 'hover:text-destructive' : 'hover:text-green-600'
                              }
                              disabled={busy}
                              onClick={() =>
                                toggleCredentialMutation.mutate({
                                  credentialId: cred.database_connection_credential_id,
                                  nextActive: !cred.is_active,
                                })
                              }
                            >
                              {cred.is_active ? (
                                <ToggleRight className="h-4 w-4" />
                              ) : (
                                <ToggleLeft className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <DetailTimestampSection
                          created={cred.created_at_time}
                          modified={cred.modified_at_time}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
                {t('databases.detail.resourceHierarchy')}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {showManualActions ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('common.confirmation'),
                        message: t('databases.detail.clearAllCommentsConfirm'),
                        confirmText: t('common.ok'),
                        cancelText: t('common.cancel'),
                        destructive: true,
                      });
                      if (!ok) return;
                      clearAllCommentsMutation.mutate();
                    }}
                    disabled={busy || loadingResources}
                    title={t('databases.detail.clearAllComments')}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('databases.detail.clearAllComments')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (allOpen) {
                      setExpandedSchemaIds(new Set());
                      setExpandedTableIds(new Set());
                    } else {
                      setExpandedSchemaIds(new Set(allSchemaIds));
                      setExpandedTableIds(new Set(allTableIds));
                    }
                  }}
                  disabled={busy || loadingResources || allSchemaIds.length === 0}
                  title={allOpen ? t('databases.detail.closeAll') : t('databases.detail.openAll')}
                >
                  {allOpen ? (
                    <ToggleLeft className="h-4 w-4 mr-1" />
                  ) : (
                    <ToggleRight className="h-4 w-4 mr-1" />
                  )}
                  {allOpen ? t('databases.detail.closeAll') : t('databases.detail.openAll')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowManualActions((v) => !v)}
                  disabled={busy}
                  title={
                    showManualActions
                      ? t('databases.detail.hideActions')
                      : t('databases.detail.showActions')
                  }
                >
                  {showManualActions ? (
                    <ToggleRight className="h-4 w-4 mr-1" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 mr-1" />
                  )}
                  {showManualActions
                    ? t('databases.detail.hideActions')
                    : t('databases.detail.showActions')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHierarchyMeta((v) => !v)}
                  disabled={busy}
                  title={
                    showHierarchyMeta
                      ? t('databases.detail.hideHierarchyMeta')
                      : t('databases.detail.showHierarchyMeta')
                  }
                >
                  {showHierarchyMeta ? (
                    <ToggleRight className="h-4 w-4 mr-1" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 mr-1" />
                  )}
                  {showHierarchyMeta
                    ? t('databases.detail.hideHierarchyMeta')
                    : t('databases.detail.showHierarchyMeta')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={openAdd}
                  disabled={busy || loadingResources}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('databases.detail.addResource')}
                </Button>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground max-w-3xl">
              {t('databases.detail.hierarchyIntro')}
            </p>

            {loadingResources ? (
              <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
            ) : !resources?.schemas.length ? (
              <p className="text-[13px] text-muted-foreground">{t('databases.detail.noSchemas')}</p>
            ) : (
              <div className="space-y-6">
                {resources.schemas.map((schema) => (
                  <div
                    key={schema.schema_id}
                    className="rounded-lg border border-border bg-card p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        onClick={() =>
                          setExpandedSchemaIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(schema.schema_id)) next.delete(schema.schema_id);
                            else next.add(schema.schema_id);
                            return next;
                          })
                        }
                        disabled={busy}
                        aria-expanded={expandedSchemaIds.has(schema.schema_id)}
                        title={
                          expandedSchemaIds.has(schema.schema_id)
                            ? t('databases.detail.collapseSchema')
                            : t('databases.detail.expandSchema')
                        }
                      >
                        <h3 className="font-semibold text-base flex items-center gap-2">
                          {expandedSchemaIds.has(schema.schema_id) ? '▾' : '▸'}
                          <span className="truncate">
                            {t('databases.detail.schemaLabel')}: {schema.name}
                          </span>
                          {showManualActions ? (
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              ({schema.is_active ? t('common.active') : t('common.deactivated')})
                            </span>
                          ) : null}
                        </h3>
                        {showHierarchyMeta ? (
                          <div className="text-xs text-muted-foreground mt-1 space-y-1">
                            <div>
                              <span className="text-muted-foreground font-medium">
                                {t('databases.descriptionForLlm')}:{' '}
                              </span>
                              <span className="whitespace-pre-wrap">
                                {(schema.description_for_llm ?? '').trim() || '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground font-medium">
                                {t('databases.commentForUser')}:{' '}
                              </span>
                              <span className="whitespace-pre-wrap">
                                {(schema.comment_for_user ?? '').trim() || '—'}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </button>
                      {showManualActions ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={t('databases.detail.editSchema')}
                            onClick={() => openEditSchema(schema)}
                            disabled={busy}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            title={t('databases.detail.deleteSchema')}
                            onClick={() => void handleDeleteSchema(schema)}
                            disabled={busy}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openAddTable(schema.schema_id)}
                            disabled={busy}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {t('databases.detail.addTable')}
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {expandedSchemaIds.has(schema.schema_id) ? (
                      <div className="pl-2 border-l-2 border-border space-y-4">
                        {(() => {
                          const schemaViews = schema.views ?? [];
                          const schemaMatviews = schema.materialized_views ?? [];
                          const hasAnyRelation =
                            schema.tables.length > 0 ||
                            schemaViews.length > 0 ||
                            schemaMatviews.length > 0;
                          if (!hasAnyRelation) {
                            return (
                              <p className="text-xs text-muted-foreground">
                                {t('databases.detail.schemaEmptyRelations')}
                              </p>
                            );
                          }
                          return (
                            <>
                              <div className="space-y-3">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {t('databases.detail.tablesHeading')}
                                </h4>
                                {schema.tables.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t('databases.detail.noBaseTablesInSchema')}
                                  </p>
                                ) : (
                                  <>
                                    {schema.tables.map((tbl) => (
                                      <div key={tbl.table_id} className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                            onClick={() =>
                                              setExpandedTableIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(tbl.table_id))
                                                  next.delete(tbl.table_id);
                                                else next.add(tbl.table_id);
                                                return next;
                                              })
                                            }
                                            disabled={busy}
                                            aria-expanded={expandedTableIds.has(tbl.table_id)}
                                            title={
                                              expandedTableIds.has(tbl.table_id)
                                                ? t('databases.detail.collapseTable')
                                                : t('databases.detail.expandTable')
                                            }
                                          >
                                            <h4 className="text-sm font-medium flex items-center gap-2">
                                              {expandedTableIds.has(tbl.table_id) ? '▾' : '▸'}
                                              <span className="truncate">
                                                {t('databases.detail.tableLabel')}: {tbl.name}
                                              </span>
                                              {showManualActions ? (
                                                <span className="text-muted-foreground text-xs whitespace-nowrap">
                                                  (
                                                  {tbl.is_active
                                                    ? t('common.active')
                                                    : t('common.deactivated')}
                                                  )
                                                </span>
                                              ) : null}
                                            </h4>
                                            {showHierarchyMeta ? (
                                              <div className="text-xs text-muted-foreground mt-1 space-y-1">
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.descriptionForLlm')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(tbl.description_for_llm ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.commentForUser')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(tbl.comment_for_user ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : null}
                                          </button>
                                          {showManualActions ? (
                                            <div className="flex gap-1">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                title={t('databases.detail.editTable')}
                                                onClick={() => openEditTable(schema, tbl)}
                                                disabled={busy}
                                              >
                                                <Edit className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                className="hover:text-destructive"
                                                title={t('databases.detail.deleteTable')}
                                                onClick={() => void handleDeleteTable(tbl)}
                                                disabled={busy}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openAddColumn(tbl.table_id)}
                                                disabled={busy}
                                              >
                                                <Plus className="h-3 w-3 mr-1" />
                                                {t('databases.detail.addColumn')}
                                              </Button>
                                            </div>
                                          ) : null}
                                        </div>

                                        {expandedTableIds.has(tbl.table_id) ? (
                                          tbl.columns.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">
                                              {t('databases.detail.noColumns')}
                                            </p>
                                          ) : (
                                            <ul className="text-sm space-y-1 pl-3">
                                              {tbl.columns.map((col) => (
                                                <li
                                                  key={col.column_id}
                                                  className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-border/60 last:border-0"
                                                >
                                                  <div className="min-w-0">
                                                    <div>
                                                      {t('databases.detail.columnLabel')}:{' '}
                                                      <code>{col.name}</code>
                                                      {col.data_type ? (
                                                        <span
                                                          className="text-muted-foreground text-xs ml-2 font-mono"
                                                          title={t(
                                                            'databases.detail.columnDataTypeTitle'
                                                          )}
                                                        >
                                                          {col.data_type}
                                                        </span>
                                                      ) : null}
                                                      {showManualActions ? (
                                                        <span className="text-muted-foreground text-xs ml-2">
                                                          (
                                                          {col.is_active
                                                            ? t('common.active')
                                                            : t('common.deactivated')}
                                                          )
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                    {showHierarchyMeta ? (
                                                      <div className="text-xs text-muted-foreground mt-1 space-y-1">
                                                        <div>
                                                          <span className="text-muted-foreground font-medium">
                                                            {t('databases.descriptionForLlm')}:{' '}
                                                          </span>
                                                          <span className="whitespace-pre-wrap">
                                                            {(
                                                              col.description_for_llm ?? ''
                                                            ).trim() || '—'}
                                                          </span>
                                                        </div>
                                                        <div>
                                                          <span className="text-muted-foreground font-medium">
                                                            {t('databases.commentForUser')}:{' '}
                                                          </span>
                                                          <span className="whitespace-pre-wrap">
                                                            {(col.comment_for_user ?? '').trim() ||
                                                              '—'}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    ) : null}
                                                  </div>
                                                  {showManualActions ? (
                                                    <div className="flex gap-1">
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        title={t('databases.detail.editColumn')}
                                                        onClick={() => openEditColumn(tbl, col)}
                                                        disabled={busy}
                                                      >
                                                        <Edit className="h-3 w-3" />
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        className="hover:text-destructive"
                                                        title={t('databases.detail.deleteColumn')}
                                                        onClick={() => void handleDeleteColumn(col)}
                                                        disabled={busy}
                                                      >
                                                        <Trash2 className="h-3 w-3" />
                                                      </Button>
                                                    </div>
                                                  ) : null}
                                                </li>
                                              ))}
                                            </ul>
                                          )
                                        ) : null}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>

                              <div className="space-y-3 pt-2 border-t border-border/60">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {t('databases.detail.viewsHeading')}
                                </h4>
                                {schemaViews.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t('databases.detail.noViewsInSchema')}
                                  </p>
                                ) : (
                                  <>
                                    {schemaViews.map((vw) => (
                                      <div key={vw.view_id} className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                            onClick={() =>
                                              setExpandedViewIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(vw.view_id)) next.delete(vw.view_id);
                                                else next.add(vw.view_id);
                                                return next;
                                              })
                                            }
                                            disabled={busy}
                                            aria-expanded={expandedViewIds.has(vw.view_id)}
                                            title={
                                              expandedViewIds.has(vw.view_id)
                                                ? t('databases.detail.collapseTable')
                                                : t('databases.detail.expandTable')
                                            }
                                          >
                                            <h4 className="text-sm font-medium flex items-center gap-2">
                                              {expandedViewIds.has(vw.view_id) ? '▾' : '▸'}
                                              <span className="truncate">
                                                {t('databases.detail.viewLabel')}: {vw.name}
                                              </span>
                                              {showManualActions ? (
                                                <span className="text-muted-foreground text-xs whitespace-nowrap">
                                                  (
                                                  {vw.is_active
                                                    ? t('common.active')
                                                    : t('common.deactivated')}
                                                  )
                                                </span>
                                              ) : null}
                                            </h4>
                                            {showHierarchyMeta ? (
                                              <div className="text-xs text-muted-foreground mt-1 space-y-1">
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.descriptionForLlm')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(vw.description_for_llm ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.commentForUser')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(vw.comment_for_user ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : null}
                                          </button>
                                        </div>

                                        {expandedViewIds.has(vw.view_id) ? (
                                          vw.columns.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">
                                              {t('databases.detail.viewNoColumns')}
                                            </p>
                                          ) : (
                                            <ul className="text-sm space-y-1 pl-3">
                                              {vw.columns.map((col) => (
                                                <li
                                                  key={
                                                    col.column_id === 0
                                                      ? `${vw.view_id}-${col.name}`
                                                      : col.column_id
                                                  }
                                                  className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-border/60 last:border-0"
                                                >
                                                  <div className="min-w-0">
                                                    <div>
                                                      {t('databases.detail.columnLabel')}:{' '}
                                                      <code>{col.name}</code>
                                                      {col.data_type ? (
                                                        <span
                                                          className="text-muted-foreground text-xs ml-2 font-mono"
                                                          title={t(
                                                            'databases.detail.columnDataTypeTitle'
                                                          )}
                                                        >
                                                          {col.data_type}
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                </li>
                                              ))}
                                            </ul>
                                          )
                                        ) : null}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>

                              <div className="space-y-3 pt-2 border-t border-border/60">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {t('databases.detail.materializedViewsHeading')}
                                </h4>
                                {schemaMatviews.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t('databases.detail.noMaterializedViewsInSchema')}
                                  </p>
                                ) : (
                                  <>
                                    {schemaMatviews.map((vw) => (
                                      <div key={vw.view_id} className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                            onClick={() =>
                                              setExpandedViewIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(vw.view_id)) next.delete(vw.view_id);
                                                else next.add(vw.view_id);
                                                return next;
                                              })
                                            }
                                            disabled={busy}
                                            aria-expanded={expandedViewIds.has(vw.view_id)}
                                            title={
                                              expandedViewIds.has(vw.view_id)
                                                ? t('databases.detail.collapseTable')
                                                : t('databases.detail.expandTable')
                                            }
                                          >
                                            <h4 className="text-sm font-medium flex items-center gap-2">
                                              {expandedViewIds.has(vw.view_id) ? '▾' : '▸'}
                                              <span className="truncate">
                                                {t('databases.detail.materializedViewLabel')}:{' '}
                                                {vw.name}
                                              </span>
                                              {showManualActions ? (
                                                <span className="text-muted-foreground text-xs whitespace-nowrap">
                                                  (
                                                  {vw.is_active
                                                    ? t('common.active')
                                                    : t('common.deactivated')}
                                                  )
                                                </span>
                                              ) : null}
                                            </h4>
                                            {showHierarchyMeta ? (
                                              <div className="text-xs text-muted-foreground mt-1 space-y-1">
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.descriptionForLlm')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(vw.description_for_llm ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground font-medium">
                                                    {t('databases.commentForUser')}:{' '}
                                                  </span>
                                                  <span className="whitespace-pre-wrap">
                                                    {(vw.comment_for_user ?? '').trim() || '—'}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : null}
                                          </button>
                                        </div>

                                        {expandedViewIds.has(vw.view_id) ? (
                                          vw.columns.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">
                                              {t('databases.detail.viewNoColumns')}
                                            </p>
                                          ) : (
                                            <ul className="text-sm space-y-1 pl-3">
                                              {vw.columns.map((col) => (
                                                <li
                                                  key={
                                                    col.column_id === 0
                                                      ? `${vw.view_id}-${col.name}`
                                                      : col.column_id
                                                  }
                                                  className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-border/60 last:border-0"
                                                >
                                                  <div className="min-w-0">
                                                    <div>
                                                      {t('databases.detail.columnLabel')}:{' '}
                                                      <code>{col.name}</code>
                                                      {col.data_type ? (
                                                        <span
                                                          className="text-muted-foreground text-xs ml-2 font-mono"
                                                          title={t(
                                                            'databases.detail.columnDataTypeTitle'
                                                          )}
                                                        >
                                                          {col.data_type}
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                </li>
                                              ))}
                                            </ul>
                                          )
                                        ) : null}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {formModal.open && (
          <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t('common.cancel')}
              onClick={() => setFormModal({ open: false })}
              disabled={busy}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-[15px] font-semibold">
                  {formModal.mode === 'add' && formModal.allowKindChange
                    ? t('databases.detail.addResource')
                    : null}
                  {(!formModal.allowKindChange || formModal.mode === 'edit') &&
                    formModal.kind === 'schema' &&
                    (formModal.mode === 'add'
                      ? t('databases.detail.addSchema')
                      : t('databases.detail.editSchema'))}
                  {(!formModal.allowKindChange || formModal.mode === 'edit') &&
                    formModal.kind === 'table' &&
                    (formModal.mode === 'add'
                      ? t('databases.detail.addTable')
                      : t('databases.detail.editTable'))}
                  {(!formModal.allowKindChange || formModal.mode === 'edit') &&
                    formModal.kind === 'column' &&
                    (formModal.mode === 'add'
                      ? t('databases.detail.addColumn')
                      : t('databases.detail.editColumn'))}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFormModal({ open: false })}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4">
                {formModal.mode === 'add' && formModal.allowKindChange
                  ? (() => {
                      const schemasAvailable = resources?.schemas ?? [];
                      const hasSchemaOption = true;
                      const hasTableOption = schemasAvailable.length > 0;
                      const hasColumnOption = schemasAvailable.some((s) => s.tables.length > 0);
                      const availableCount =
                        (hasSchemaOption ? 1 : 0) +
                        (hasTableOption ? 1 : 0) +
                        (hasColumnOption ? 1 : 0);
                      const flatTables = schemasAvailable.flatMap((s) =>
                        s.tables.map((tbl) => ({
                          schemaName: s.name,
                          tableId: tbl.table_id,
                          tableName: tbl.name,
                        }))
                      );
                      return (
                        <>
                          {availableCount > 1 ? (
                            <Field>
                              <FieldLabel>
                                {t('databases.detail.resourceType')} <RequiredMark />
                              </FieldLabel>
                              <div className="flex flex-wrap gap-4 mt-1">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name="resource-kind"
                                    value="schema"
                                    checked={formModal.kind === 'schema'}
                                    onChange={() =>
                                      setFormModal((m) => (m.open ? { ...m, kind: 'schema' } : m))
                                    }
                                    disabled={busy}
                                    className="text-primary"
                                  />
                                  {t('databases.detail.resourceTypeSchema')}
                                </label>
                                {hasTableOption ? (
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name="resource-kind"
                                      value="table"
                                      checked={formModal.kind === 'table'}
                                      onChange={() =>
                                        setFormModal((m) => (m.open ? { ...m, kind: 'table' } : m))
                                      }
                                      disabled={busy}
                                      className="text-primary"
                                    />
                                    {t('databases.detail.resourceTypeTable')}
                                  </label>
                                ) : null}
                                {hasColumnOption ? (
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name="resource-kind"
                                      value="column"
                                      checked={formModal.kind === 'column'}
                                      onChange={() =>
                                        setFormModal((m) => (m.open ? { ...m, kind: 'column' } : m))
                                      }
                                      disabled={busy}
                                      className="text-primary"
                                    />
                                    {t('databases.detail.resourceTypeColumn')}
                                  </label>
                                ) : null}
                              </div>
                            </Field>
                          ) : null}
                          {formModal.kind === 'table' ? (
                            <Field>
                              <FieldLabel>
                                {t('databases.detail.selectSchema')} <RequiredMark />
                              </FieldLabel>
                              <SearchableSelect
                                value={formModal.schemaId ? String(formModal.schemaId) : ''}
                                onChange={(next) =>
                                  setFormModal((m) =>
                                    m.open
                                      ? {
                                          ...m,
                                          schemaId: next ? Number(next) : undefined,
                                        }
                                      : m
                                  )
                                }
                                options={schemasAvailable.map((s) => ({
                                  value: String(s.schema_id),
                                  label: s.name,
                                }))}
                                placeholder={
                                  schemasAvailable.length === 0 ? '—' : t('common.select')
                                }
                                disabled={busy || schemasAvailable.length === 0}
                              />
                            </Field>
                          ) : null}
                          {formModal.kind === 'column' ? (
                            <Field>
                              <FieldLabel>
                                {t('databases.detail.selectTable')} <RequiredMark />
                              </FieldLabel>
                              <SearchableSelect
                                value={formModal.tableId ? String(formModal.tableId) : ''}
                                onChange={(next) =>
                                  setFormModal((m) =>
                                    m.open
                                      ? {
                                          ...m,
                                          tableId: next ? Number(next) : undefined,
                                        }
                                      : m
                                  )
                                }
                                options={flatTables.map((ft) => ({
                                  value: String(ft.tableId),
                                  label: `${ft.schemaName} / ${ft.tableName}`,
                                }))}
                                placeholder={flatTables.length === 0 ? '—' : t('common.select')}
                                disabled={busy || flatTables.length === 0}
                              />
                            </Field>
                          ) : null}
                        </>
                      );
                    })()
                  : null}
                <Field>
                  <FieldLabel>
                    {formModal.kind === 'schema' && t('databases.detail.schemaName')}
                    {formModal.kind === 'table' && t('databases.detail.tableName')}
                    {formModal.kind === 'column' && t('databases.detail.columnName')}
                    <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={formModal.name}
                    onChange={(e) =>
                      setFormModal((m) => (m.open ? { ...m, name: e.target.value } : m))
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('databases.descriptionForLlm')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[64px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={formModal.description_for_llm}
                    onChange={(e) =>
                      setFormModal((m) =>
                        m.open ? { ...m, description_for_llm: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('databases.commentForUser')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[64px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={formModal.comment_for_user}
                    onChange={(e) =>
                      setFormModal((m) => (m.open ? { ...m, comment_for_user: e.target.value } : m))
                    }
                    disabled={busy}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="res-active"
                    checked={formModal.is_active}
                    onCheckedChange={(v) =>
                      setFormModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label htmlFor="res-active" className="text-sm font-normal cursor-pointer">
                    {t('databases.active')}
                  </Label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormModal({ open: false })}
                  disabled={busy}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={submitFormModal} disabled={busy}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {resourceEditModal.open && (
          <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t('common.cancel')}
              onClick={() => setResourceEditModal({ open: false })}
              disabled={busy}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-[15px] font-semibold">{t('databases.detail.editResource')}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setResourceEditModal({ open: false })}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>
                    {t('databases.databaseName')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={resourceEditModal.database_name}
                    onChange={(e) =>
                      setResourceEditModal((m) =>
                        m.open ? { ...m, database_name: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('databases.descriptionForLlm')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[64px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={resourceEditModal.description_for_llm}
                    onChange={(e) =>
                      setResourceEditModal((m) =>
                        m.open ? { ...m, description_for_llm: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('databases.commentForUser')}</FieldLabel>
                  <textarea
                    className="w-full min-h-[64px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={resourceEditModal.comment_for_user}
                    onChange={(e) =>
                      setResourceEditModal((m) =>
                        m.open ? { ...m, comment_for_user: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="resource-edit-active"
                    checked={resourceEditModal.is_active}
                    onCheckedChange={(v) =>
                      setResourceEditModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label
                    htmlFor="resource-edit-active"
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('databases.active')}
                  </Label>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      setDeleteDatabaseConfirmText('');
                      setDeleteDatabaseConfirmOpen(true);
                    }}
                    disabled={busy}
                  >
                    {t('databases.deleteDatabase')}
                  </Button>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setResourceEditModal({ open: false })}
                    disabled={busy}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" onClick={submitResourceEdit} disabled={busy}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {resourceEditModal.open && deleteDatabaseConfirmOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={() => setDeleteDatabaseConfirmOpen(false)}
              disabled={isDeletingDatabase}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="databases-detail-delete-title"
              className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="databases-detail-delete-title" className="text-[15px] font-semibold mb-1">
                {t('databases.deleteTitle')}
              </h2>
              <p className="text-[13px] text-muted-foreground mb-4">
                {t('databases.deleteWarning')}
              </p>

              <div className="space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('databases.databaseName')}: </span>
                  <span className="font-medium break-all">{resourceEditModal.database_name}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('databases.deleteTypeNameHint')}
                </div>
                <Input
                  value={deleteDatabaseConfirmText}
                  onChange={(e) => setDeleteDatabaseConfirmText(e.target.value)}
                  placeholder={resourceEditModal.database_name}
                  disabled={isDeletingDatabase}
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteDatabaseConfirmOpen(false)}
                  disabled={isDeletingDatabase}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    isDeletingDatabase ||
                    deleteDatabaseConfirmText.trim() !==
                      String(resourceEditModal.database_name ?? '').trim()
                  }
                  onClick={() => deleteDatabaseMutation.mutate()}
                >
                  {t('databases.deleteConfirm')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {credentialEditModal.open && (
          <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t('common.cancel')}
              onClick={() => setCredentialEditModal({ open: false })}
              disabled={busy}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-lg font-semibold">{t('databases.detail.editCredential')}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setCredentialEditModal({ open: false })}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>
                    {t('databases.dbmsVersion')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={
                      credentialEditModal.dbms_version_id != null
                        ? String(credentialEditModal.dbms_version_id)
                        : ''
                    }
                    onChange={(next) =>
                      setCredentialEditModal((m) =>
                        m.open
                          ? {
                              ...m,
                              dbms_version_id: next ? Number(next) : null,
                            }
                          : m
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
                    disabled={busy || isLoadingDbmsVersions || activeDbmsVersions.length === 0}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.host')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={credentialEditModal.host_name}
                    onChange={(e) =>
                      setCredentialEditModal((m) =>
                        m.open ? { ...m, host_name: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.port')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={credentialEditModal.port ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCredentialEditModal((m) => {
                        if (!m.open) return m;
                        if (raw === '') return { ...m, port: null };
                        const n = parseInt(raw, 10);
                        return { ...m, port: Number.isInteger(n) ? n : m.port };
                      });
                    }}
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.username')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={credentialEditModal.username}
                    onChange={(e) =>
                      setCredentialEditModal((m) =>
                        m.open ? { ...m, username: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('databases.password')}</FieldLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={credentialEditModal.encrypted_password}
                    onChange={(e) =>
                      setCredentialEditModal((m) =>
                        m.open ? { ...m, encrypted_password: e.target.value } : m
                      )
                    }
                    disabled={busy}
                    placeholder={t('databases.passwordOptional')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('databases.passwordLeaveEmpty')}
                  </p>
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cred-edit-active"
                    checked={credentialEditModal.is_active}
                    onCheckedChange={(v) =>
                      setCredentialEditModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label htmlFor="cred-edit-active" className="text-sm font-normal cursor-pointer">
                    {t('databases.active')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cred-edit-admin"
                    checked={credentialEditModal.is_admin}
                    onCheckedChange={(v) =>
                      setCredentialEditModal((m) => (m.open ? { ...m, is_admin: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label htmlFor="cred-edit-admin" className="text-sm font-normal cursor-pointer">
                    {t('databases.isAdmin')}
                  </Label>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDeleteCredential}
                    disabled={busy}
                  >
                    {t('databases.detail.deleteCredential')}
                  </Button>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCredentialEditModal({ open: false })}
                    disabled={busy}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={submitCredentialEdit}
                    disabled={busy || activeDbmsVersions.length === 0}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {credentialAddModal.open && (
          <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t('common.cancel')}
              onClick={() => setCredentialAddModal({ open: false })}
              disabled={busy}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-[15px] font-semibold">{t('databases.detail.addCredential')}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setCredentialAddModal({ open: false })}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>
                    {t('databases.dbmsVersion')} <RequiredMark />
                  </FieldLabel>
                  <SearchableSelect
                    value={
                      credentialAddModal.dbms_version_id != null
                        ? String(credentialAddModal.dbms_version_id)
                        : ''
                    }
                    onChange={(next) =>
                      setCredentialAddModal((m) =>
                        m.open
                          ? {
                              ...m,
                              dbms_version_id: next ? Number(next) : null,
                            }
                          : m
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
                    disabled={busy || isLoadingDbmsVersions || activeDbmsVersions.length === 0}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.host')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={credentialAddModal.host_name}
                    onChange={(e) =>
                      setCredentialAddModal((m) =>
                        m.open ? { ...m, host_name: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.port')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={credentialAddModal.port ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCredentialAddModal((m) => {
                        if (!m.open) return m;
                        if (raw === '') return { ...m, port: null };
                        const n = parseInt(raw, 10);
                        return { ...m, port: Number.isInteger(n) ? n : m.port };
                      });
                    }}
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.username')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    value={credentialAddModal.username}
                    onChange={(e) =>
                      setCredentialAddModal((m) =>
                        m.open ? { ...m, username: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('databases.password')} <RequiredMark />
                  </FieldLabel>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={credentialAddModal.encrypted_password}
                    onChange={(e) =>
                      setCredentialAddModal((m) =>
                        m.open ? { ...m, encrypted_password: e.target.value } : m
                      )
                    }
                    disabled={busy}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cred-add-active"
                    checked={credentialAddModal.is_active}
                    onCheckedChange={(v) =>
                      setCredentialAddModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label htmlFor="cred-add-active" className="text-sm font-normal cursor-pointer">
                    {t('databases.active')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cred-add-admin"
                    checked={credentialAddModal.is_admin}
                    onCheckedChange={(v) =>
                      setCredentialAddModal((m) => (m.open ? { ...m, is_admin: v === true } : m))
                    }
                    disabled={busy}
                  />
                  <Label htmlFor="cred-add-admin" className="text-sm font-normal cursor-pointer">
                    {t('databases.isAdmin')}
                  </Label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCredentialAddModal({ open: false })}
                  disabled={busy}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={submitCredentialAdd}
                  disabled={busy || activeDbmsVersions.length === 0}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
