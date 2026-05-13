import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from '@/lib/toast';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Pencil,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Users,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { apiFetchJson, apiPost, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

type GroupRow = { user_group_code: string; user_group_name: string };

type DatabaseRow = { database_id: number; database_name: string };

type SchemaNode = {
  schema_id: number;
  name: string;
  tables: { table_id: number; name: string }[];
  views?: { view_id: number; name: string }[];
  materialized_views?: { view_id: number; name: string }[];
};
type ResourcesPayload = { database_id: number; schemas: SchemaNode[] };

type GrantRow = {
  user_group_code: string;
  user_group_name: string;
  resource_id: number;
  resource_type: 'DATABASE' | 'SCHEMA' | 'TABLE' | 'VIEW' | 'UNKNOWN';
  database_id: number | null;
  database_name: string | null;
  schema_id: number | null;
  schema_name: string | null;
  table_id: number | null;
  table_name: string | null;
  view_id: number | null;
  view_name: string | null;
};

type TreeResourceRemoverMeta = {
  resourceId: number;
  label: string;
  scope: 'DATABASE' | 'SCHEMA' | 'TABLE' | 'VIEW';
  databaseId: number;
  schemaId?: number;
};

function toScopeLabel(g: GrantRow): string {
  if (g.resource_type === 'DATABASE') return g.database_name ?? String(g.resource_id);
  if (g.resource_type === 'SCHEMA')
    return `${g.database_name ?? '—'} · ${g.schema_name ?? String(g.resource_id)}`;
  if (g.resource_type === 'TABLE')
    return `${g.database_name ?? '—'} · ${g.schema_name ?? '—'} · ${g.table_name ?? String(g.resource_id)}`;
  if (g.resource_type === 'VIEW')
    return `${g.database_name ?? '—'} · ${g.schema_name ?? '—'} · ${g.view_name ?? String(g.resource_id)} (view)`;
  return String(g.resource_id);
}

type AccessChip = {
  resource_id: number;
  label: string;
};

function stableCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

const TILE_STYLES: string[] = [
  'bg-gradient-to-br from-sky-500/15 to-indigo-500/15 hover:from-sky-500/20 hover:to-indigo-500/20',
  'bg-gradient-to-br from-emerald-500/15 to-teal-500/15 hover:from-emerald-500/20 hover:to-teal-500/20',
  'bg-gradient-to-br from-amber-500/15 to-orange-500/15 hover:from-amber-500/20 hover:to-orange-500/20',
  'bg-gradient-to-br from-fuchsia-500/15 to-pink-500/15 hover:from-fuchsia-500/20 hover:to-pink-500/20',
  'bg-gradient-to-br from-violet-500/15 to-purple-500/15 hover:from-violet-500/20 hover:to-purple-500/20',
  'bg-gradient-to-br from-cyan-500/15 to-sky-500/15 hover:from-cyan-500/20 hover:to-sky-500/20',
];

function tileStyleForId(id: number): string {
  const idx = Math.abs(id) % TILE_STYLES.length;
  return TILE_STYLES[idx]!;
}

function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function normGroupCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase();
}

function sortGroupCodes(codes: Iterable<string>, nameByCode: Map<string, string>): string[] {
  return [...codes].sort((a, b) => stableCompare(nameByCode.get(a) ?? a, nameByCode.get(b) ?? b));
}

export const Route = createFileRoute('/admin/data-access' as any)({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) throw redirect({ to: '/login' as any });

    let roles: { user_role_code: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      throw redirect({ to: '/login' as any });
    }
    const isAdmin = roles.some((r) => r.user_role_code === 'ADM');
    if (!isAdmin) throw redirect({ to: '/' as any });
  },
  component: AdminDataAccessPage,
});

