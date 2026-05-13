import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import toast from '@/lib/toast';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Edit,
  ExternalLink,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/hooks/useTranslation';
import { useModal } from '@/contexts/modal-context';
import { apiDelete, apiFetchJson, apiPost, apiPut, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

type DbmsRow = {
  dbms_code: string;
  dbms_name: string;
  dbms_description: string | null;
  dbms_is_active: boolean;
};

type DbmsVersionRow = {
  dbms_code: string;
  dbms_name: string;
  dbms_description: string | null;
  dbms_is_active: boolean;
  dbms_version_id: number;
  version: string;
  dbms_version_description: string | null;
  dbms_version_is_active: boolean;
};

type Tab = 'dbms' | 'versions' | 'tableTypes';
type SortDir = 'asc' | 'desc';

type DbmsSortKey = 'dbmsCode' | 'dbmsName' | 'dbmsActive';
type VersionSortKey = 'dbmsName' | 'dbmsCode' | 'version' | 'versionActive';
type TableTypeSortKey = 'tableTypeName' | 'tableTypeActive';

type TableTypeRow = {
  table_type_id: number;
  name: string;
  description: string | null;
  is_active: boolean;
};

type DbmsModalState =
  | { open: false }
  | {
      open: true;
      mode: 'add' | 'edit';
      dbms_code: string;
      original_dbms_code?: string;
      dbms_name: string;
      dbms_description: string;
      dbms_is_active: boolean;
    };

type VersionModalState =
  | { open: false }
  | {
      open: true;
      mode: 'add' | 'edit';
      dbms_code: string;
      dbms_version_id?: number;
      original_version?: string;
      version: string;
      dbms_version_description: string;
      dbms_version_is_active: boolean;
    };

type TableTypeModalState =
  | { open: false }
  | {
      open: true;
      mode: 'add' | 'edit';
      table_type_id?: number;
      name: string;
      description: string;
      is_active: boolean;
    };

export function DbmsClassifiersSection({
  showAdminClassifiersLink = false,
  rootId,
}: { showAdminClassifiersLink?: boolean; rootId?: string } = {}) {
  const { t } = useTranslation();
  const { confirm } = useModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('dbms');
  const [search, setSearch] = useState('');
  const [dbmsModal, setDbmsModal] = useState<DbmsModalState>({ open: false });
  const [versionModal, setVersionModal] = useState<VersionModalState>({ open: false });
  const [tableTypeModal, setTableTypeModal] = useState<TableTypeModalState>({ open: false });
  const [dbmsSort, setDbmsSort] = useState<{ key: DbmsSortKey; dir: SortDir }>({
    key: 'dbmsName',
    dir: 'asc',
  });
  const [versionSort, setVersionSort] = useState<{ key: VersionSortKey; dir: SortDir }>({
    key: 'dbmsName',
    dir: 'asc',
  });
  const [tableTypeSort, setTableTypeSort] = useState<{ key: TableTypeSortKey; dir: SortDir }>({
    key: 'tableTypeName',
    dir: 'asc',
  });

  const { data: dbmsRows = [], isLoading: isLoadingDbms } = useQuery({
    queryKey: queryKeys.adminDbms,
    queryFn: () => apiFetchJson<DbmsRow[]>('/api/admin/classifiers/dbms'),
  });

  const { data: versionRows = [], isLoading: isLoadingVersions } = useQuery({
    queryKey: queryKeys.adminDbmsVersions,
    queryFn: () => apiFetchJson<DbmsVersionRow[]>('/api/admin/classifiers/dbms-versions'),
  });

  const { data: tableTypeRows = [], isLoading: isLoadingTableTypes } = useQuery({
    queryKey: queryKeys.adminTableTypes,
    queryFn: () => apiFetchJson<TableTypeRow[]>('/api/admin/classifiers/table-types'),
  });

  const dbmsOptions = useMemo(() => {
    const copy = [...dbmsRows];
    copy.sort((a, b) => a.dbms_name.localeCompare(b.dbms_name, undefined, { sensitivity: 'base' }));
    return copy;
  }, [dbmsRows]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDbms });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDbmsVersions });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDbmsVersionsActive });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminTableTypes });
  };

  const createDbmsMutation = useMutation({
    mutationFn: async (payload: {
      dbms_code: string;
      dbms_name: string;
      dbms_description: string | null;
      dbms_is_active: boolean;
    }) => {
      const res = await apiPost('/api/admin/classifiers/dbms', payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.createFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateDbmsMutation = useMutation({
    mutationFn: async (payload: {
      dbms_code: string;
      original_dbms_code?: string;
      dbms_name: string;
      dbms_description: string | null;
      dbms_is_active: boolean;
    }) => {
      const path = `/api/admin/classifiers/dbms/${encodeURIComponent(payload.original_dbms_code ?? payload.dbms_code)}`;
      const res = await apiPut(path, {
        dbms_code: payload.dbms_code,
        dbms_name: payload.dbms_name,
        dbms_description: payload.dbms_description,
        dbms_is_active: payload.dbms_is_active,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deactivateDbmsMutation = useMutation({
    mutationFn: async (payload: { dbms_code: string }) => {
      const res = await apiPost(
        `/api/admin/classifiers/dbms/${encodeURIComponent(payload.dbms_code)}/deactivate`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierDeactivated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activateDbmsMutation = useMutation({
    mutationFn: async (payload: { dbms_code: string }) => {
      const res = await apiPost(
        `/api/admin/classifiers/dbms/${encodeURIComponent(payload.dbms_code)}/activate`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDbmsMutation = useMutation({
    mutationFn: async (payload: { dbms_code: string }) => {
      const res = await apiDelete(
        `/api/admin/classifiers/dbms/${encodeURIComponent(payload.dbms_code)}`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierDeleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createVersionMutation = useMutation({
    mutationFn: async (payload: {
      dbms_code: string;
      version: string;
      dbms_version_description: string | null;
      dbms_version_is_active: boolean;
    }) => {
      const res = await apiPost('/api/admin/classifiers/dbms-versions', payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.createFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateVersionMutation = useMutation({
    mutationFn: async (payload: {
      dbms_code: string;
      dbms_version_id?: number;
      original_version?: string;
      version: string;
      dbms_version_description: string | null;
      dbms_version_is_active: boolean;
    }) => {
      const nextVersion = payload.version.trim();
      const originalVersion = (payload.original_version ?? payload.version).trim();

      const path =
        payload.dbms_version_id != null
          ? `/api/admin/classifiers/dbms-versions/by-id/${payload.dbms_version_id}`
          : `/api/admin/classifiers/dbms-versions/${encodeURIComponent(payload.dbms_code)}/${encodeURIComponent(originalVersion)}`;

      const body =
        payload.dbms_version_id != null
          ? {
              dbms_code: payload.dbms_code,
              version: nextVersion,
              dbms_version_description: payload.dbms_version_description,
              dbms_version_is_active: payload.dbms_version_is_active,
            }
          : {
              dbms_version_description: payload.dbms_version_description,
              dbms_version_is_active: payload.dbms_version_is_active,
            };

      const res = await apiPut(path, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deactivateVersionMutation = useMutation({
    mutationFn: async (payload: { dbms_code: string; version: string }) => {
      const path = `/api/admin/classifiers/dbms-versions/${encodeURIComponent(payload.dbms_code)}/${encodeURIComponent(payload.version)}`;
      const res = await apiDelete(path);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierDeactivated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleVersionActiveMutation = useMutation({
    mutationFn: async (payload: { dbms_code: string; version: string; nextActive: boolean }) => {
      const path = `/api/admin/classifiers/dbms-versions/${encodeURIComponent(payload.dbms_code)}/${encodeURIComponent(payload.version)}/${payload.nextActive ? 'activate' : 'deactivate'}`;
      const res = await apiPost(path, {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTableTypeMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      description: string | null;
      is_active: boolean;
    }) => {
      const res = await apiPost('/api/admin/classifiers/table-types', payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.createFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateTableTypeMutation = useMutation({
    mutationFn: async (payload: {
      table_type_id: number;
      name: string;
      description: string | null;
      is_active: boolean;
    }) => {
      const res = await apiPut(`/api/admin/classifiers/table-types/${payload.table_type_id}`, {
        name: payload.name,
        description: payload.description,
        is_active: payload.is_active,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTableTypeMutation = useMutation({
    mutationFn: async (payload: { table_type_id: number }) => {
      const res = await apiDelete(`/api/admin/classifiers/table-types/${payload.table_type_id}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierDeleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleTableTypeActiveMutation = useMutation({
    mutationFn: async (payload: { table_type_id: number; nextActive: boolean }) => {
      const path = `/api/admin/classifiers/table-types/${payload.table_type_id}/${payload.nextActive ? 'activate' : 'deactivate'}`;
      const res = await apiPost(path, {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'databases.updateFailed'));
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isSaving =
    createDbmsMutation.isPending ||
    updateDbmsMutation.isPending ||
    deactivateDbmsMutation.isPending ||
    activateDbmsMutation.isPending ||
    deleteDbmsMutation.isPending ||
    createVersionMutation.isPending ||
    updateVersionMutation.isPending ||
    deactivateVersionMutation.isPending ||
    toggleVersionActiveMutation.isPending ||
    createTableTypeMutation.isPending ||
    updateTableTypeMutation.isPending ||
    deleteTableTypeMutation.isPending ||
    toggleTableTypeActiveMutation.isPending;

  const searchQ = (search ?? '').trim().toLowerCase();

  const filteredDbms = useMemo(() => {
    if (!searchQ) return dbmsRows;
    return dbmsRows.filter((r) => {
      return (
        r.dbms_code.toLowerCase().includes(searchQ) ||
        r.dbms_name.toLowerCase().includes(searchQ) ||
        (r.dbms_description ?? '').toLowerCase().includes(searchQ)
      );
    });
  }, [dbmsRows, searchQ]);

  const filteredVersions = useMemo(() => {
    if (!searchQ) return versionRows;
    return versionRows.filter((r) => {
      return (
        r.dbms_code.toLowerCase().includes(searchQ) ||
        r.dbms_name.toLowerCase().includes(searchQ) ||
        r.version.toLowerCase().includes(searchQ) ||
        (r.dbms_version_description ?? '').toLowerCase().includes(searchQ)
      );
    });
  }, [searchQ, versionRows]);

  const filteredTableTypes = useMemo(() => {
    if (!searchQ) return tableTypeRows;
    return tableTypeRows.filter((r) => {
      return (
        r.name.toLowerCase().includes(searchQ) ||
        (r.description ?? '').toLowerCase().includes(searchQ)
      );
    });
  }, [searchQ, tableTypeRows]);

  const toggleDbmsSort = (key: DbmsSortKey) => {
    setDbmsSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  const toggleVersionSort = (key: VersionSortKey) => {
    setVersionSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  const toggleTableTypeSort = (key: TableTypeSortKey) => {
    setTableTypeSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  const sortIndicator = (active: boolean, dir: SortDir) => {
    if (!active) return <ArrowUpDown className="h-3 w-3 opacity-60" />;
    return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const sortedDbms = useMemo(() => {
    const dir = dbmsSort.dir === 'asc' ? 1 : -1;
    const copy = [...filteredDbms];
    const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });
    copy.sort((a, b) => {
      switch (dbmsSort.key) {
        case 'dbmsCode':
          return dir * cmp(a.dbms_code, b.dbms_code);
        case 'dbmsName':
          return dir * cmp(a.dbms_name, b.dbms_name);
        case 'dbmsActive':
          return dir * (Number(a.dbms_is_active) - Number(b.dbms_is_active));
        default:
          return 0;
      }
    });
    return copy;
  }, [dbmsSort, filteredDbms]);

  const sortedVersions = useMemo(() => {
    const dir = versionSort.dir === 'asc' ? 1 : -1;
    const copy = [...filteredVersions];
    const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });
    copy.sort((a, b) => {
      switch (versionSort.key) {
        case 'dbmsName':
          return dir * cmp(a.dbms_name, b.dbms_name);
        case 'dbmsCode':
          return dir * cmp(a.dbms_code, b.dbms_code);
        case 'version':
          return dir * cmp(a.version, b.version);
        case 'versionActive':
          return dir * (Number(a.dbms_version_is_active) - Number(b.dbms_version_is_active));
        default:
          return 0;
      }
    });
    return copy;
  }, [filteredVersions, versionSort]);

  const sortedTableTypes = useMemo(() => {
    const dir = tableTypeSort.dir === 'asc' ? 1 : -1;
    const copy = [...filteredTableTypes];
    const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });
    copy.sort((a, b) => {
      switch (tableTypeSort.key) {
        case 'tableTypeName':
          return dir * cmp(a.name, b.name);
        case 'tableTypeActive':
          return dir * (Number(a.is_active) - Number(b.is_active));
        default:
          return 0;
      }
    });
    return copy;
  }, [filteredTableTypes, tableTypeSort]);

  const openAddDbms = () =>
    setDbmsModal({
      open: true,
      mode: 'add',
      dbms_code: '',
      dbms_name: '',
      dbms_description: '',
      dbms_is_active: true,
    });

  const openEditDbms = (row: DbmsRow) =>
    setDbmsModal({
      open: true,
      mode: 'edit',
      dbms_code: row.dbms_code,
      original_dbms_code: row.dbms_code,
      dbms_name: row.dbms_name,
      dbms_description: row.dbms_description ?? '',
      dbms_is_active: row.dbms_is_active,
    });

  const closeDbmsModal = () => setDbmsModal({ open: false });

  const handleSaveDbms = async () => {
    if (!dbmsModal.open) return;
    const m = dbmsModal;
    const dbms_code = m.dbms_code.trim().toUpperCase();
    const dbms_name = m.dbms_name.trim();
    if (!dbms_code || !dbms_name) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    const dbms_description = m.dbms_description.trim() || null;
    try {
      if (m.mode === 'add') {
        await createDbmsMutation.mutateAsync({
          dbms_code,
          dbms_name,
          dbms_description,
          dbms_is_active: m.dbms_is_active,
        });
      } else {
        await updateDbmsMutation.mutateAsync({
          dbms_code,
          original_dbms_code: m.original_dbms_code,
          dbms_name,
          dbms_description,
          dbms_is_active: m.dbms_is_active,
        });
      }
      closeDbmsModal();
    } catch {
      /* toast from mutation */
    }
  };

  const openAddVersion = () => {
    const first = dbmsOptions[0];
    setVersionModal({
      open: true,
      mode: 'add',
      dbms_code: first?.dbms_code ?? '',
      version: '',
      dbms_version_description: '',
      dbms_version_is_active: true,
    });
  };

  const openEditVersion = (row: DbmsVersionRow) =>
    setVersionModal({
      open: true,
      mode: 'edit',
      dbms_code: row.dbms_code,
      dbms_version_id: row.dbms_version_id,
      original_version: row.version,
      version: row.version,
      dbms_version_description: row.dbms_version_description ?? '',
      dbms_version_is_active: row.dbms_version_is_active,
    });

  const closeVersionModal = () => setVersionModal({ open: false });

  const handleSaveVersion = async () => {
    if (!versionModal.open) return;
    const m = versionModal;
    const dbms_code = m.dbms_code.trim().toUpperCase();
    const version = m.version.trim();
    if (!dbms_code || !version) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    const dbms_version_description = m.dbms_version_description.trim() || null;
    try {
      if (m.mode === 'add') {
        await createVersionMutation.mutateAsync({
          dbms_code,
          version,
          dbms_version_description,
          dbms_version_is_active: m.dbms_version_is_active,
        });
      } else {
        await updateVersionMutation.mutateAsync({
          dbms_code,
          dbms_version_id: m.dbms_version_id,
          original_version: m.original_version,
          version,
          dbms_version_description,
          dbms_version_is_active: m.dbms_version_is_active,
        });
      }
      closeVersionModal();
    } catch {
      /* toast from mutation */
    }
  };

  const openAddTableType = () =>
    setTableTypeModal({
      open: true,
      mode: 'add',
      name: '',
      description: '',
      is_active: true,
    });

  const openEditTableType = (row: TableTypeRow) =>
    setTableTypeModal({
      open: true,
      mode: 'edit',
      table_type_id: row.table_type_id,
      name: row.name,
      description: row.description ?? '',
      is_active: row.is_active,
    });

  const closeTableTypeModal = () => setTableTypeModal({ open: false });

  const handleSaveTableType = async () => {
    if (!tableTypeModal.open) return;
    const m = tableTypeModal;
    const name = m.name.trim();
    if (!name) {
      toast.error(t('databases.fillRequired'));
      return;
    }
    const description = m.description.trim() || null;
    try {
      if (m.mode === 'add') {
        await createTableTypeMutation.mutateAsync({
          name,
          description,
          is_active: m.is_active,
        });
      } else if (m.table_type_id != null) {
        await updateTableTypeMutation.mutateAsync({
          table_type_id: m.table_type_id,
          name,
          description,
          is_active: m.is_active,
        });
      }
      closeTableTypeModal();
    } catch {
      /* toast from mutation */
    }
  };

  return (
    <div
      id={rootId}
      className={`mt-10 space-y-4 border-t border-border pt-8${rootId ? ' scroll-mt-24' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold">{t('databases.classifiers.title')}</h2>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-3xl">
            {t('databases.classifiers.intro')}
          </p>
        </div>
        {showAdminClassifiersLink && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: '/admin/classifiers' as any })}
            title={t('adminClassifiers.title')}
            className="shrink-0"
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            {t('adminClassifiers.openLink')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={tab === 'dbms' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('dbms')}
          className={tab === 'dbms' ? '' : ''}
        >
          {t('databases.classifiers.tabDbms')}
        </Button>
        <Button
          type="button"
          variant={tab === 'versions' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('versions')}
          className={tab === 'versions' ? '' : ''}
        >
          {t('databases.classifiers.tabVersions')}
        </Button>
        <Button
          type="button"
          variant={tab === 'tableTypes' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('tableTypes')}
        >
          {t('databases.classifiers.tabTableTypes')}
        </Button>

        <div className="flex-1 min-w-[14rem]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('databases.classifiers.search')}
          />
        </div>

        <Button
          type="button"
          size="sm"
          className="bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200"
          onClick={
            tab === 'dbms' ? openAddDbms : tab === 'versions' ? openAddVersion : openAddTableType
          }
          disabled={isSaving || (tab === 'versions' && dbmsOptions.length === 0)}
        >
          <Plus className="h-4 w-4 mr-1" />
          {tab === 'dbms'
            ? t('databases.classifiers.addDbms')
            : tab === 'versions'
              ? t('databases.classifiers.addDbmsVersion')
              : t('databases.classifiers.addTableType')}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        {tab === 'tableTypes' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('common.actions')}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleTableTypeSort('tableTypeName')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.tableTypeName')}
                    {sortIndicator(tableTypeSort.key === 'tableTypeName', tableTypeSort.dir)}
                  </button>
                </TableHead>
                <TableHead>{t('users.classifiers.description')}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleTableTypeSort('tableTypeActive')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.tableTypeActive')}
                    {sortIndicator(tableTypeSort.key === 'tableTypeActive', tableTypeSort.dir)}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingTableTypes ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : sortedTableTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {searchQ
                      ? t('databases.classifiers.noTableTypesForSearch')
                      : t('databases.classifiers.noTableTypes')}
                  </TableCell>
                </TableRow>
              ) : (
                sortedTableTypes.map((row) => (
                  <TableRow key={row.table_type_id}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-foreground"
                          onClick={() => openEditTableType(row)}
                          disabled={isSaving}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isSaving}
                          className={
                            row.is_active ? 'hover:text-destructive' : 'hover:text-foreground'
                          }
                          onClick={() =>
                            void toggleTableTypeActiveMutation.mutateAsync({
                              table_type_id: row.table_type_id,
                              nextActive: !row.is_active,
                            })
                          }
                          title={row.is_active ? t('common.deactivate') : t('common.activate')}
                        >
                          {row.is_active ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          disabled={isSaving}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('common.confirmation'),
                              message: t('users.classifiers.deleteConfirm'),
                              confirmText: t('common.delete'),
                              cancelText: t('common.cancel'),
                              destructive: true,
                            });
                            if (!ok) return;
                            void deleteTableTypeMutation.mutateAsync({
                              table_type_id: row.table_type_id,
                            });
                          }}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                      {(row.description ?? '').trim() || '—'}
                    </TableCell>
                    <TableCell>{row.is_active ? t('common.yes') : t('common.no')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : tab === 'dbms' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('common.actions')}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleDbmsSort('dbmsCode')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.dbmsCode')}
                    {sortIndicator(dbmsSort.key === 'dbmsCode', dbmsSort.dir)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleDbmsSort('dbmsName')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.dbmsName')}
                    {sortIndicator(dbmsSort.key === 'dbmsName', dbmsSort.dir)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleDbmsSort('dbmsActive')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.dbmsActive')}
                    {sortIndicator(dbmsSort.key === 'dbmsActive', dbmsSort.dir)}
                  </button>
                </TableHead>
                <TableHead>{t('users.classifiers.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingDbms ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : sortedDbms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t('users.noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                sortedDbms.map((row) => (
                  <TableRow key={row.dbms_code}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-foreground"
                          onClick={() => openEditDbms(row)}
                          disabled={isSaving}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isSaving}
                          className={
                            row.dbms_is_active ? 'hover:text-destructive' : 'hover:text-foreground'
                          }
                          onClick={() =>
                            row.dbms_is_active
                              ? void deactivateDbmsMutation.mutateAsync({
                                  dbms_code: row.dbms_code,
                                })
                              : void activateDbmsMutation.mutateAsync({ dbms_code: row.dbms_code })
                          }
                          title={row.dbms_is_active ? t('common.deactivate') : t('common.activate')}
                        >
                          {row.dbms_is_active ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          disabled={isSaving}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('common.confirmation'),
                              message: t('users.classifiers.deleteConfirm'),
                              confirmText: t('common.delete'),
                              cancelText: t('common.cancel'),
                              destructive: true,
                            });
                            if (!ok) return;
                            void deleteDbmsMutation.mutateAsync({ dbms_code: row.dbms_code });
                          }}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.dbms_code}</TableCell>
                    <TableCell>{row.dbms_name}</TableCell>
                    <TableCell>{row.dbms_is_active ? t('common.yes') : t('common.no')}</TableCell>
                    <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                      {(row.dbms_description ?? '').trim() || '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('common.actions')}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleVersionSort('dbmsName')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.dbmsName')}
                    {sortIndicator(versionSort.key === 'dbmsName', versionSort.dir)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleVersionSort('dbmsCode')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.dbmsCode')}
                    {sortIndicator(versionSort.key === 'dbmsCode', versionSort.dir)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleVersionSort('version')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.version')}
                    {sortIndicator(versionSort.key === 'version', versionSort.dir)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => toggleVersionSort('versionActive')}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {t('databases.classifiers.versionActive')}
                    {sortIndicator(versionSort.key === 'versionActive', versionSort.dir)}
                  </button>
                </TableHead>
                <TableHead>{t('users.classifiers.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingVersions ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : sortedVersions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t('users.noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                sortedVersions.map((row) => (
                  <TableRow key={`${row.dbms_code}:${row.version}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-foreground"
                          onClick={() => openEditVersion(row)}
                          disabled={isSaving}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isSaving}
                          className={
                            row.dbms_version_is_active
                              ? 'hover:text-destructive'
                              : 'hover:text-foreground'
                          }
                          onClick={() =>
                            void toggleVersionActiveMutation.mutateAsync({
                              dbms_code: row.dbms_code,
                              version: row.version,
                              nextActive: !row.dbms_version_is_active,
                            })
                          }
                          title={
                            row.dbms_version_is_active
                              ? t('common.deactivate')
                              : t('common.activate')
                          }
                        >
                          {row.dbms_version_is_active ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          disabled={isSaving}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('common.confirmation'),
                              message: t('users.classifiers.deleteConfirm'),
                              confirmText: t('common.delete'),
                              cancelText: t('common.cancel'),
                              destructive: true,
                            });
                            if (!ok) return;
                            void deactivateVersionMutation.mutateAsync({
                              dbms_code: row.dbms_code,
                              version: row.version,
                            });
                          }}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{row.dbms_name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.dbms_code}</TableCell>
                    <TableCell className="font-mono text-sm">{row.version}</TableCell>
                    <TableCell>
                      {row.dbms_version_is_active ? t('common.yes') : t('common.no')}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                      {(row.dbms_version_description ?? '').trim() || '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {dbmsModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold">
                {dbmsModal.mode === 'add'
                  ? t('databases.classifiers.addDbms')
                  : t('databases.classifiers.editDbms')}
              </h3>
              <Button type="button" variant="ghost" size="icon-sm" onClick={closeDbmsModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Field>
              <FieldLabel>
                {t('databases.classifiers.dbmsCode')} <RequiredMark />
              </FieldLabel>
              <Input
                value={dbmsModal.dbms_code}
                onChange={(e) =>
                  setDbmsModal((prev) =>
                    prev.open ? { ...prev, dbms_code: e.target.value.toUpperCase() } : prev
                  )
                }
                className="font-mono"
                maxLength={3}
                placeholder="ABC"
                disabled={isSaving}
              />
            </Field>

            <Field>
              <FieldLabel>
                {t('databases.classifiers.dbmsName')} <RequiredMark />
              </FieldLabel>
              <Input
                value={dbmsModal.dbms_name}
                onChange={(e) =>
                  setDbmsModal((prev) =>
                    prev.open ? { ...prev, dbms_name: e.target.value } : prev
                  )
                }
                maxLength={100}
                disabled={isSaving}
              />
            </Field>

            <Field>
              <FieldLabel>{t('users.classifiers.description')}</FieldLabel>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={dbmsModal.dbms_description}
                onChange={(e) =>
                  setDbmsModal((prev) =>
                    prev.open ? { ...prev, dbms_description: e.target.value } : prev
                  )
                }
                disabled={isSaving}
              />
            </Field>

            <div className="flex items-center gap-2">
              <Checkbox
                id="dbms-active"
                checked={dbmsModal.dbms_is_active}
                onCheckedChange={(v) =>
                  setDbmsModal((prev) =>
                    prev.open ? { ...prev, dbms_is_active: v === true } : prev
                  )
                }
                disabled={isSaving}
              />
              <Label htmlFor="dbms-active" className="text-sm font-normal cursor-pointer">
                {t('databases.classifiers.dbmsActive')}
              </Label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap gap-2">
                {dbmsModal.mode === 'edit' && dbmsModal.original_dbms_code ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSaving}
                    onClick={async () => {
                      const targetCode = dbmsModal.original_dbms_code!;
                      const ok = await confirm({
                        title: t('common.confirmation'),
                        message: t('databases.classifiers.deleteDbmsConfirm'),
                        confirmText: t('common.delete'),
                        cancelText: t('common.cancel'),
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await deleteDbmsMutation.mutateAsync({ dbms_code: targetCode });
                        closeDbmsModal();
                      } catch {
                        /* toast from mutation */
                      }
                    }}
                  >
                    {t('databases.classifiers.deleteDbms')}
                  </Button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDbmsModal}
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="button" disabled={isSaving} onClick={() => void handleSaveDbms()}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {versionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold">
                {versionModal.mode === 'add'
                  ? t('databases.classifiers.addDbmsVersion')
                  : t('databases.classifiers.editDbmsVersion')}
              </h3>
              <Button type="button" variant="ghost" size="icon-sm" onClick={closeVersionModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Field>
              <FieldLabel>
                {t('databases.classifiers.dbmsName')} <RequiredMark />
              </FieldLabel>
              <SearchableSelect
                value={versionModal.dbms_code}
                onChange={(next) =>
                  setVersionModal((prev) => (prev.open ? { ...prev, dbms_code: next } : prev))
                }
                options={dbmsOptions.map((d) => ({
                  value: d.dbms_code,
                  label: `${d.dbms_name} (${d.dbms_code})`,
                }))}
                placeholder={
                  dbmsOptions.length === 0 ? t('databases.classifiers.noDbms') : t('common.select')
                }
                disabled={isSaving || dbmsOptions.length === 0}
              />
            </Field>

            <Field>
              <FieldLabel>
                {t('databases.classifiers.version')} <RequiredMark />
              </FieldLabel>
              <Input
                value={versionModal.version}
                onChange={(e) =>
                  setVersionModal((prev) =>
                    prev.open ? { ...prev, version: e.target.value } : prev
                  )
                }
                className="font-mono"
                disabled={isSaving}
              />
            </Field>

            <Field>
              <FieldLabel>{t('users.classifiers.description')}</FieldLabel>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={versionModal.dbms_version_description}
                onChange={(e) =>
                  setVersionModal((prev) =>
                    prev.open ? { ...prev, dbms_version_description: e.target.value } : prev
                  )
                }
                disabled={isSaving}
              />
            </Field>

            <div className="flex items-center gap-2">
              <Checkbox
                id="dbms-version-active"
                checked={versionModal.dbms_version_is_active}
                onCheckedChange={(v) =>
                  setVersionModal((prev) =>
                    prev.open ? { ...prev, dbms_version_is_active: v === true } : prev
                  )
                }
                disabled={isSaving}
              />
              <Label htmlFor="dbms-version-active" className="text-sm font-normal cursor-pointer">
                {t('databases.classifiers.versionActive')}
              </Label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap gap-2">
                {versionModal.mode === 'edit' && versionModal.original_version ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSaving}
                    onClick={async () => {
                      const targetCode = versionModal.dbms_code;
                      const targetVersion = versionModal.original_version!;
                      const ok = await confirm({
                        title: t('common.confirmation'),
                        message: t('users.classifiers.deleteConfirm'),
                        confirmText: t('common.delete'),
                        cancelText: t('common.cancel'),
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await deactivateVersionMutation.mutateAsync({
                          dbms_code: targetCode,
                          version: targetVersion,
                        });
                        closeVersionModal();
                      } catch {
                        /* toast from mutation */
                      }
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeVersionModal}
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={isSaving || (versionModal.mode === 'add' && dbmsOptions.length === 0)}
                  onClick={() => void handleSaveVersion()}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tableTypeModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold">
                {tableTypeModal.mode === 'add'
                  ? t('databases.classifiers.addTableType')
                  : t('databases.classifiers.editTableType')}
              </h3>
              <Button type="button" variant="ghost" size="icon-sm" onClick={closeTableTypeModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Field>
              <FieldLabel>
                {t('databases.classifiers.tableTypeName')} <RequiredMark />
              </FieldLabel>
              <Input
                value={tableTypeModal.name}
                onChange={(e) =>
                  setTableTypeModal((prev) =>
                    prev.open ? { ...prev, name: e.target.value } : prev
                  )
                }
                maxLength={50}
                disabled={isSaving}
              />
            </Field>

            <Field>
              <FieldLabel>{t('users.classifiers.description')}</FieldLabel>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                maxLength={1000}
                value={tableTypeModal.description}
                onChange={(e) =>
                  setTableTypeModal((prev) =>
                    prev.open ? { ...prev, description: e.target.value } : prev
                  )
                }
                disabled={isSaving}
              />
            </Field>

            <div className="flex items-center gap-2">
              <Checkbox
                id="table-type-active"
                checked={tableTypeModal.is_active}
                onCheckedChange={(v) =>
                  setTableTypeModal((prev) =>
                    prev.open ? { ...prev, is_active: v === true } : prev
                  )
                }
                disabled={isSaving}
              />
              <Label htmlFor="table-type-active" className="text-sm font-normal cursor-pointer">
                {t('databases.classifiers.tableTypeActive')}
              </Label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap gap-2">
                {tableTypeModal.mode === 'edit' && tableTypeModal.table_type_id != null ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSaving}
                    onClick={async () => {
                      const id = tableTypeModal.table_type_id!;
                      const ok = await confirm({
                        title: t('common.confirmation'),
                        message: t('users.classifiers.deleteConfirm'),
                        confirmText: t('common.delete'),
                        cancelText: t('common.cancel'),
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await deleteTableTypeMutation.mutateAsync({ table_type_id: id });
                        closeTableTypeModal();
                      } catch {
                        /* toast from mutation */
                      }
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeTableTypeModal}
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveTableType()}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