export default function AdminDataAccessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: groups = [] } = useQuery({
    queryKey: queryKeys.adminGroups,
    queryFn: () => apiFetchJson<GroupRow[]>('/api/admin/groups'),
  });

  const { data: databases = [] } = useQuery({
    queryKey: queryKeys.adminDatabases,
    queryFn: () => apiFetchJson<DatabaseRow[]>('/api/admin/databases'),
  });

  const [databaseId, setDatabaseId] = useState<number | null>(null);
  const { data: resources } = useQuery({
    queryKey:
      databaseId != null
        ? queryKeys.adminDatabaseResources(databaseId)
        : ['admin-database-resources-none'],
    queryFn: () => apiFetchJson<ResourcesPayload>(`/api/admin/databases/${databaseId}/resources`),
    enabled: databaseId != null,
  });

  const [selectedSchemaIds, setSelectedSchemaIds] = useState<number[]>([]);
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([]);
  const [selectedViewIds, setSelectedViewIds] = useState<number[]>([]);
  const [selectedMaterializedViewIds, setSelectedMaterializedViewIds] = useState<number[]>([]);

  const selectedDb = useMemo(
    () => databases.find((d) => d.database_id === databaseId) ?? null,
    [databaseId, databases]
  );

  const tableItems = useMemo(() => {
    const items: {
      schema_id: number;
      schema_name: string;
      table_id: number;
      table_name: string;
    }[] = [];
    for (const s of resources?.schemas ?? []) {
      for (const tb of s.tables ?? []) {
        items.push({
          schema_id: s.schema_id,
          schema_name: s.name,
          table_id: tb.table_id,
          table_name: tb.name,
        });
      }
    }
    return items;
  }, [resources?.schemas]);

  const viewItems = useMemo(() => {
    const items: { schema_id: number; schema_name: string; view_id: number; view_name: string }[] =
      [];
    for (const s of resources?.schemas ?? []) {
      for (const v of s.views ?? []) {
        items.push({
          schema_id: s.schema_id,
          schema_name: s.name,
          view_id: v.view_id,
          view_name: v.name,
        });
      }
    }
    return items;
  }, [resources?.schemas]);

  const materializedViewItems = useMemo(() => {
    const items: { schema_id: number; schema_name: string; view_id: number; view_name: string }[] =
      [];
    for (const s of resources?.schemas ?? []) {
      for (const v of s.materialized_views ?? []) {
        items.push({
          schema_id: s.schema_id,
          schema_name: s.name,
          view_id: v.view_id,
          view_name: v.name,
        });
      }
    }
    return items;
  }, [resources?.schemas]);

  const selectedResourceIds: number[] = useMemo(() => {
    // If user picked only the database (no schema/table/view tiles), interpret it as "entire database" access.
    if (
      databaseId != null &&
      selectedSchemaIds.length === 0 &&
      selectedTableIds.length === 0 &&
      selectedViewIds.length === 0 &&
      selectedMaterializedViewIds.length === 0
    ) {
      return [databaseId];
    }
    return Array.from(
      new Set([
        ...selectedSchemaIds,
        ...selectedTableIds,
        ...selectedViewIds,
        ...selectedMaterializedViewIds,
      ])
    );
  }, [
    databaseId,
    selectedSchemaIds,
    selectedTableIds,
    selectedViewIds,
    selectedMaterializedViewIds,
  ]);

  const grantsResourceId: number | null =
    selectedResourceIds.length === 1 ? selectedResourceIds[0]! : null;

  const grantsKey = useMemo(() => {
    if (grantsResourceId == null) return 'none';
    return `resource:${grantsResourceId}`;
  }, [grantsResourceId]);

  const {
    data: grants = [],
    isFetching: fetchingGrants,
    refetch: refetchGrants,
  } = useQuery({
    queryKey:
      grantsResourceId != null
        ? queryKeys.adminDataAccessGrants(grantsKey)
        : ['admin-data-access-grants-none'],
    queryFn: () =>
      apiFetchJson<GrantRow[]>(`/api/admin/data-access/grants?resource_id=${grantsResourceId}`),
    enabled: grantsResourceId != null,
  });

  const { data: allGrants = [], isFetching: fetchingAllGrants } = useQuery({
    queryKey: queryKeys.adminDataAccessGrants('all'),
    queryFn: () => apiFetchJson<GrantRow[]>('/api/admin/data-access/grants'),
  });

  const dbResourcesQueries = useQueries({
    queries: databases.map((d) => ({
      queryKey: queryKeys.adminDatabaseResources(d.database_id),
      queryFn: () =>
        apiFetchJson<ResourcesPayload>(`/api/admin/databases/${d.database_id}/resources`),
    })),
  });

  const resourcesByDbId = useMemo(() => {
    const m = new Map<number, ResourcesPayload>();
    for (let i = 0; i < databases.length; i++) {
      const d = databases[i];
      const data = dbResourcesQueries[i]?.data;
      if (data) m.set(d.database_id, data);
    }
    return m;
  }, [databases, dbResourcesQueries]);

  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupCodes, setSelectedGroupCodes] = useState<string[]>([]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
    );
  }, [groupSearch, groups]);

  const visibleGroupCodes = useMemo(
    () => filteredGroups.map((g) => String(g.user_group_code).trim()).filter(Boolean),
    [filteredGroups]
  );
  const visibleSelectedGroupCount = useMemo(() => {
    if (visibleGroupCodes.length === 0) return 0;
    const s = new Set(selectedGroupCodes);
    let count = 0;
    for (const c of visibleGroupCodes) if (s.has(c)) count++;
    return count;
  }, [selectedGroupCodes, visibleGroupCodes]);
  const visibleAllGroupsSelected =
    visibleGroupCodes.length > 0 && visibleSelectedGroupCount === visibleGroupCodes.length;

  const [clientSqlDatabaseId, setClientSqlDatabaseId] = useState<number | null>(null);
  const [clientSqlGroupSearch, setClientSqlGroupSearch] = useState('');
  const [clientSqlSelectedGroupCodes, setClientSqlSelectedGroupCodes] = useState<string[]>([]);
  const [adminSqlDatabaseId, setAdminSqlDatabaseId] = useState<number | null>(null);

  const clientSqlFilteredGroups = useMemo(() => {
    const q = clientSqlGroupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
    );
  }, [clientSqlGroupSearch, groups]);

  const clientSqlVisibleGroupCodes = useMemo(
    () => clientSqlFilteredGroups.map((g) => String(g.user_group_code).trim()).filter(Boolean),
    [clientSqlFilteredGroups]
  );
  const clientSqlVisibleSelectedCount = useMemo(() => {
    if (clientSqlVisibleGroupCodes.length === 0) return 0;
    const s = new Set(clientSqlSelectedGroupCodes);
    let count = 0;
    for (const c of clientSqlVisibleGroupCodes) if (s.has(c)) count++;
    return count;
  }, [clientSqlSelectedGroupCodes, clientSqlVisibleGroupCodes]);
  const clientSqlVisibleAllSelected =
    clientSqlVisibleGroupCodes.length > 0 &&
    clientSqlVisibleSelectedCount === clientSqlVisibleGroupCodes.length;

  const groupNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const c = normGroupCode(g.user_group_code);
      if (!c) continue;
      m.set(c, String(g.user_group_name ?? '').trim());
    }
    for (const gr of allGrants) {
      const c = normGroupCode(gr.user_group_code);
      if (!c) continue;
      const n = String(gr.user_group_name ?? '').trim();
      if (n) m.set(c, n);
      else if (!m.has(c)) m.set(c, '');
    }
    return m;
  }, [groups, allGrants]);

  const accessMapsGlobal = useMemo(() => {
    const directDbByDbId = new Map<number, Set<string>>();
    const directSchema = new Map<number, Set<string>>();
    const directTable = new Map<number, Set<string>>();
    const directView = new Map<number, Set<string>>();

    for (const row of allGrants) {
      const code = normGroupCode(row.user_group_code);
      if (!code) continue;

      if (row.resource_type === 'DATABASE' && row.database_id != null) {
        let s = directDbByDbId.get(row.database_id);
        if (!s) {
          s = new Set();
          directDbByDbId.set(row.database_id, s);
        }
        s.add(code);
      } else if (row.resource_type === 'SCHEMA' && row.schema_id != null) {
        let s = directSchema.get(row.schema_id);
        if (!s) {
          s = new Set();
          directSchema.set(row.schema_id, s);
        }
        s.add(code);
      } else if (row.resource_type === 'TABLE' && row.table_id != null) {
        let s = directTable.get(row.table_id);
        if (!s) {
          s = new Set();
          directTable.set(row.table_id, s);
        }
        s.add(code);
      } else if (row.resource_type === 'VIEW' && row.view_id != null) {
        let s = directView.get(row.view_id);
        if (!s) {
          s = new Set();
          directView.set(row.view_id, s);
        }
        s.add(code);
      }
    }
    return { directDbByDbId, directSchema, directTable, directView };
  }, [allGrants]);

  const [treeResourceRemover, setTreeResourceRemover] = useState<TreeResourceRemoverMeta | null>(
    null
  );
  /** Group codes marked for removal in the tree resource modal; applied on Save. */
  const [treeRemoverPendingGroupCodes, setTreeRemoverPendingGroupCodes] = useState<string[]>([]);
  /** Group codes to grant direct access at the tree modal resource; applied on Save. */
  const [treeRemoverPendingAddGroupCodes, setTreeRemoverPendingAddGroupCodes] = useState<string[]>(
    []
  );
  const [treeRemoverGroupSearch, setTreeRemoverGroupSearch] = useState('');
  const [treeRemoverSaving, setTreeRemoverSaving] = useState(false);

  const treeRemoverDerived = useMemo(() => {
    if (!treeResourceRemover) return null;
    const { directDbByDbId, directSchema, directTable, directView } = accessMapsGlobal;
    const dbId = treeResourceRemover.databaseId;

    if (treeResourceRemover.scope === 'DATABASE') {
      const directDb = directDbByDbId.get(dbId) ?? new Set<string>();
      return {
        groups: sortGroupCodes(directDb, groupNameByCode),
        directCodes: new Set(directDb),
      };
    }

    if (treeResourceRemover.scope === 'SCHEMA') {
      const sid = treeResourceRemover.resourceId;
      const schemaDirect = directSchema.get(sid) ?? new Set<string>();
      return {
        groups: sortGroupCodes(schemaDirect, groupNameByCode),
        directCodes: new Set(schemaDirect),
      };
    }

    if (treeResourceRemover.scope === 'TABLE') {
      const tid = treeResourceRemover.resourceId;
      const tableDirect = directTable.get(tid) ?? new Set<string>();
      return {
        groups: sortGroupCodes(tableDirect, groupNameByCode),
        directCodes: new Set(tableDirect),
      };
    }

    const vid = treeResourceRemover.resourceId;
    const viewDirect = directView.get(vid) ?? new Set<string>();
    return {
      groups: sortGroupCodes(viewDirect, groupNameByCode),
      directCodes: new Set(viewDirect),
    };
  }, [treeResourceRemover, accessMapsGlobal, groupNameByCode]);

  const treeRemoverAddGroupCandidates = useMemo(() => {
    if (!treeResourceRemover || !treeRemoverDerived) return [];
    const q = treeRemoverGroupSearch.trim().toLowerCase();
    const direct = treeRemoverDerived.directCodes;
    const base = groups.filter((g) => !direct.has(normGroupCode(g.user_group_code)));
    if (!q) return base;
    return base.filter(
      (g) =>
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
    );
  }, [treeResourceRemover, treeRemoverDerived, groups, treeRemoverGroupSearch]);

  const visibleTreeRemoverAddGroupCodes = useMemo(
    () =>
      treeRemoverAddGroupCandidates.map((g) => normGroupCode(g.user_group_code)).filter(Boolean),
    [treeRemoverAddGroupCandidates]
  );
  const visibleTreeRemoverSelectedAddGroupCount = useMemo(() => {
    if (visibleTreeRemoverAddGroupCodes.length === 0) return 0;
    const s = new Set(treeRemoverPendingAddGroupCodes);
    let count = 0;
    for (const c of visibleTreeRemoverAddGroupCodes) if (s.has(c)) count++;
    return count;
  }, [treeRemoverPendingAddGroupCodes, visibleTreeRemoverAddGroupCodes]);
  const visibleTreeRemoverAllAddGroupsSelected =
    visibleTreeRemoverAddGroupCodes.length > 0 &&
    visibleTreeRemoverSelectedAddGroupCount === visibleTreeRemoverAddGroupCodes.length;

  useEffect(() => {
    setTreeRemoverPendingGroupCodes([]);
    setTreeRemoverPendingAddGroupCodes([]);
    setTreeRemoverGroupSearch('');
  }, [treeResourceRemover]);

  const closeTreeResourceRemover = () => {
    setTreeRemoverPendingGroupCodes([]);
    setTreeRemoverPendingAddGroupCodes([]);
    setTreeRemoverGroupSearch('');
    setTreeResourceRemover(null);
  };

  const openAdminSqlDialog = async (opts: { databaseId: number }) => {
    const { databaseId: dbId } = opts;
    setAdminSqlLoading(true);
    try {
      const res = await apiPost('/api/admin/data-access/admin-sql', {
        database_id: dbId,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'dataAccess.adminSqlFailed'));
      }
      const data = (await res.json()) as {
        sql: string;
        warnings?: string[];
        database_name: string;
        dbms_name: string | null;
        dbms_code: string;
        role_name: string;
      };
      setAdminSqlModal({
        sql: data.sql,
        warnings: data.warnings ?? [],
        databaseName: data.database_name,
        dbmsName: data.dbms_name,
        dbmsCode: data.dbms_code,
        roleName: data.role_name,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('dataAccess.adminSqlFailed'));
    } finally {
      setAdminSqlLoading(false);
    }
  };

  const saveTreeResourceRemoverChanges = async () => {
    if (!treeResourceRemover) return;
    const removes = treeRemoverPendingGroupCodes;
    const adds = treeRemoverPendingAddGroupCodes;
    if (removes.length === 0 && adds.length === 0) return;
    setTreeRemoverSaving(true);
    try {
      if (removes.length > 0) {
        const res = await apiPost('/api/admin/data-access/grants/bulk', {
          action: 'remove',
          user_group_codes: removes,
          resource_ids: [treeResourceRemover.resourceId],
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(formatApiErrorMessage(t, errorData, 'dataAccess.saveFailed'));
        }
      }
      if (adds.length > 0) {
        const res = await apiPost('/api/admin/data-access/grants/bulk', {
          action: 'add',
          user_group_codes: adds,
          resource_ids: [treeResourceRemover.resourceId],
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(formatApiErrorMessage(t, errorData, 'dataAccess.saveFailed'));
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-data-access-grants'] as any });
      toast.success(t('dataAccess.saved'));
      closeTreeResourceRemover();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('dataAccess.saveFailed'));
    } finally {
      setTreeRemoverSaving(false);
    }
  };

  const openClientSqlDialog = async (opts: {
    groupCodes: string[];
    databaseId: number;
    groupSummary: string;
  }) => {
    const { groupCodes, databaseId: dbId, groupSummary } = opts;
    if (groupCodes.length === 0) return;
    setClientSqlLoading(true);
    try {
      const res = await apiPost('/api/admin/data-access/client-sql', {
        user_group_codes: groupCodes,
        database_id: dbId,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'dataAccess.clientSqlFailed'));
      }
      const data = (await res.json()) as {
        sql: string;
        warnings?: string[];
        database_name: string;
        dbms_name: string | null;
        dbms_code: string;
      };
      setClientSqlModal({
        sql: data.sql,
        warnings: data.warnings ?? [],
        databaseName: data.database_name,
        dbmsName: data.dbms_name,
        dbmsCode: data.dbms_code,
        groupSummary,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('dataAccess.clientSqlFailed'));
    } finally {
      setClientSqlLoading(false);
    }
  };

  const bulkMutation = useMutation({
    mutationFn: async (payload: {
      action: 'add' | 'remove';
      groupCodes: string[];
      resourceIds: number[];
    }) => {
      const res = await apiPost('/api/admin/data-access/grants/bulk', {
        action: payload.action,
        user_group_codes: payload.groupCodes,
        resource_ids: payload.resourceIds,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'dataAccess.saveFailed'));
      }
      return res.json();
    },
    onSuccess: async () => {
      // Invalidate any grants query (single-scope table + all-groups overview)
      await queryClient.invalidateQueries({ queryKey: ['admin-data-access-grants'] as any });
      toast.success(t('dataAccess.saved'));
      setSelectedGroupCodes([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [overviewSelectedDbId, setOverviewSelectedDbId] = useState<number | null>(null);
  const [overviewMode, setOverviewMode] = useState<'database' | 'group'>('database');
  const [overviewSelectedGroupCode, setOverviewSelectedGroupCode] = useState<string>('');
  const [clientSqlModal, setClientSqlModal] = useState<{
    sql: string;
    warnings: string[];
    databaseName: string;
    dbmsName: string | null;
    dbmsCode: string;
    groupSummary: string;
  } | null>(null);
  const [clientSqlLoading, setClientSqlLoading] = useState(false);
  const [adminSqlModal, setAdminSqlModal] = useState<{
    sql: string;
    warnings: string[];
    databaseName: string;
    dbmsName: string | null;
    dbmsCode: string;
    roleName: string;
  } | null>(null);
  const [adminSqlLoading, setAdminSqlLoading] = useState(false);
  const [treeSchemaOpen, setTreeSchemaOpen] = useState<Record<number, boolean>>({});
  const [editingGroup, setEditingGroup] = useState<{ code: string; name: string } | null>(null);
  const [modalDatabaseId, setModalDatabaseId] = useState<number | null>(null);
  const [modalSelectedResourceIds, setModalSelectedResourceIds] = useState<number[]>([]);
  /** Access rows marked for removal; persisted when the user clicks Save in the group modal. */
  const [modalPendingRemoveResourceIds, setModalPendingRemoveResourceIds] = useState<number[]>([]);

  useEffect(() => {
    if (editingGroup) setModalPendingRemoveResourceIds([]);
  }, [editingGroup?.code]);

  const overviewSelectedGroup = useMemo(() => {
    const want = normGroupCode(overviewSelectedGroupCode);
    if (!want) return null;
    return groups.find((g) => normGroupCode(g.user_group_code) === want) ?? null;
  }, [groups, overviewSelectedGroupCode]);

  const overviewGroupGrants = useMemo(() => {
    const want = normGroupCode(overviewSelectedGroupCode);
    if (!want) return [];
    return allGrants.filter((g) => normGroupCode(g.user_group_code) === want);
  }, [allGrants, overviewSelectedGroupCode]);

  const overviewGroupTree = useMemo(() => {
    const byDb = new Map<
      number,
      {
        database_id: number;
        database_name: string;
        directDatabase: boolean;
        schemas: Map<
          number,
          {
            schema_id: number;
            schema_name: string;
            directSchema: boolean;
            tables: { table_id: number; table_name: string }[];
            views: { view_id: number; view_name: string }[];
          }
        >;
      }
    >();

    for (const row of overviewGroupGrants) {
      const dbId = row.database_id;
      if (dbId == null) continue;
      const dbName = String(row.database_name ?? '').trim() || String(dbId);

      let db = byDb.get(dbId);
      if (!db) {
        db = {
          database_id: dbId,
          database_name: dbName,
          directDatabase: false,
          schemas: new Map(),
        };
        byDb.set(dbId, db);
      }

      if (row.resource_type === 'DATABASE') {
        db.directDatabase = true;
        continue;
      }

      const schemaId = row.schema_id;
      if (schemaId == null) continue;
      const schemaName = String(row.schema_name ?? '').trim() || String(schemaId);

      let schema = db.schemas.get(schemaId);
      if (!schema) {
        schema = {
          schema_id: schemaId,
          schema_name: schemaName,
          directSchema: false,
          tables: [],
          views: [],
        };
        db.schemas.set(schemaId, schema);
      }

      if (row.resource_type === 'SCHEMA') {
        schema.directSchema = true;
        continue;
      }

      if (row.resource_type === 'TABLE' && row.table_id != null) {
        const name = String(row.table_name ?? '').trim() || String(row.table_id);
        schema.tables.push({ table_id: row.table_id, table_name: name });
        continue;
      }

      if (row.resource_type === 'VIEW' && row.view_id != null) {
        const name = String(row.view_name ?? '').trim() || String(row.view_id);
        schema.views.push({ view_id: row.view_id, view_name: name });
      }
    }

    const sorted = [...byDb.values()].sort((a, b) =>
      stableCompare(a.database_name, b.database_name)
    );
    return sorted.map((db) => {
      const schemas = [...db.schemas.values()]
        .sort((a, b) => stableCompare(a.schema_name, b.schema_name))
        .map((s) => ({
          ...s,
          tables: [...new Map(s.tables.map((t) => [t.table_id, t])).values()].sort((a, b) =>
            stableCompare(a.table_name, b.table_name)
          ),
          views: [...new Map(s.views.map((v) => [v.view_id, v])).values()].sort((a, b) =>
            stableCompare(a.view_name, b.view_name)
          ),
        }));

      return {
        ...db,
        schemas,
      };
    });
  }, [overviewGroupGrants]);

  const editingGroupChips: AccessChip[] = useMemo(() => {
    if (!editingGroup) return [];
    const want = normGroupCode(editingGroup.code);
    const rows = allGrants.filter((g) => normGroupCode(g.user_group_code) === want);
    const uniqueById = new Map<number, string>();
    for (const r of rows) {
      uniqueById.set(r.resource_id, toScopeLabel(r));
    }
    return Array.from(uniqueById.entries())
      .map(([resource_id, label]) => ({ resource_id, label }))
      .sort((a, b) => stableCompare(a.label, b.label));
  }, [allGrants, editingGroup]);

  const { data: modalResources } = useQuery({
    queryKey:
      modalDatabaseId != null
        ? queryKeys.adminDatabaseResources(modalDatabaseId)
        : ['admin-database-resources-modal-none'],
    queryFn: () =>
      apiFetchJson<ResourcesPayload>(`/api/admin/databases/${modalDatabaseId}/resources`),
    enabled: modalDatabaseId != null,
  });

  const modalSchemaItems = useMemo(() => {
    return (modalResources?.schemas ?? []).map((s) => ({
      resource_id: s.schema_id,
      label: s.name,
    }));
  }, [modalResources?.schemas]);

  const modalTableItems = useMemo(() => {
    const items: { resource_id: number; label: string }[] = [];
    for (const s of modalResources?.schemas ?? []) {
      for (const tb of s.tables ?? [])
        items.push({ resource_id: tb.table_id, label: `${s.name}.${tb.name}` });
    }
    return items;
  }, [modalResources?.schemas]);

  const modalViewItems = useMemo(() => {
    const items: { resource_id: number; label: string }[] = [];
    for (const s of modalResources?.schemas ?? []) {
      for (const v of s.views ?? [])
        items.push({ resource_id: v.view_id, label: `${s.name}.${v.name}` });
    }
    return items;
  }, [modalResources?.schemas]);

  const modalMaterializedViewItems = useMemo(() => {
    const items: { resource_id: number; label: string }[] = [];
    for (const s of modalResources?.schemas ?? []) {
      for (const v of s.materialized_views ?? []) {
        items.push({ resource_id: v.view_id, label: `${s.name}.${v.name}` });
      }
    }
    return items;
  }, [modalResources?.schemas]);

  const setDatabase = (nextId: number | null) => {
    setDatabaseId(nextId);
    setSelectedSchemaIds([]);
    setSelectedTableIds([]);
    setSelectedViewIds([]);
    setSelectedMaterializedViewIds([]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('dataAccess.title')} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => navigate({ to: '/users' as any })}
              >
                <Users className="h-4 w-4" />
                {t('dataAccess.openUserManagement')}
              </Button>
            </div>

            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void refetchGrants()}
              disabled={fetchingGrants || grantsResourceId == null}
              title={t('dataAccess.refresh')}
            >
              <RefreshCw className={`h-4 w-4 ${fetchingGrants ? 'animate-spin' : ''}`} />
              {t('dataAccess.refresh')}
            </Button>
          </div>

          <div
            id="data-access-resources-bulk-section"
            className="rounded-lg border border-border bg-card p-4 space-y-4 scroll-mt-24"
          >
            <div className="space-y-1">
              <div className="text-sm font-semibold">
                {t('dataAccess.resourcesAndGroupsSectionTitle')}
              </div>
              <div className="text-xs text-muted-foreground max-w-3xl">
                {t('dataAccess.resourcesAndGroupsSectionHint')}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.database')}</div>
                <select
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  value={databaseId ?? ''}
                  onChange={(e) => setDatabase(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('dataAccess.selectDatabase')}</option>
                  {databases.map((d) => (
                    <option key={d.database_id} value={d.database_id}>
                      {d.database_name}
                    </option>
                  ))}
                </select>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {selectedDb
                    ? t('dataAccess.selectedDatabase', { name: selectedDb.database_name })
                    : t('dataAccess.noDatabaseSelected')}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.schema')}</div>
                  {databaseId == null ? (
                    <div className="text-sm text-muted-foreground">
                      {t('dataAccess.selectDatabase')}
                    </div>
                  ) : (resources?.schemas ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(resources?.schemas ?? []).map((s) => {
                        const selected = selectedSchemaIds.includes(s.schema_id);
                        return (
                          <button
                            key={s.schema_id}
                            type="button"
                            onClick={() => {
                              let wasSelected = false;
                              setSelectedSchemaIds((prev) => {
                                wasSelected = prev.includes(s.schema_id);
                                return wasSelected
                                  ? prev.filter((id) => id !== s.schema_id)
                                  : [...prev, s.schema_id];
                              });
                              if (wasSelected) {
                                const tablesToRemove = new Set(
                                  (s.tables ?? []).map((tb) => tb.table_id)
                                );
                                const viewsToRemove = new Set(
                                  (s.views ?? []).map((v) => v.view_id)
                                );
                                const matviewsToRemove = new Set(
                                  (s.materialized_views ?? []).map((v) => v.view_id)
                                );
                                setSelectedTableIds((prev) =>
                                  prev.filter((id) => !tablesToRemove.has(id))
                                );
                                setSelectedViewIds((prev) =>
                                  prev.filter((id) => !viewsToRemove.has(id))
                                );
                                setSelectedMaterializedViewIds((prev) =>
                                  prev.filter((id) => !matviewsToRemove.has(id))
                                );
                              }
                            }}
                            disabled={bulkMutation.isPending}
                            aria-pressed={selected}
                            className={[
                              'px-3 py-1 rounded-md text-sm font-medium border transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              tileStyleForId(s.schema_id),
                              selected
                                ? 'ring-2 ring-primary border-primary/40'
                                : 'border-border hover:border-border/70',
                              bulkMutation.isPending ? 'opacity-60 cursor-not-allowed' : '',
                            ].join(' ')}
                            title={s.name}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.table')}</div>
                  {databaseId == null ? (
                    <div className="text-sm text-muted-foreground">
                      {t('dataAccess.selectDatabase')}
                    </div>
                  ) : tableItems.length === 0 &&
                    viewItems.length === 0 &&
                    materializedViewItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tableItems.map((tb) => {
                        const selected = selectedTableIds.includes(tb.table_id);
                        return (
                          <button
                            key={tb.table_id}
                            type="button"
                            onClick={() =>
                              setSelectedTableIds((prev) => {
                                if (prev.includes(tb.table_id))
                                  return prev.filter((id) => id !== tb.table_id);
                                return [...prev, tb.table_id];
                              })
                            }
                            disabled={bulkMutation.isPending}
                            aria-pressed={selected}
                            className={[
                              'px-3 py-1 rounded-md text-sm font-medium border transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              tileStyleForId(tb.table_id),
                              selected
                                ? 'ring-2 ring-primary border-primary/40'
                                : 'border-border hover:border-border/70',
                              bulkMutation.isPending ? 'opacity-60 cursor-not-allowed' : '',
                            ].join(' ')}
                            title={`${tb.schema_name} · ${tb.table_name}`}
                          >
                            <span className="opacity-70">{tb.schema_name}.</span>
                            {tb.table_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.view')}</div>
                  {databaseId == null ? (
                    <div className="text-sm text-muted-foreground">
                      {t('dataAccess.selectDatabase')}
                    </div>
                  ) : tableItems.length === 0 &&
                    viewItems.length === 0 &&
                    materializedViewItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                  ) : viewItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('dataAccess.noViews')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {viewItems.map((v) => {
                        const selected = selectedViewIds.includes(v.view_id);
                        return (
                          <button
                            key={v.view_id}
                            type="button"
                            onClick={() =>
                              setSelectedViewIds((prev) => {
                                if (prev.includes(v.view_id))
                                  return prev.filter((id) => id !== v.view_id);
                                return [...prev, v.view_id];
                              })
                            }
                            disabled={bulkMutation.isPending}
                            aria-pressed={selected}
                            className={[
                              'px-3 py-1 rounded-md text-sm font-medium border transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              tileStyleForId(v.view_id),
                              selected
                                ? 'ring-2 ring-primary border-primary/40'
                                : 'border-border hover:border-border/70',
                              bulkMutation.isPending ? 'opacity-60 cursor-not-allowed' : '',
                            ].join(' ')}
                            title={`${v.schema_name} · ${v.view_name}`}
                          >
                            <span className="opacity-70">{v.schema_name}.</span>
                            {v.view_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('dataAccess.materializedView')}
                  </div>
                  {databaseId == null ? (
                    <div className="text-sm text-muted-foreground">
                      {t('dataAccess.selectDatabase')}
                    </div>
                  ) : tableItems.length === 0 &&
                    viewItems.length === 0 &&
                    materializedViewItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                  ) : materializedViewItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t('dataAccess.noMaterializedViews')}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {materializedViewItems.map((v) => {
                        const selected = selectedMaterializedViewIds.includes(v.view_id);
                        return (
                          <button
                            key={v.view_id}
                            type="button"
                            onClick={() =>
                              setSelectedMaterializedViewIds((prev) => {
                                if (prev.includes(v.view_id))
                                  return prev.filter((id) => id !== v.view_id);
                                return [...prev, v.view_id];
                              })
                            }
                            disabled={bulkMutation.isPending}
                            aria-pressed={selected}
                            className={[
                              'px-3 py-1 rounded-md text-sm font-medium border transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              tileStyleForId(v.view_id),
                              selected
                                ? 'ring-2 ring-primary border-primary/40'
                                : 'border-border hover:border-border/70',
                              bulkMutation.isPending ? 'opacity-60 cursor-not-allowed' : '',
                            ].join(' ')}
                            title={`${v.schema_name} · ${v.view_name}`}
                          >
                            <span className="opacity-70">{v.schema_name}.</span>
                            {v.view_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-muted-foreground">
                  {selectedResourceIds.length === 0
                    ? t('dataAccess.scopeIncomplete')
                    : selectedResourceIds.length === 1
                      ? t('dataAccess.targetResourceId', { id: selectedResourceIds[0] })
                      : `${selectedResourceIds.length} selected`}
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{t('dataAccess.bulkTitle')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('dataAccess.bulkHint')}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {t('dataAccess.searchGroups')}
                    </div>
                    <Input
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder={t('dataAccess.searchGroupsPlaceholder')}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      {visibleGroupCodes.length > 0
                        ? `${visibleSelectedGroupCount}/${visibleGroupCodes.length}`
                        : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          bulkMutation.isPending ||
                          visibleGroupCodes.length === 0 ||
                          visibleAllGroupsSelected
                        }
                        onClick={() =>
                          setSelectedGroupCodes((prev) => {
                            const s = new Set(prev);
                            for (const c of visibleGroupCodes) s.add(c);
                            return Array.from(s);
                          })
                        }
                      >
                        {t('common.selectAll')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          bulkMutation.isPending ||
                          visibleGroupCodes.length === 0 ||
                          visibleSelectedGroupCount === 0
                        }
                        onClick={() =>
                          setSelectedGroupCodes((prev) => {
                            if (prev.length === 0) return prev;
                            const visible = new Set(visibleGroupCodes);
                            return prev.filter((c) => !visible.has(c));
                          })
                        }
                      >
                        {t('common.deselectAll')}
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-[22rem] overflow-y-auto rounded-md border border-border">
                    {filteredGroups.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {t('dataAccess.noGroups')}
                      </div>
                    ) : (
                      filteredGroups.map((g) => {
                        const checked = selectedGroupCodes.includes(g.user_group_code);
                        return (
                          <label
                            key={g.user_group_code}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-border/60 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <div className="truncate">{g.user_group_name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {g.user_group_code}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedGroupCodes((prev) =>
                                  e.target.checked
                                    ? [...prev, g.user_group_code]
                                    : prev.filter((c) => c !== g.user_group_code)
                                )
                              }
                              disabled={bulkMutation.isPending}
                            />
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      disabled={
                        bulkMutation.isPending ||
                        selectedGroupCodes.length === 0 ||
                        selectedResourceIds.length === 0
                      }
                      onClick={() =>
                        bulkMutation.mutate({
                          action: 'remove',
                          groupCodes: selectedGroupCodes,
                          resourceIds: selectedResourceIds,
                        })
                      }
                    >
                      {t('dataAccess.removeAccess')}
                    </Button>
                    <Button
                      disabled={
                        bulkMutation.isPending ||
                        selectedGroupCodes.length === 0 ||
                        selectedResourceIds.length === 0
                      }
                      onClick={() =>
                        bulkMutation.mutate({
                          action: 'add',
                          groupCodes: selectedGroupCodes,
                          resourceIds: selectedResourceIds,
                        })
                      }
                    >
                      {t('dataAccess.grantAccess')}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="p-4 border-b border-border">
                    <div className="text-sm font-semibold">{t('dataAccess.currentTitle')}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('dataAccess.currentHint')}
                    </div>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('dataAccess.group')}</TableHead>
                          <TableHead>{t('dataAccess.scope')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedResourceIds.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">
                              {t('dataAccess.selectTargetFirst')}
                            </TableCell>
                          </TableRow>
                        ) : selectedResourceIds.length > 1 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">
                              Select exactly 1 schema/table to view current grants.
                            </TableCell>
                          </TableRow>
                        ) : fetchingGrants ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">
                              {t('common.loading')}
                            </TableCell>
                          </TableRow>
                        ) : grants.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">
                              {t('dataAccess.noGrants')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          grants.map((g) => (
                            <TableRow key={`${g.user_group_code}:${g.resource_id}`}>
                              <TableCell className="whitespace-normal">
                                <div className="font-medium">{g.user_group_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {g.user_group_code}
                                </div>
                              </TableCell>
                              <TableCell className="whitespace-normal">
                                <div className="text-xs text-muted-foreground">
                                  {g.resource_type}
                                </div>
                                <div className="text-sm">{toScopeLabel(g)}</div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            id="data-access-admin-sql-section"
            className="rounded-lg border border-border bg-card p-4 space-y-4 scroll-mt-24"
          >
            <div className="space-y-1">
              <div className="text-sm font-semibold">{t('dataAccess.adminSqlSectionTitle')}</div>
              <div className="text-xs text-muted-foreground max-w-3xl">
                {t('dataAccess.adminSqlHint')}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-md">
                <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.database')}</div>
                <select
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  value={adminSqlDatabaseId ?? ''}
                  onChange={(e) =>
                    setAdminSqlDatabaseId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">{t('dataAccess.adminSqlSelectDatabase')}</option>
                  {databases.map((d) => (
                    <option key={d.database_id} value={d.database_id}>
                      {d.database_name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={adminSqlLoading || adminSqlDatabaseId == null}
                onClick={() => {
                  if (adminSqlDatabaseId == null) return;
                  void openAdminSqlDialog({ databaseId: adminSqlDatabaseId });
                }}
              >
                <Copy className="h-4 w-4" />
                {t('dataAccess.clientSqlGenerate')}
              </Button>
            </div>
          </div>

          <div
            id="data-access-client-sql-section"
            className="rounded-lg border border-border bg-card p-4 space-y-4 scroll-mt-24"
          >
            <div className="space-y-1">
              <div className="text-sm font-semibold">{t('dataAccess.clientSqlSectionTitle')}</div>
              <div className="text-xs text-muted-foreground max-w-3xl">
                {t('dataAccess.clientSqlHint')}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <div className="text-xs text-muted-foreground mb-1">{t('dataAccess.database')}</div>
                <select
                  className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  value={clientSqlDatabaseId ?? ''}
                  onChange={(e) =>
                    setClientSqlDatabaseId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">{t('dataAccess.clientSqlSelectDatabase')}</option>
                  {databases.map((d) => (
                    <option key={d.database_id} value={d.database_id}>
                      {d.database_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{t('dataAccess.searchGroups')}</div>
              <Input
                value={clientSqlGroupSearch}
                onChange={(e) => setClientSqlGroupSearch(e.target.value)}
                placeholder={t('dataAccess.searchGroupsPlaceholder')}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {clientSqlVisibleGroupCodes.length > 0
                  ? `${clientSqlVisibleSelectedCount}/${clientSqlVisibleGroupCodes.length}`
                  : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={clientSqlVisibleGroupCodes.length === 0 || clientSqlVisibleAllSelected}
                  onClick={() =>
                    setClientSqlSelectedGroupCodes((prev) => {
                      const s = new Set(prev);
                      for (const c of clientSqlVisibleGroupCodes) s.add(c);
                      return Array.from(s);
                    })
                  }
                >
                  {t('common.selectAll')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    clientSqlVisibleGroupCodes.length === 0 || clientSqlVisibleSelectedCount === 0
                  }
                  onClick={() =>
                    setClientSqlSelectedGroupCodes((prev) => {
                      if (prev.length === 0) return prev;
                      const visible = new Set(clientSqlVisibleGroupCodes);
                      return prev.filter((c) => !visible.has(c));
                    })
                  }
                >
                  {t('common.deselectAll')}
                </Button>
              </div>
            </div>

            <div className="max-h-[16rem] overflow-y-auto rounded-md border border-border">
              {clientSqlFilteredGroups.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('dataAccess.noGroups')}
                </div>
              ) : (
                clientSqlFilteredGroups.map((g) => {
                  const checked = clientSqlSelectedGroupCodes.includes(g.user_group_code);
                  return (
                    <label
                      key={g.user_group_code}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-border/60 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{g.user_group_name}</div>
                        <div className="text-[11px] text-muted-foreground">{g.user_group_code}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setClientSqlSelectedGroupCodes((prev) =>
                            e.target.checked
                              ? [...prev, g.user_group_code]
                              : prev.filter((c) => c !== g.user_group_code)
                          )
                        }
                      />
                    </label>
                  );
                })
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={
                  clientSqlLoading ||
                  clientSqlSelectedGroupCodes.length === 0 ||
                  clientSqlDatabaseId == null
                }
                onClick={() => {
                  if (clientSqlDatabaseId == null) return;
                  void openClientSqlDialog({
                    groupCodes: clientSqlSelectedGroupCodes,
                    databaseId: clientSqlDatabaseId,
                    groupSummary: clientSqlSelectedGroupCodes
                      .map((c) => groupNameByCode.get(c) ?? c)
                      .join(', '),
                  });
                }}
                title={
                  clientSqlDatabaseId == null
                    ? t('dataAccess.clientSqlNoDatabase')
                    : clientSqlSelectedGroupCodes.length === 0
                      ? t('dataAccess.clientSqlNoGroupsSelected')
                      : undefined
                }
              >
                <Copy className="h-4 w-4" />
                {t('dataAccess.clientSqlGenerate')}
              </Button>
            </div>
          </div>

          <div
            id="data-access-all-groups-section"
            className="rounded-lg border border-border bg-card overflow-visible scroll-mt-24"
          >
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">{t('dataAccess.allGroupsTitle')}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('dataAccess.allGroupsHint')}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="gap-2 shrink-0"
                  onClick={() => navigate({ to: '/databases' as any })}
                >
                  <Database className="h-4 w-4" />
                  {t('dataAccess.openDatabaseManagement')}
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-xs text-muted-foreground">
                  {t('dataAccess.overviewModeLabel')}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={overviewMode === 'database' ? 'default' : 'outline'}
                    onClick={() => setOverviewMode('database')}
                  >
                    {t('dataAccess.overviewModeByDatabase')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={overviewMode === 'group' ? 'default' : 'outline'}
                    onClick={() => setOverviewMode('group')}
                  >
                    {t('dataAccess.overviewModeByGroup')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {fetchingAllGrants && allGrants.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : databases.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t('databases.noConnectedDatabases')}
                </div>
              ) : overviewMode === 'database' ? (
                (() => {
                  const openTreeRemover = (meta: TreeResourceRemoverMeta) => {
                    setTreeResourceRemover(meta);
                  };

                  const renderTiles = (effective: Set<string>, ctxDbId: number) => {
                    const display = sortGroupCodes(effective, groupNameByCode);
                    if (display.length === 0) {
                      return (
                        <span className="text-xs text-muted-foreground">
                          {t('dataAccess.noAccess')}
                        </span>
                      );
                    }
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {display.map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => {
                              setEditingGroup({ code, name: groupNameByCode.get(code) ?? code });
                              setModalDatabaseId(ctxDbId);
                              setModalSelectedResourceIds([]);
                            }}
                            className={`px-2.5 py-0.5 rounded-md text-xs font-medium border border-border/60 transition-colors ${tileStyleForId(
                              hashStringToInt(code)
                            )} hover:opacity-90`}
                            title={code}
                          >
                            {groupNameByCode.get(code) ?? code}
                          </button>
                        ))}
                      </div>
                    );
                  };

                  const { directDbByDbId, directSchema, directTable, directView } =
                    accessMapsGlobal;
                  const sortedDbs = [...databases].sort((a, b) =>
                    stableCompare(a.database_name, b.database_name)
                  );

                  const buildSchemaBlocks = (db: (typeof databases)[number]) => {
                    const directDb = directDbByDbId.get(db.database_id) ?? new Set<string>();
                    const schemas = resourcesByDbId.get(db.database_id)?.schemas ?? [];

                    const schemaBlocks = schemas
                      .map((s) => {
                        const schemaDirectOnly = directSchema.get(s.schema_id) ?? new Set<string>();
                        const tables = s.tables ?? [];
                        const views = s.views ?? [];
                        const matviews = s.materialized_views ?? [];

                        return (
                          <div
                            key={`${db.database_id}:${s.schema_id}`}
                            className="rounded-md border border-border/60 bg-muted/20"
                          >
                            <div className="p-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 shrink-0 p-0"
                                  title={t('dataAccess.treeEditRemoveTitle')}
                                  onClick={() =>
                                    openTreeRemover({
                                      resourceId: s.schema_id,
                                      label: `${t('dataAccess.schema')}: ${s.name} (${db.database_name})`,
                                      scope: 'SCHEMA',
                                      databaseId: db.database_id,
                                    })
                                  }
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-sm font-medium hover:text-foreground shrink-0"
                                  onClick={() =>
                                    setTreeSchemaOpen((prev) => ({
                                      ...prev,
                                      [s.schema_id]: !(prev[s.schema_id] ?? false),
                                    }))
                                  }
                                >
                                  {(treeSchemaOpen[s.schema_id] ?? false) ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                  <span>
                                    {t('dataAccess.schema')}: {s.name}
                                  </span>
                                </button>
                                {renderTiles(schemaDirectOnly, db.database_id)}
                              </div>

                              {(treeSchemaOpen[s.schema_id] ?? false) ? (
                                <div className="ml-6 space-y-3 border-l border-border/60 pl-3">
                                  {tables.map((tb) => {
                                    const tableDirectOnly =
                                      directTable.get(tb.table_id) ?? new Set<string>();
                                    return (
                                      <div
                                        key={tb.table_id}
                                        className="flex flex-wrap items-center gap-2"
                                      >
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 shrink-0 p-0"
                                          title={t('dataAccess.treeEditRemoveTitle')}
                                          onClick={() =>
                                            openTreeRemover({
                                              resourceId: tb.table_id,
                                              label: `${s.name}.${tb.name} (${db.database_name})`,
                                              scope: 'TABLE',
                                              databaseId: db.database_id,
                                              schemaId: s.schema_id,
                                            })
                                          }
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                                          {t('dataAccess.table')}: {s.name}.{tb.name}
                                        </span>
                                        {renderTiles(tableDirectOnly, db.database_id)}
                                      </div>
                                    );
                                  })}
                                  {views.map((vw) => {
                                    const viewDirectOnly =
                                      directView.get(vw.view_id) ?? new Set<string>();
                                    return (
                                      <div
                                        key={vw.view_id}
                                        className="flex flex-wrap items-center gap-2"
                                      >
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 shrink-0 p-0"
                                          title={t('dataAccess.treeEditRemoveTitle')}
                                          onClick={() =>
                                            openTreeRemover({
                                              resourceId: vw.view_id,
                                              label: `${s.name}.${vw.name} (${db.database_name})`,
                                              scope: 'VIEW',
                                              databaseId: db.database_id,
                                              schemaId: s.schema_id,
                                            })
                                          }
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                                          {t('dataAccess.view')}: {s.name}.{vw.name}
                                        </span>
                                        {renderTiles(viewDirectOnly, db.database_id)}
                                      </div>
                                    );
                                  })}
                                  {matviews.map((vw) => {
                                    const viewDirectOnly =
                                      directView.get(vw.view_id) ?? new Set<string>();
                                    return (
                                      <div
                                        key={`mv:${vw.view_id}`}
                                        className="flex flex-wrap items-center gap-2"
                                      >
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 shrink-0 p-0"
                                          title={t('dataAccess.treeEditRemoveTitle')}
                                          onClick={() =>
                                            openTreeRemover({
                                              resourceId: vw.view_id,
                                              label: `${s.name}.${vw.name} (${db.database_name})`,
                                              scope: 'VIEW',
                                              databaseId: db.database_id,
                                              schemaId: s.schema_id,
                                            })
                                          }
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                                          {t('dataAccess.materializedView')}: {s.name}.{vw.name}
                                        </span>
                                        {renderTiles(viewDirectOnly, db.database_id)}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                      .filter(Boolean);

                    const schemaBlockList = schemaBlocks.filter(Boolean) as ReactElement[];
                    return { directDb, schemaBlockList, schemas };
                  };

                  const selectedDb =
                    overviewSelectedDbId != null
                      ? sortedDbs.find((d) => d.database_id === overviewSelectedDbId)
                      : null;
                  const treeData = selectedDb ? buildSchemaBlocks(selectedDb) : null;
                  const treeSchemasAllExpanded =
                    treeData != null &&
                    treeData.schemas.length > 0 &&
                    treeData.schemas.every((s) => treeSchemaOpen[s.schema_id] === true);

                  return (
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {t('dataAccess.selectDatabaseTile')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {sortedDbs.map((db) => {
                            const selected = overviewSelectedDbId === db.database_id;
                            return (
                              <button
                                key={db.database_id}
                                type="button"
                                onClick={() =>
                                  setOverviewSelectedDbId((prev) =>
                                    prev === db.database_id ? null : db.database_id
                                  )
                                }
                                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${tileStyleForId(
                                  db.database_id
                                )} ${
                                  selected
                                    ? 'ring-2 ring-primary border-primary/50'
                                    : 'border-border/60 hover:border-border'
                                }`}
                              >
                                {db.database_name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {overviewSelectedDbId != null && selectedDb && treeData ? (
                        <div className="rounded-md border border-border bg-card/50 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 pb-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 shrink-0 p-0"
                                title={t('dataAccess.treeEditRemoveTitle')}
                                onClick={() =>
                                  openTreeRemover({
                                    resourceId: selectedDb.database_id,
                                    label: `${t('dataAccess.database')}: ${selectedDb.database_name}`,
                                    scope: 'DATABASE',
                                    databaseId: selectedDb.database_id,
                                  })
                                }
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <span className="text-sm font-semibold shrink-0">
                                {t('dataAccess.database')}: {selectedDb.database_name}
                              </span>
                              {renderTiles(treeData.directDb, selectedDb.database_id)}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={treeData.schemas.length === 0}
                                title={
                                  treeSchemasAllExpanded
                                    ? t('dataAccess.treeCloseAll')
                                    : t('dataAccess.treeOpenAll')
                                }
                                onClick={() => {
                                  const expand = !treeSchemasAllExpanded;
                                  setTreeSchemaOpen((prev) => {
                                    const next = { ...prev };
                                    for (const s of treeData.schemas) next[s.schema_id] = expand;
                                    return next;
                                  });
                                }}
                              >
                                {treeSchemasAllExpanded ? (
                                  <ToggleLeft className="h-4 w-4 mr-1" />
                                ) : (
                                  <ToggleRight className="h-4 w-4 mr-1" />
                                )}
                                {treeSchemasAllExpanded
                                  ? t('dataAccess.treeCloseAll')
                                  : t('dataAccess.treeOpenAll')}
                              </Button>
                            </div>
                          </div>
                          {treeData.schemaBlockList.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              {t('users.noResults')}
                            </div>
                          ) : (
                            <div className="space-y-2">{treeData.schemaBlockList}</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-1 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        {t('dataAccess.byGroupSelectGroup')}
                      </div>
                      <SearchableSelect
                        value={overviewSelectedGroupCode}
                        onChange={(raw) =>
                          setOverviewSelectedGroupCode(raw ? normGroupCode(raw) : '')
                        }
                        options={groups
                          .slice()
                          .sort((a, b) => stableCompare(a.user_group_name, b.user_group_name))
                          .map((g) => ({
                            value: normGroupCode(g.user_group_code),
                            label: `${g.user_group_name} (${normGroupCode(g.user_group_code)})`,
                          }))}
                        placeholder={t('dataAccess.byGroupSelectGroupPlaceholder')}
                        allowClear
                      />
                    </div>

                    <div className="lg:col-span-2 space-y-3">
                      <div className="text-xs text-muted-foreground">
                        {t('dataAccess.byGroupHint')}
                      </div>

                      {!overviewSelectedGroup ? (
                        <div className="text-sm text-muted-foreground">
                          {t('dataAccess.byGroupNoGroupSelected')}
                        </div>
                      ) : overviewGroupTree.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          {t('dataAccess.noAccess')}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {overviewGroupTree.map((db) => (
                            <div
                              key={db.database_id}
                              className="rounded-md border border-border/60 bg-card/50 p-3 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-semibold">
                                  {t('dataAccess.database')}: {db.database_name}
                                </div>
                                {db.directDatabase ? (
                                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/60">
                                    {t('dataAccess.scopeDatabase')}
                                  </span>
                                ) : null}
                              </div>

                              {db.schemas.length === 0 ? (
                                <div className="text-sm text-muted-foreground">
                                  {t('dataAccess.noAccess')}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {db.schemas.map((s) => (
                                    <div
                                      key={s.schema_id}
                                      className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-sm font-medium">
                                          {t('dataAccess.schema')}: {s.schema_name}
                                        </div>
                                        {s.directSchema ? (
                                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/60">
                                            {t('dataAccess.scopeSchema')}
                                          </span>
                                        ) : null}
                                      </div>

                                      {s.tables.length === 0 && s.views.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">
                                          {t('dataAccess.noAccess')}
                                        </div>
                                      ) : (
                                        <div className="space-y-2">
                                          {s.tables.length > 0 ? (
                                            <div className="space-y-1">
                                              <div className="text-xs text-muted-foreground">
                                                {t('dataAccess.table')}
                                              </div>
                                              <div className="flex flex-wrap gap-1.5">
                                                {s.tables.map((tb) => (
                                                  <span
                                                    key={tb.table_id}
                                                    className={`px-2.5 py-0.5 rounded-md text-xs font-medium border border-border/60 ${tileStyleForId(
                                                      tb.table_id
                                                    )}`}
                                                    title={tb.table_name}
                                                  >
                                                    {tb.table_name}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}

                                          {s.views.length > 0 ? (
                                            <div className="space-y-1">
                                              <div className="text-xs text-muted-foreground">
                                                {t('dataAccess.view')}
                                              </div>
                                              <div className="flex flex-wrap gap-1.5">
                                                {s.views.map((vw) => (
                                                  <span
                                                    key={vw.view_id}
                                                    className={`px-2.5 py-0.5 rounded-md text-xs font-medium border border-border/60 ${tileStyleForId(
                                                      vw.view_id
                                                    )}`}
                                                    title={vw.view_name}
                                                  >
                                                    {vw.view_name}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {editingGroup ? (
            <div className="fixed inset-0 backdrop-blur-sm bg-background/80 flex items-center justify-center z-50 p-4">
              <div className="bg-card border border-border rounded-lg shadow-xl max-w-3xl w-full overflow-hidden">
                <div className="flex items-center justify-between p-6 border-b border-border">
                  <div>
                    <div className="text-lg font-semibold">{editingGroup.name}</div>
                    <div className="text-sm text-muted-foreground">{editingGroup.code}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setModalPendingRemoveResourceIds([]);
                      setEditingGroup(null);
                    }}
                    className="p-1"
                    title={t('common.closeSettings')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">{t('dataAccess.accesses')}</div>
                    {editingGroupChips.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t('dataAccess.noAccess')}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {editingGroupChips.map((chip) => {
                          const pendingRemove = modalPendingRemoveResourceIds.includes(
                            chip.resource_id
                          );
                          return (
                            <span
                              key={chip.resource_id}
                              className={`px-3 py-1 rounded-md text-sm font-medium flex items-center gap-1 bg-muted text-foreground border border-transparent ${
                                pendingRemove
                                  ? 'opacity-60 line-through ring-1 ring-destructive/35'
                                  : ''
                              }`}
                            >
                              {chip.label}
                              <button
                                type="button"
                                onClick={() =>
                                  setModalPendingRemoveResourceIds((prev) =>
                                    prev.includes(chip.resource_id)
                                      ? prev.filter((id) => id !== chip.resource_id)
                                      : [...prev, chip.resource_id]
                                  )
                                }
                                className="ml-1 hover:bg-muted/80 rounded-full p-0.5 transition-colors flex-shrink-0"
                                disabled={bulkMutation.isPending}
                                title={
                                  pendingRemove
                                    ? t('dataAccess.undoRemoveMark')
                                    : t('dataAccess.markRemoveOnSave')
                                }
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      {t('dataAccess.selectResourcesTitle')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('dataAccess.selectResourcesHint')}
                    </div>

                    <div className="grid gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          {t('dataAccess.database')}
                        </div>
                        <SearchableSelect
                          value={modalDatabaseId != null ? String(modalDatabaseId) : ''}
                          onChange={(raw) => {
                            const next = raw ? Number(raw) : null;
                            setModalDatabaseId(next);
                            setModalSelectedResourceIds([]);
                          }}
                          options={databases.map((d) => ({
                            value: String(d.database_id),
                            label: d.database_name,
                          }))}
                          placeholder={t('dataAccess.selectDatabase')}
                          allowClear
                        />
                      </div>

                      {modalDatabaseId == null ? (
                        <div className="text-sm text-muted-foreground">
                          {t('dataAccess.selectDatabase')}
                        </div>
                      ) : modalResources == null ? (
                        <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              {t('dataAccess.schema')}
                            </div>
                            {modalSchemaItems.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                {t('common.loading')}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {modalSchemaItems.map((it) => {
                                  const isSelected = modalSelectedResourceIds.includes(
                                    it.resource_id
                                  );
                                  return (
                                    <button
                                      key={it.resource_id}
                                      type="button"
                                      onClick={() =>
                                        setModalSelectedResourceIds((prev) =>
                                          prev.includes(it.resource_id)
                                            ? prev.filter((id) => id !== it.resource_id)
                                            : [...prev, it.resource_id]
                                        )
                                      }
                                      className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${tileStyleForId(
                                        it.resource_id
                                      )} ${
                                        isSelected
                                          ? 'ring-2 ring-primary border-primary/40'
                                          : 'hover:bg-muted/80 border-border/60'
                                      }`}
                                      disabled={bulkMutation.isPending}
                                      title={it.label}
                                    >
                                      {it.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              {t('dataAccess.table')}
                            </div>
                            {modalTableItems.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                {t('dataAccess.noTableResources')}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {modalTableItems.map((it) => {
                                  const isSelected = modalSelectedResourceIds.includes(
                                    it.resource_id
                                  );
                                  return (
                                    <button
                                      key={it.resource_id}
                                      type="button"
                                      onClick={() =>
                                        setModalSelectedResourceIds((prev) =>
                                          prev.includes(it.resource_id)
                                            ? prev.filter((id) => id !== it.resource_id)
                                            : [...prev, it.resource_id]
                                        )
                                      }
                                      className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${tileStyleForId(
                                        it.resource_id
                                      )} ${
                                        isSelected
                                          ? 'ring-2 ring-primary border-primary/40'
                                          : 'hover:bg-muted/80 border-border/60'
                                      }`}
                                      disabled={bulkMutation.isPending}
                                      title={it.label}
                                    >
                                      {it.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              {t('dataAccess.view')}
                            </div>
                            {modalViewItems.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                {t('dataAccess.noViews')}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {modalViewItems.map((it) => {
                                  const isSelected = modalSelectedResourceIds.includes(
                                    it.resource_id
                                  );
                                  return (
                                    <button
                                      key={it.resource_id}
                                      type="button"
                                      onClick={() =>
                                        setModalSelectedResourceIds((prev) =>
                                          prev.includes(it.resource_id)
                                            ? prev.filter((id) => id !== it.resource_id)
                                            : [...prev, it.resource_id]
                                        )
                                      }
                                      className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${tileStyleForId(
                                        it.resource_id
                                      )} ${
                                        isSelected
                                          ? 'ring-2 ring-primary border-primary/40'
                                          : 'hover:bg-muted/80 border-border/60'
                                      }`}
                                      disabled={bulkMutation.isPending}
                                      title={it.label}
                                    >
                                      {it.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              {t('dataAccess.materializedView')}
                            </div>
                            {modalMaterializedViewItems.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                {t('dataAccess.noMaterializedViews')}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {modalMaterializedViewItems.map((it) => {
                                  const isSelected = modalSelectedResourceIds.includes(
                                    it.resource_id
                                  );
                                  return (
                                    <button
                                      key={it.resource_id}
                                      type="button"
                                      onClick={() =>
                                        setModalSelectedResourceIds((prev) =>
                                          prev.includes(it.resource_id)
                                            ? prev.filter((id) => id !== it.resource_id)
                                            : [...prev, it.resource_id]
                                        )
                                      }
                                      className={`px-3 py-1 rounded-md text-sm font-medium flex items-center transition-colors border border-transparent ${tileStyleForId(
                                        it.resource_id
                                      )} ${
                                        isSelected
                                          ? 'ring-2 ring-primary border-primary/40'
                                          : 'hover:bg-muted/80 border-border/60'
                                      }`}
                                      disabled={bulkMutation.isPending}
                                      title={it.label}
                                    >
                                      {it.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 pt-4 mt-4 border-t border-border sm:flex-row sm:flex-wrap sm:justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-2 w-full sm:w-auto sm:mr-auto"
                        disabled={
                          bulkMutation.isPending || clientSqlLoading || modalDatabaseId == null
                        }
                        onClick={() =>
                          editingGroup
                            ? void openClientSqlDialog({
                                groupCodes: [editingGroup.code],
                                databaseId: modalDatabaseId!,
                                groupSummary: editingGroup.name,
                              })
                            : undefined
                        }
                      >
                        <Copy className="h-4 w-4" />
                        {t('dataAccess.clientSqlGenerate')}
                      </Button>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setModalPendingRemoveResourceIds([]);
                            setEditingGroup(null);
                            setModalSelectedResourceIds([]);
                          }}
                          disabled={bulkMutation.isPending}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            bulkMutation.isPending || modalPendingRemoveResourceIds.length === 0
                          }
                          onClick={() =>
                            bulkMutation.mutate(
                              {
                                action: 'remove',
                                groupCodes: [editingGroup.code],
                                resourceIds: modalPendingRemoveResourceIds,
                              },
                              {
                                onSuccess: () => setModalPendingRemoveResourceIds([]),
                              }
                            )
                          }
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          disabled={bulkMutation.isPending || modalDatabaseId == null}
                          onClick={() =>
                            bulkMutation.mutate({
                              action: 'add',
                              groupCodes: [editingGroup.code],
                              resourceIds:
                                modalSelectedResourceIds.length > 0
                                  ? modalSelectedResourceIds
                                  : [modalDatabaseId!],
                            })
                          }
                        >
                          {t('dataAccess.grantAccess')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {treeResourceRemover ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tree-resource-remover-title"
              onMouseDown={(e) => {
                if (e.currentTarget !== e.target) return;
                if (treeRemoverSaving) return;
                closeTreeResourceRemover();
              }}
            >
              <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
                  <h3
                    id="tree-resource-remover-title"
                    className="text-base font-semibold leading-tight"
                  >
                    {treeResourceRemover.label}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 shrink-0"
                    onClick={closeTreeResourceRemover}
                    disabled={treeRemoverSaving}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-4 text-xs text-muted-foreground border-b border-border">
                  {t('dataAccess.treeEditAccessHint')}
                </div>
                <div className="p-4 overflow-y-auto space-y-6 flex-1 min-h-0">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      {t('dataAccess.treeModalCurrentAccess')}
                    </div>
                    {!treeRemoverDerived || treeRemoverDerived.groups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('dataAccess.treeNoGroupsWithAccess')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {treeRemoverDerived.groups.map((code) => {
                          const hasDirect = treeRemoverDerived.directCodes.has(code);
                          const canRemove = hasDirect;
                          const pendingRemove = treeRemoverPendingGroupCodes.includes(code);
                          return (
                            <div
                              key={code}
                              className={`flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm ${
                                pendingRemove ? 'opacity-60 ring-1 ring-destructive/35' : ''
                              }`}
                            >
                              <div className={`min-w-0 ${pendingRemove ? 'line-through' : ''}`}>
                                <div className="font-medium truncate">
                                  {groupNameByCode.get(code) ?? code}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">{code}</div>
                                {!hasDirect ? (
                                  <div className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                                    {t('dataAccess.accessInheritedOnly')}
                                  </div>
                                ) : null}
                              </div>
                              {canRemove ? (
                                <button
                                  type="button"
                                  disabled={treeRemoverSaving}
                                  title={
                                    pendingRemove
                                      ? t('dataAccess.undoRemoveMark')
                                      : t('dataAccess.treeRemoveWithXHint')
                                  }
                                  onClick={() =>
                                    setTreeRemoverPendingGroupCodes((prev) =>
                                      prev.includes(code)
                                        ? prev.filter((c) => c !== code)
                                        : [...prev, code]
                                    )
                                  }
                                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      {t('dataAccess.treeModalAddGroups')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('dataAccess.treeModalAddGroupsHint')}
                    </div>
                    <Input
                      value={treeRemoverGroupSearch}
                      onChange={(e) => setTreeRemoverGroupSearch(e.target.value)}
                      placeholder={t('dataAccess.searchGroupsPlaceholder')}
                      disabled={treeRemoverSaving}
                      className="h-9"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {visibleTreeRemoverAddGroupCodes.length > 0
                          ? `${visibleTreeRemoverSelectedAddGroupCount}/${visibleTreeRemoverAddGroupCodes.length}`
                          : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            treeRemoverSaving ||
                            visibleTreeRemoverAddGroupCodes.length === 0 ||
                            visibleTreeRemoverAllAddGroupsSelected
                          }
                          onClick={() =>
                            setTreeRemoverPendingAddGroupCodes((prev) => {
                              const s = new Set(prev);
                              for (const c of visibleTreeRemoverAddGroupCodes) s.add(c);
                              return Array.from(s);
                            })
                          }
                        >
                          {t('common.selectAll')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            treeRemoverSaving ||
                            visibleTreeRemoverAddGroupCodes.length === 0 ||
                            visibleTreeRemoverSelectedAddGroupCount === 0
                          }
                          onClick={() =>
                            setTreeRemoverPendingAddGroupCodes((prev) => {
                              if (prev.length === 0) return prev;
                              const visible = new Set(visibleTreeRemoverAddGroupCodes);
                              return prev.filter((c) => !visible.has(c));
                            })
                          }
                        >
                          {t('common.deselectAll')}
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                      {treeRemoverAddGroupCandidates.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {t('dataAccess.noGroups')}
                        </div>
                      ) : (
                        treeRemoverAddGroupCandidates.map((g) => {
                          const codeNorm = normGroupCode(g.user_group_code);
                          const checked = treeRemoverPendingAddGroupCodes.includes(codeNorm);
                          return (
                            <label
                              key={g.user_group_code}
                              className="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-border/60 last:border-b-0 cursor-pointer hover:bg-muted/40"
                            >
                              <div className="min-w-0">
                                <div className="truncate">{g.user_group_name}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {g.user_group_code}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={treeRemoverSaving}
                                onChange={(e) =>
                                  setTreeRemoverPendingAddGroupCodes((prev) =>
                                    e.target.checked
                                      ? [...prev, codeNorm]
                                      : prev.filter((c) => c !== codeNorm)
                                  )
                                }
                              />
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-border flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeTreeResourceRemover}
                    disabled={treeRemoverSaving}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      treeRemoverSaving ||
                      (treeRemoverPendingGroupCodes.length === 0 &&
                        treeRemoverPendingAddGroupCodes.length === 0)
                    }
                    onClick={() => void saveTreeResourceRemoverChanges()}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {clientSqlModal ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="client-sql-title"
              onMouseDown={(e) => {
                if (e.currentTarget !== e.target) return;
                setClientSqlModal(null);
              }}
            >
              <div className="bg-card border border-border rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
                  <div className="min-w-0">
                    <h3 id="client-sql-title" className="text-base font-semibold">
                      {t('dataAccess.clientSqlTitle')}
                    </h3>
                    <div className="text-sm text-muted-foreground mt-1">
                      {clientSqlModal.databaseName}
                      {clientSqlModal.dbmsName ? ` · ${clientSqlModal.dbmsName}` : ''}
                      {clientSqlModal.dbmsCode ? ` (${clientSqlModal.dbmsCode})` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t('dataAccess.clientSqlGroups')}: {clientSqlModal.groupSummary}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 shrink-0"
                    onClick={() => setClientSqlModal(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {clientSqlModal.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 space-y-1">
                      <div className="font-medium">{t('dataAccess.clientSqlWarnings')}</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {clientSqlModal.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <textarea
                    readOnly
                    value={clientSqlModal.sql}
                    className="flex-1 min-h-[240px] w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed resize-y"
                  />
                  <div className="flex flex-wrap justify-end gap-2 shrink-0">
                    <Button type="button" variant="outline" onClick={() => setClientSqlModal(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      className="gap-2"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(clientSqlModal.sql);
                          toast.success(t('dataAccess.clientSqlCopied'));
                        } catch {
                          toast.error(t('dataAccess.clientSqlCopyFailed'));
                        }
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      {t('dataAccess.clientSqlCopy')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {adminSqlModal ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-sql-title"
              onMouseDown={(e) => {
                if (e.currentTarget !== e.target) return;
                setAdminSqlModal(null);
              }}
            >
              <div className="bg-card border border-border rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
                  <div className="min-w-0">
                    <h3 id="admin-sql-title" className="text-base font-semibold">
                      {t('dataAccess.adminSqlTitle')}
                    </h3>
                    <div className="text-sm text-muted-foreground mt-1">
                      {adminSqlModal.databaseName}
                      {adminSqlModal.dbmsName ? ` · ${adminSqlModal.dbmsName}` : ''}
                      {adminSqlModal.dbmsCode ? ` (${adminSqlModal.dbmsCode})` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t('dataAccess.adminSqlDbUser')}: {adminSqlModal.roleName}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 shrink-0"
                    onClick={() => setAdminSqlModal(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {adminSqlModal.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 space-y-1">
                      <div className="font-medium">{t('dataAccess.adminSqlWarnings')}</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {adminSqlModal.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <textarea
                    readOnly
                    value={adminSqlModal.sql}
                    className="flex-1 min-h-[240px] w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed resize-y"
                  />
                  <div className="flex flex-wrap justify-end gap-2 shrink-0">
                    <Button type="button" variant="outline" onClick={() => setAdminSqlModal(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      className="gap-2"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(adminSqlModal.sql);
                          toast.success(t('dataAccess.adminSqlCopied'));
                        } catch {
                          toast.error(t('dataAccess.adminSqlCopyFailed'));
                        }
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      {t('dataAccess.adminSqlCopy')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="text-xs text-muted-foreground">{t('dataAccess.note')}</div>
        </div>
      </div>
    </div>
  );
}
