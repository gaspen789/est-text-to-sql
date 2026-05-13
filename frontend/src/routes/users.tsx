import { useMemo, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from '@/lib/toast';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Edit,
  KeyRound,
  Plus,
  Shield,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import { UserClassifiersSection } from '@/components/UserClassifiersSection';
import { TablePaginationBar, type TablePageSize } from '@/components/table-pagination';
import { apiDelete, apiFetchJson, apiPost, apiPut, queryKeys } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';
import { userRoleDisplayName } from '@/lib/userRoleDisplay';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RequiredMark } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type RoleRow = { user_role_code: string; user_role_name: string };
type GroupRow = { user_group_code: string; user_group_name: string };
type LanguageRow = { language_code: string; language_name: string };

type AdminUserRow = {
  app_user_id: number;
  email: string;
  preferred_llm_language: string;
  llm_custom_global_instruction: string | null;
  is_active: boolean;
  created_at_time: string;
  modified_at_time: string;
  user_role_codes: string; // comma-separated
  user_role_names: string; // comma-separated
  user_group_codes: string; // comma-separated
  user_group_names: string; // comma-separated
};

function splitCsv(value: string | null | undefined): string[] {
  const s = (value ?? '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function stableColorIndex(seed: string, paletteSize: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return paletteSize === 0 ? 0 : h % paletteSize;
}

function groupChipClass(seed: string): string {
  const palette = [
    'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200',
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200',
    'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200',
  ];
  return palette[stableColorIndex(seed, palette.length)]!;
}

function roleChipClass(roleCode: string): string {
  const c = roleCode.trim();
  if (c === 'ADM')
    return 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200';
  if (c === 'CHA') return 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200';
  if (c === 'AUD') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
  return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-200';
}

export const Route = createFileRoute('/users' as any)({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
      throw redirect({ to: '/login' as any });
    }

    // Enforce admin-only access even if someone types the URL.
    let roles: { user_role_code: string; user_role_name: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      // If roles cannot be loaded (e.g. bad session), fall back to login.
      throw redirect({ to: '/login' as any });
    }
    const isAdmin = roles.some((r) => r.user_role_code === 'ADM');
    if (!isAdmin) {
      throw redirect({ to: '/' as any });
    }
  },
  component: UsersAdminPage,
});

function UsersAdminPage() {
  const queryClient = useQueryClient();
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const noneLabel = t('users.noneValue');

  const { data: availableLanguages = [] } = useQuery({
    queryKey: queryKeys.languages,
    queryFn: () => apiFetchJson<LanguageRow[]>('/api/keeled'),
  });

  const { data: roles = [] } = useQuery({
    queryKey: queryKeys.adminRoles,
    queryFn: () => apiFetchJson<RoleRow[]>('/api/admin/roles'),
  });

  const { data: groups = [] } = useQuery({
    queryKey: queryKeys.adminGroups,
    queryFn: () => apiFetchJson<GroupRow[]>('/api/admin/groups'),
  });

  const {
    data: users = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: () => apiFetchJson<AdminUserRow[]>('/api/admin/users'),
  });

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<
    | 'email'
    | 'active'
    | 'preferredLanguage'
    | 'globalInstruction'
    | 'roles'
    | 'groups'
    | 'created'
    | 'modified'
  >('email');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<TablePageSize>(10);
  const [pageIndex, setPageIndex] = useState(0);

  const toggleSort = (key: typeof sortKey) => {
    setPageIndex(0);
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const sortIndicator = (key: typeof sortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    email: string;
    preferred_llm_language: string;
    llm_custom_global_instruction: string;
    roleCodes: string[];
    groupCodes: string[];
    is_active: boolean;
  } | null>(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bulkModalMode, setBulkModalMode] = useState<'add' | 'remove' | null>(null);
  const [bulkUserSearch, setBulkUserSearch] = useState('');
  const [bulkGroupSearch, setBulkGroupSearch] = useState('');
  const [bulkRoleCodes, setBulkRoleCodes] = useState<string[]>([]);
  const [bulkGroupCodes, setBulkGroupCodes] = useState<string[]>([]);
  const [bulkSelectedUserIds, setBulkSelectedUserIds] = useState<number[]>([]);

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<{
    email: string;
    preferred_llm_language: string;
    is_active: boolean;
    password: string;
    roleCodes: string[];
    groupCodes: string[];
  }>({
    email: '',
    preferred_llm_language: '',
    is_active: true,
    password: '',
    roleCodes: [],
    groupCodes: [],
  });
  const [addGroupSearch, setAddGroupSearch] = useState('');

  const createUserMutation = useMutation({
    mutationFn: async (payload: {
      email: string;
      preferred_llm_language: string;
      is_active: boolean;
      password?: string;
      user_role_codes: string[];
      user_group_codes: string[];
    }) => {
      const res = await apiPost('/api/admin/users', payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.addUserFailed'));
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success(t('users.addUserSuccess'));
      setAddUserOpen(false);
      setAddDraft({
        email: '',
        preferred_llm_language: '',
        is_active: true,
        password: '',
        roleCodes: [],
        groupCodes: [],
      });
      setAddGroupSearch('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: async (payload: { userId: number; nextActive: boolean }) => {
      const res = await apiPut(
        `/api/admin/users/${payload.userId}/${payload.nextActive ? 'activate' : 'deactivate'}`,
        {}
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: {
      userId: number;
      preferred_llm_language: string;
      llm_custom_global_instruction: string | null;
    }) => {
      const res = await apiPut(`/api/admin/users/${payload.userId}/profile`, {
        preferred_llm_language: payload.preferred_llm_language,
        llm_custom_global_instruction: payload.llm_custom_global_instruction,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const updateEmailMutation = useMutation({
    mutationFn: async (payload: { userId: number; email: string }) => {
      const res = await apiPut(`/api/admin/users/${payload.userId}/email`, {
        email: payload.email,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (payload: { userId: number; newPassword: string }) => {
      const res = await apiPut(`/api/admin/users/${payload.userId}/password`, {
        new_password: payload.newPassword,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.passwordChangeFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t('users.passwordChangeSuccess'));
      setChangePasswordOpen(false);
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (payload: { userId: number }) => {
      const res = await apiDelete(`/api/admin/users/${payload.userId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.deleteFailed'));
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      toast.success(t('users.deleteSuccess'));
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
      cancelEditRow();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setRolesMutation = useMutation({
    mutationFn: async (payload: { userId: number; roleCodes: string[] }) => {
      const res = await apiPut(`/api/admin/users/${payload.userId}/roles`, {
        user_role_codes: payload.roleCodes,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const setGroupsMutation = useMutation({
    mutationFn: async (payload: { userId: number; groupCodes: string[] }) => {
      const res = await apiPut(`/api/admin/users/${payload.userId}/groups`, {
        user_group_codes: payload.groupCodes,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (payload: {
      userIds: number[];
      roleCodes: string[];
      groupCodes: string[];
      action: 'add' | 'remove';
    }) => {
      const res = await apiPost('/api/admin/users/bulk-assign', {
        user_ids: payload.userIds,
        user_role_codes: payload.roleCodes,
        user_group_codes: payload.groupCodes,
        action: payload.action,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (err: Error) => toast.error(err.message),
  });

  const beginEditRow = (u: AdminUserRow) => {
    setEditingUserId(u.app_user_id);
    setGroupSearch('');
    setDraft({
      email: (u.email ?? '').trim(),
      preferred_llm_language: (u.preferred_llm_language ?? '').trim(),
      llm_custom_global_instruction: (u.llm_custom_global_instruction ?? '').trim(),
      roleCodes: splitCsv(u.user_role_codes),
      groupCodes: splitCsv(u.user_group_codes),
      is_active: u.is_active,
    });
  };

  const cancelEditRow = () => {
    setEditingUserId(null);
    setDraft(null);
    setGroupSearch('');
    setDeleteConfirmOpen(false);
    setDeleteConfirmText('');
    setChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
  };

  const saveEditRow = async () => {
    if (!draft || editingUserId == null) return;
    const userId = editingUserId;
    const currentUser = users.find((u) => u.app_user_id === userId);
    if (!currentUser) return;
    const nextEmail = draft.email.trim();
    if (!nextEmail) {
      toast.error(t('users.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      toast.error(t('users.emailInvalid'));
      return;
    }
    const preferred = draft.preferred_llm_language.trim();
    if (!preferred) {
      toast.error(t('users.preferredLanguageRequired'));
      return;
    }
    const instruction = draft.llm_custom_global_instruction.trim();
    try {
      await Promise.all([
        ...(nextEmail.toLowerCase() !==
        String(currentUser.email ?? '')
          .trim()
          .toLowerCase()
          ? [updateEmailMutation.mutateAsync({ userId, email: nextEmail })]
          : []),
        updateProfileMutation.mutateAsync({
          userId,
          preferred_llm_language: preferred,
          llm_custom_global_instruction: instruction ? instruction : null,
        }),
        setRolesMutation.mutateAsync({ userId, roleCodes: draft.roleCodes }),
        setGroupsMutation.mutateAsync({ userId, groupCodes: draft.groupCodes }),
        ...(draft.is_active !== currentUser.is_active
          ? [activateMutation.mutateAsync({ userId, nextActive: draft.is_active })]
          : []),
      ]);
      cancelEditRow();
      toast.success(t('users.rowSaved'));
    } catch {
      // errors are toasted in each mutation
    }
  };
  const editingUser = useMemo(
    () => users.find((u) => u.app_user_id === editingUserId) ?? null,
    [editingUserId, users]
  );
  const isSavingEdit =
    updateEmailMutation.isPending ||
    updateProfileMutation.isPending ||
    setRolesMutation.isPending ||
    setGroupsMutation.isPending ||
    activateMutation.isPending;
  const isDeletingUser = deleteUserMutation.isPending;
  const roleNameByCode = useMemo(
    () => new Map(roles.map((r) => [r.user_role_code.trim().toUpperCase(), r.user_role_name])),
    [roles]
  );
  const groupByCode = useMemo(() => new Map(groups.map((g) => [g.user_group_code, g])), [groups]);
  const filteredGroupOptions = useMemo(() => {
    if (!draft) return [];
    const q = groupSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (draft.groupCodes.includes(g.user_group_code)) return false;
      if (!q) return true;
      return (
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
      );
    });
  }, [draft, groupSearch, groups]);
  const filteredBulkUsers = useMemo(() => {
    const q = bulkUserSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.email ?? '').toLowerCase().includes(q));
  }, [bulkUserSearch, users]);
  const filteredBulkGroupOptions = useMemo(() => {
    const q = bulkGroupSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (bulkGroupCodes.includes(g.user_group_code)) return false;
      if (!q) return true;
      return (
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
      );
    });
  }, [bulkGroupCodes, bulkGroupSearch, groups]);

  const closeBulkModal = () => {
    setBulkModalMode(null);
    setBulkUserSearch('');
    setBulkGroupSearch('');
    setBulkRoleCodes([]);
    setBulkGroupCodes([]);
    setBulkSelectedUserIds([]);
  };

  const openAddUser = () => {
    const defaultLang = availableLanguages[0]?.language_code ?? '';
    setAddDraft({
      email: '',
      preferred_llm_language: defaultLang,
      is_active: true,
      password: '',
      roleCodes: [],
      groupCodes: [],
    });
    setAddGroupSearch('');
    setAddUserOpen(true);
  };

  const saveAddUser = () => {
    const email = addDraft.email.trim();
    if (!email) {
      toast.error(t('users.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t('users.emailInvalid'));
      return;
    }
    const preferred = addDraft.preferred_llm_language.trim();
    if (!preferred) {
      toast.error(t('users.preferredLanguageRequired'));
      return;
    }
    const password = addDraft.password.trim();
    if (password && password.length < 15) {
      toast.error(t('settings.passwordTooShort'));
      return;
    }
    createUserMutation.mutate({
      email,
      preferred_llm_language: preferred,
      is_active: addDraft.is_active,
      ...(password ? { password } : {}),
      user_role_codes: addDraft.roleCodes,
      user_group_codes: addDraft.groupCodes,
    });
  };

  const filteredAddGroupOptions = useMemo(() => {
    const q = addGroupSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (addDraft.groupCodes.includes(g.user_group_code)) return false;
      if (!q) return true;
      return (
        g.user_group_name.toLowerCase().includes(q) || g.user_group_code.toLowerCase().includes(q)
      );
    });
  }, [addDraft.groupCodes, addGroupSearch, groups]);
  const hasRemovalMatch = (u: AdminUserRow): boolean => {
    const selectedRoleCodes = new Set(bulkRoleCodes);
    const selectedGroupCodes = new Set(bulkGroupCodes);
    const roleCodes = splitCsv(u.user_role_codes);
    const groupCodes = splitCsv(u.user_group_codes);
    const roleMatch =
      selectedRoleCodes.size === 0 ? false : roleCodes.some((code) => selectedRoleCodes.has(code));
    const groupMatch =
      selectedGroupCodes.size === 0
        ? false
        : groupCodes.some((code) => selectedGroupCodes.has(code));
    return roleMatch || groupMatch;
  };

  const filteredSorted = useMemo(() => {
    const s = search.trim().toLowerCase();
    const base = users.filter((u) => {
      if (activeFilter === 'active' && !u.is_active) return false;
      if (activeFilter === 'inactive' && u.is_active) return false;

      if (roleFilter !== 'all') {
        const codes = splitCsv(u.user_role_codes);
        if (!codes.includes(roleFilter)) return false;
      }
      if (groupFilter !== 'all') {
        const codes = splitCsv(u.user_group_codes);
        if (!codes.includes(groupFilter)) return false;
      }

      if (!s) return true;
      return (u.email ?? '').toLowerCase().includes(s);
    });

    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'email') {
        cmp = (a.email ?? '').localeCompare(b.email ?? '', language === 'et' ? 'et' : 'en', {
          sensitivity: 'base',
        });
      } else if (sortKey === 'active') {
        cmp = Number(a.is_active) - Number(b.is_active);
      } else if (sortKey === 'preferredLanguage') {
        cmp = (a.preferred_llm_language ?? '').localeCompare(
          b.preferred_llm_language ?? '',
          language === 'et' ? 'et' : 'en',
          { sensitivity: 'base' }
        );
      } else if (sortKey === 'globalInstruction') {
        cmp = (a.llm_custom_global_instruction ?? '').localeCompare(
          b.llm_custom_global_instruction ?? '',
          language === 'et' ? 'et' : 'en',
          { sensitivity: 'base' }
        );
      } else if (sortKey === 'roles') {
        cmp = (a.user_role_names ?? '').localeCompare(
          b.user_role_names ?? '',
          language === 'et' ? 'et' : 'en',
          { sensitivity: 'base' }
        );
      } else if (sortKey === 'groups') {
        cmp = (a.user_group_names ?? '').localeCompare(
          b.user_group_names ?? '',
          language === 'et' ? 'et' : 'en',
          { sensitivity: 'base' }
        );
      } else if (sortKey === 'created') {
        cmp = new Date(a.created_at_time).getTime() - new Date(b.created_at_time).getTime();
      } else if (sortKey === 'modified') {
        cmp = new Date(a.modified_at_time).getTime() - new Date(b.modified_at_time).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [activeFilter, groupFilter, language, roleFilter, search, sortDir, sortKey, users]);

  const paged = useMemo(() => {
    const total = filteredSorted.length;
    if (pageSize === 'all') {
      return {
        rows: filteredSorted,
        total,
        pageIndex: 0,
        pageCount: 1,
        from: total === 0 ? 0 : 1,
        to: total,
      };
    }
    const size = pageSize;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
    const start = safePageIndex * size;
    const end = Math.min(start + size, total);
    const rows = filteredSorted.slice(start, end);
    return {
      rows,
      total,
      pageIndex: safePageIndex,
      pageCount,
      from: total === 0 ? 0 : start + 1,
      to: end,
    };
  }, [filteredSorted, pageIndex, pageSize]);

  // Keep pagination stable when filters/sorting change.
  if (pageSize !== 'all' && pageIndex !== paged.pageIndex) {
    setPageIndex(paged.pageIndex);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('users.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-4">
          <div
            id="users-management-section"
            className="scroll-mt-24 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <div className="w-full sm:w-80">
                <div className="text-xs text-muted-foreground mb-1">{t('users.search')}</div>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('users.searchPlaceholder')}
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="w-full sm:w-44">
                  <div className="text-xs text-muted-foreground mb-1">{t('users.active')}</div>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as any)}
                  >
                    <option value="all">{t('common.all')}</option>
                    <option value="active">{t('users.activeOnly')}</option>
                    <option value="inactive">{t('users.inactiveOnly')}</option>
                  </select>
                </div>

                <div className="w-full sm:w-52">
                  <div className="text-xs text-muted-foreground mb-1">{t('users.role')}</div>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="all">{t('common.all')}</option>
                    {roles.map((r) => (
                      <option key={r.user_role_code} value={r.user_role_code}>
                        {userRoleDisplayName(r.user_role_code, r.user_role_name, t)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-full sm:w-52">
                  <div className="text-xs text-muted-foreground mb-1">{t('users.group')}</div>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  >
                    <option value="all">{t('common.all')}</option>
                    {groups.map((g) => (
                      <option key={g.user_group_code} value={g.user_group_code}>
                        {g.user_group_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-stretch gap-2 sm:justify-end">
              <Button
                variant="outline"
                className="gap-2 w-full sm:w-auto"
                onClick={() => navigate({ to: '/admin/data-access' as any })}
                title={t('users.openDataAccess')}
              >
                <Shield className="h-4 w-4" />
                {t('users.openDataAccess')}
              </Button>
              <Button
                className="gap-2 w-full sm:w-auto"
                onClick={openAddUser}
                disabled={editingUserId != null || isFetching || isLoading}
                title={t('users.addUser')}
              >
                <Plus className="h-4 w-4" />
                {t('users.addUser')}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{t('common.actions')}</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('email')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.email')}
                    >
                      {t('users.email')}
                      {sortIndicator('email')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('active')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.active')}
                    >
                      {t('users.active')}
                      {sortIndicator('active')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('preferredLanguage')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.preferredLanguage')}
                    >
                      {t('users.preferredLanguage')}
                      {sortIndicator('preferredLanguage')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('globalInstruction')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.globalInstruction')}
                    >
                      {t('users.globalInstruction')}
                      {sortIndicator('globalInstruction')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('roles')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.roles')}
                    >
                      {t('users.roles')}
                      {sortIndicator('roles')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('groups')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.groups')}
                    >
                      {t('users.groups')}
                      {sortIndicator('groups')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('created')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.createdAt')}
                    >
                      {t('users.createdAt')}
                      {sortIndicator('created')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('modified')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      title={t('users.modifiedAt')}
                    >
                      {t('users.modifiedAt')}
                      {sortIndicator('modified')}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-muted-foreground">
                      {t('common.loading')}
                    </TableCell>
                  </TableRow>
                ) : paged.total === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-muted-foreground">
                      {t('users.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.rows.map((u) => {
                    const currentRoleCodes = splitCsv(u.user_role_codes);
                    const groupChips = splitCsv(u.user_group_names);
                    return (
                      <TableRow key={u.app_user_id}>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="hover:text-green-600"
                              onClick={() => beginEditRow(u)}
                              disabled={editingUserId != null}
                              title={t('users.editRow')}
                              aria-label={t('users.editRow')}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                activateMutation.mutate({
                                  userId: u.app_user_id,
                                  nextActive: !u.is_active,
                                })
                              }
                              disabled={activateMutation.isPending || editingUserId != null}
                              className={
                                u.is_active ? 'hover:text-destructive' : 'hover:text-green-600'
                              }
                              title={u.is_active ? t('users.deactivate') : t('users.activate')}
                              aria-label={u.is_active ? t('users.deactivate') : t('users.activate')}
                            >
                              {u.is_active ? (
                                <ToggleRight className="h-4 w-4" />
                              ) : (
                                <ToggleLeft className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal break-words max-w-[26rem]">
                          {u.email}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              u.is_active
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                                : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-200'
                            }`}
                          >
                            {u.is_active ? t('users.activeOnly') : t('users.inactiveOnly')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {u.preferred_llm_language?.trim() ? u.preferred_llm_language : '—'}
                        </TableCell>
                        <TableCell className="whitespace-normal max-w-[28rem]">
                          {(u.llm_custom_global_instruction ?? '').trim() || '—'}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              {currentRoleCodes.length === 0 ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {currentRoleCodes.map((code) => (
                                    <span
                                      key={code}
                                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${roleChipClass(code)}`}
                                    >
                                      {userRoleDisplayName(
                                        code,
                                        roleNameByCode.get(code.trim().toUpperCase()) ?? code,
                                        t
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              {groupChips.length === 0 ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {groupChips.map((name) => (
                                    <span
                                      key={name}
                                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${groupChipClass(`group:${name}`)}`}
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{new Date(u.created_at_time).toLocaleString()}</TableCell>
                        <TableCell>{new Date(u.modified_at_time).toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <TablePaginationBar
            total={paged.total}
            from={paged.from}
            to={paged.to}
            pageSize={pageSize}
            pageIndex={paged.pageIndex}
            pageCount={paged.pageCount}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPageIndex(0);
            }}
            onPageIndexChange={setPageIndex}
            className="pt-1"
          />

          <div
            id="users-bulk-add-section"
            className="scroll-mt-24 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">{t('users.bulk.addSectionTitle')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('users.bulk.addSectionDescription')}
                </p>
              </div>
              <Button variant="outline" onClick={() => setBulkModalMode('add')}>
                {t('users.bulk.openAdd')}
              </Button>
            </div>
          </div>

          <div
            id="users-bulk-remove-section"
            className="scroll-mt-24 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">{t('users.bulk.removeSectionTitle')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('users.bulk.removeSectionDescription')}
                </p>
              </div>
              <Button variant="outline" onClick={() => setBulkModalMode('remove')}>
                {t('users.bulk.openRemove')}
              </Button>
            </div>
          </div>

          <div id="users-classifiers-section" className="scroll-mt-24">
            <UserClassifiersSection showAdminClassifiersLink />
          </div>
        </div>

        {editingUser && draft ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={cancelEditRow}
              disabled={isSavingEdit}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="users-edit-title"
              className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="users-edit-title" className="text-lg font-semibold mb-1">
                {t('users.editModalTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{t('users.editEmailHint')}</p>

              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.email')} <RequiredMark />
                  </div>
                  <Input
                    value={draft.email}
                    onChange={(e) =>
                      setDraft((prev) => (prev ? { ...prev, email: e.target.value } : prev))
                    }
                    disabled={isSavingEdit}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.active')}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => (prev ? { ...prev, is_active: true } : prev))
                      }
                      disabled={isSavingEdit}
                      aria-pressed={draft.is_active}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${
                        draft.is_active
                          ? 'bg-green-100 text-green-800 ring-1 ring-green-500/40 dark:bg-green-900/30 dark:text-green-200'
                          : 'bg-muted text-muted-foreground hover:opacity-80'
                      }`}
                    >
                      {t('users.activeStatusActive')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => (prev ? { ...prev, is_active: false } : prev))
                      }
                      disabled={isSavingEdit}
                      aria-pressed={!draft.is_active}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${
                        !draft.is_active
                          ? 'bg-zinc-100 text-zinc-800 ring-1 ring-zinc-400/50 dark:bg-zinc-900/30 dark:text-zinc-200'
                          : 'bg-muted text-muted-foreground hover:opacity-80'
                      }`}
                    >
                      {t('users.activeStatusInactive')}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.preferredLanguage')} <RequiredMark />
                  </div>
                  <SearchableSelect
                    value={draft.preferred_llm_language}
                    onChange={(next) =>
                      setDraft((prev) => (prev ? { ...prev, preferred_llm_language: next } : prev))
                    }
                    options={availableLanguages.map((l) => ({
                      value: l.language_code,
                      label: `${l.language_name} (${l.language_code})`,
                    }))}
                    disabled={isSavingEdit}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.globalInstruction')}
                  </div>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    rows={4}
                    value={draft.llm_custom_global_instruction}
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev ? { ...prev, llm_custom_global_instruction: e.target.value } : prev
                      )
                    }
                    placeholder={noneLabel}
                    disabled={isSavingEdit}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.roles')}</div>
                  <div className="rounded-md border border-input p-2 min-h-12">
                    <div className="flex flex-wrap gap-2">
                      {roles.map((r) => {
                        const selected = draft.roleCodes.includes(r.user_role_code);
                        return (
                          <button
                            key={r.user_role_code}
                            type="button"
                            onClick={() => {
                              const nextCodes = selected
                                ? draft.roleCodes.filter((c) => c !== r.user_role_code)
                                : [...draft.roleCodes, r.user_role_code];
                              setDraft((prev) => (prev ? { ...prev, roleCodes: nextCodes } : prev));
                            }}
                            disabled={isSavingEdit}
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${selected ? roleChipClass(r.user_role_code) : 'bg-muted text-muted-foreground hover:opacity-80'}`}
                          >
                            {userRoleDisplayName(r.user_role_code, r.user_role_name, t)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.groups')}</div>
                  <div className="rounded-md border border-input p-2 space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {draft.groupCodes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{noneLabel}</span>
                      ) : (
                        draft.groupCodes.map((code) => {
                          const g = groupByCode.get(code);
                          const label = g?.user_group_name ?? code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() =>
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        groupCodes: prev.groupCodes.filter((c) => c !== code),
                                      }
                                    : prev
                                )
                              }
                              disabled={isSavingEdit}
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-opacity disabled:opacity-60 ${groupChipClass(`group:${label}`)}`}
                            >
                              {label}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <Input
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder={t('users.searchGroupPlaceholder')}
                      disabled={isSavingEdit}
                    />

                    <div className="max-h-36 overflow-y-auto rounded-md border border-border">
                      {filteredGroupOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t('users.noResults')}
                        </div>
                      ) : (
                        filteredGroupOptions.map((g) => (
                          <button
                            key={g.user_group_code}
                            type="button"
                            disabled={isSavingEdit}
                            onClick={() => {
                              setDraft((prev) =>
                                prev
                                  ? { ...prev, groupCodes: [...prev.groupCodes, g.user_group_code] }
                                  : prev
                              );
                              setGroupSearch('');
                            }}
                            className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors disabled:opacity-60"
                          >
                            {g.user_group_name} ({g.user_group_code})
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleteConfirmText('');
                      setDeleteConfirmOpen(true);
                    }}
                    disabled={isSavingEdit || isDeletingUser}
                  >
                    {t('users.deleteUser')}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      setNewPassword('');
                      setConfirmPassword('');
                      setChangePasswordOpen(true);
                    }}
                    disabled={isSavingEdit || isDeletingUser}
                  >
                    <KeyRound className="h-4 w-4" />
                    {t('users.changePassword')}
                  </Button>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={cancelEditRow} disabled={isSavingEdit}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={() => void saveEditRow()} disabled={isSavingEdit}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {editingUser && deleteConfirmOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteUserMutation.isPending}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="users-delete-title"
              className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="users-delete-title" className="text-lg font-semibold mb-1">
                {t('users.deleteTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{t('users.deleteWarning')}</p>

              <div className="space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('users.email')}: </span>
                  <span className="font-medium">{editingUser.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('users.deleteTypeEmailHint')}
                </div>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={editingUser.email}
                  disabled={deleteUserMutation.isPending}
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(false)}
                  disabled={deleteUserMutation.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    deleteUserMutation.isPending ||
                    deleteConfirmText.trim().toLowerCase() !==
                      String(editingUser.email ?? '')
                        .trim()
                        .toLowerCase()
                  }
                  onClick={() => deleteUserMutation.mutate({ userId: editingUser.app_user_id })}
                >
                  {t('users.deleteConfirm')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {editingUser && changePasswordOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={() => {
                if (changePasswordMutation.isPending) return;
                setChangePasswordOpen(false);
                setNewPassword('');
                setConfirmPassword('');
              }}
              disabled={changePasswordMutation.isPending}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="users-password-title"
              className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="users-password-title" className="text-lg font-semibold mb-1">
                {t('users.changePasswordTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{t('users.changePasswordHint')}</p>

              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('users.email')}: </span>
                  <span className="font-medium">{editingUser.email}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.newPassword')} <RequiredMark />
                  </div>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={changePasswordMutation.isPending}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.confirmPassword')} <RequiredMark />
                  </div>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={changePasswordMutation.isPending}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setChangePasswordOpen(false);
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  disabled={changePasswordMutation.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={changePasswordMutation.isPending}
                  onClick={() => {
                    const pw = newPassword.trim();
                    if (pw.length < 8) {
                      toast.error(t('users.passwordTooShort'));
                      return;
                    }
                    if (pw !== confirmPassword.trim()) {
                      toast.error(t('users.passwordMismatch'));
                      return;
                    }
                    changePasswordMutation.mutate({
                      userId: editingUser.app_user_id,
                      newPassword: pw,
                    });
                  }}
                >
                  {t('users.savePassword')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {bulkModalMode ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={closeBulkModal}
              disabled={bulkAssignMutation.isPending}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="users-bulk-title"
              className="relative z-10 w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="users-bulk-title" className="text-lg font-semibold mb-1">
                {bulkModalMode === 'add'
                  ? t('users.bulk.addSectionTitle')
                  : t('users.bulk.removeSectionTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {bulkModalMode === 'add'
                  ? t('users.bulk.addSectionDescription')
                  : t('users.bulk.removeSectionDescription')}
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                <RequiredMark className="inline" /> {t('users.bulk.requiredSelectionHint')}
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{t('users.roles')}</div>
                    <div className="rounded-md border border-input p-2 min-h-12">
                      <div className="flex flex-wrap gap-2">
                        {roles.map((r) => {
                          const selected = bulkRoleCodes.includes(r.user_role_code);
                          return (
                            <button
                              key={r.user_role_code}
                              type="button"
                              onClick={() =>
                                setBulkRoleCodes((prev) =>
                                  selected
                                    ? prev.filter((c) => c !== r.user_role_code)
                                    : [...prev, r.user_role_code]
                                )
                              }
                              disabled={bulkAssignMutation.isPending}
                              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${selected ? roleChipClass(r.user_role_code) : 'bg-muted text-muted-foreground hover:opacity-80'}`}
                            >
                              {userRoleDisplayName(r.user_role_code, r.user_role_name, t)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{t('users.groups')}</div>
                    <div className="rounded-md border border-input p-2 space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {bulkGroupCodes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{noneLabel}</span>
                        ) : (
                          bulkGroupCodes.map((code) => {
                            const g = groupByCode.get(code);
                            const label = g?.user_group_name ?? code;
                            return (
                              <button
                                key={code}
                                type="button"
                                onClick={() =>
                                  setBulkGroupCodes((prev) => prev.filter((c) => c !== code))
                                }
                                disabled={bulkAssignMutation.isPending}
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-opacity disabled:opacity-60 ${groupChipClass(`group:${label}`)}`}
                              >
                                {label}
                              </button>
                            );
                          })
                        )}
                      </div>
                      <Input
                        value={bulkGroupSearch}
                        onChange={(e) => setBulkGroupSearch(e.target.value)}
                        placeholder={t('users.searchGroupPlaceholder')}
                        disabled={bulkAssignMutation.isPending}
                      />
                      <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border">
                        {filteredBulkGroupOptions.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            {t('users.noResults')}
                          </div>
                        ) : (
                          filteredBulkGroupOptions.map((g) => (
                            <button
                              key={g.user_group_code}
                              type="button"
                              onClick={() => {
                                setBulkGroupCodes((prev) => [...prev, g.user_group_code]);
                                setBulkGroupSearch('');
                              }}
                              className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                            >
                              {g.user_group_name} ({g.user_group_code})
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.bulk.selectUsers')} <RequiredMark />
                  </div>
                  <Input
                    value={bulkUserSearch}
                    onChange={(e) => setBulkUserSearch(e.target.value)}
                    placeholder={t('users.searchPlaceholder')}
                    className="mb-2"
                  />
                  <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border">
                    {filteredBulkUsers.map((u) => {
                      const checked = bulkSelectedUserIds.includes(u.app_user_id);
                      const roleCodes = splitCsv(u.user_role_codes);
                      const groupCodes = splitCsv(u.user_group_codes);
                      const match = hasRemovalMatch(u);
                      const canSelect =
                        bulkModalMode !== 'remove' ||
                        match ||
                        (bulkRoleCodes.length === 0 && bulkGroupCodes.length === 0);
                      return (
                        <label
                          key={u.app_user_id}
                          className={`flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-border/60 last:border-b-0 ${bulkModalMode === 'remove' && !canSelect ? 'opacity-50' : ''}`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="truncate">{u.email}</div>
                            <div className="flex flex-wrap gap-1">
                              {roleCodes.map((code) => (
                                <span
                                  key={`r:${u.app_user_id}:${code}`}
                                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${roleChipClass(code)}`}
                                >
                                  {userRoleDisplayName(
                                    code,
                                    roleNameByCode.get(code.trim().toUpperCase()) ?? code,
                                    t
                                  )}
                                </span>
                              ))}
                              {groupCodes.map((code) => {
                                const g = groupByCode.get(code);
                                const label = g?.user_group_name ?? code;
                                return (
                                  <span
                                    key={`g:${u.app_user_id}:${code}`}
                                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${groupChipClass(`group:${label}`)}`}
                                  >
                                    {label}
                                  </span>
                                );
                              })}
                              {roleCodes.length === 0 && groupCodes.length === 0 ? (
                                <span className="text-[10px] text-muted-foreground">
                                  {noneLabel}
                                </span>
                              ) : null}
                              <span className="text-[10px] text-muted-foreground">
                                {match
                                  ? t('users.bulk.matchesSelection')
                                  : t('users.bulk.notInSelection')}
                              </span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canSelect}
                            onChange={(e) =>
                              setBulkSelectedUserIds((prev) =>
                                e.target.checked
                                  ? [...prev, u.app_user_id]
                                  : prev.filter((id) => id !== u.app_user_id)
                              )
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {bulkModalMode === 'add'
                    ? t('users.bulk.manageClassifiersHint')
                    : t('users.bulk.removeHint')}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={closeBulkModal}
                    disabled={bulkAssignMutation.isPending}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    disabled={
                      bulkAssignMutation.isPending ||
                      bulkSelectedUserIds.length === 0 ||
                      (bulkRoleCodes.length === 0 && bulkGroupCodes.length === 0)
                    }
                    onClick={() =>
                      void bulkAssignMutation
                        .mutateAsync({
                          userIds: bulkSelectedUserIds,
                          roleCodes: bulkRoleCodes,
                          groupCodes: bulkGroupCodes,
                          action: bulkModalMode,
                        })
                        .then(() => {
                          toast.success(
                            bulkModalMode === 'add'
                              ? t('users.bulk.savedAdd')
                              : t('users.bulk.savedRemove')
                          );
                          closeBulkModal();
                        })
                    }
                  >
                    {bulkModalMode === 'add'
                      ? t('users.bulk.applyAdd')
                      : t('users.bulk.applyRemove')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {addUserOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              aria-label={t('common.cancel')}
              onClick={() => setAddUserOpen(false)}
              disabled={createUserMutation.isPending}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="users-add-title"
              className="relative z-10 w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-lg text-card-foreground"
            >
              <h2 id="users-add-title" className="text-lg font-semibold mb-4">
                {t('users.addUserTitle')}
              </h2>

              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.email')} <RequiredMark />
                  </div>
                  <Input
                    value={addDraft.email}
                    onChange={(e) => setAddDraft((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder={t('users.searchPlaceholder')}
                    disabled={createUserMutation.isPending}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.preferredLanguage')} <RequiredMark />
                  </div>
                  <SearchableSelect
                    value={addDraft.preferred_llm_language}
                    onChange={(next) =>
                      setAddDraft((prev) => ({ ...prev, preferred_llm_language: next }))
                    }
                    options={availableLanguages.map((l) => ({
                      value: l.language_code,
                      label: `${l.language_name} (${l.language_code})`,
                    }))}
                    disabled={createUserMutation.isPending}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('users.passwordOptional')}
                  </div>
                  <Input
                    type="password"
                    value={addDraft.password}
                    onChange={(e) => setAddDraft((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder={t('users.passwordOptionalPlaceholder')}
                    disabled={createUserMutation.isPending}
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('users.passwordOptionalHint')}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.active')}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddDraft((prev) => ({ ...prev, is_active: true }))}
                      disabled={createUserMutation.isPending}
                      aria-pressed={addDraft.is_active}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${
                        addDraft.is_active
                          ? 'bg-green-100 text-green-800 ring-1 ring-green-500/40 dark:bg-green-900/30 dark:text-green-200'
                          : 'bg-muted text-muted-foreground hover:opacity-80'
                      }`}
                    >
                      {t('users.activeStatusActive')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddDraft((prev) => ({ ...prev, is_active: false }))}
                      disabled={createUserMutation.isPending}
                      aria-pressed={!addDraft.is_active}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${
                        !addDraft.is_active
                          ? 'bg-zinc-100 text-zinc-800 ring-1 ring-zinc-400/50 dark:bg-zinc-900/30 dark:text-zinc-200'
                          : 'bg-muted text-muted-foreground hover:opacity-80'
                      }`}
                    >
                      {t('users.activeStatusInactive')}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.roles')}</div>
                  <div className="rounded-md border border-input p-2 min-h-12">
                    <div className="flex flex-wrap gap-2">
                      {roles.map((r) => {
                        const selected = addDraft.roleCodes.includes(r.user_role_code);
                        return (
                          <button
                            key={r.user_role_code}
                            type="button"
                            onClick={() => {
                              const nextCodes = selected
                                ? addDraft.roleCodes.filter((c) => c !== r.user_role_code)
                                : [...addDraft.roleCodes, r.user_role_code];
                              setAddDraft((prev) => ({ ...prev, roleCodes: nextCodes }));
                            }}
                            disabled={createUserMutation.isPending}
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-opacity disabled:opacity-60 ${
                              selected
                                ? roleChipClass(r.user_role_code)
                                : 'bg-muted text-muted-foreground hover:opacity-80'
                            }`}
                          >
                            {userRoleDisplayName(r.user_role_code, r.user_role_name, t)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t('users.groups')}</div>
                  <div className="rounded-md border border-input p-2 space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {addDraft.groupCodes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{noneLabel}</span>
                      ) : (
                        addDraft.groupCodes.map((code) => {
                          const g = groupByCode.get(code);
                          const label = g?.user_group_name ?? code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() =>
                                setAddDraft((prev) => ({
                                  ...prev,
                                  groupCodes: prev.groupCodes.filter((c) => c !== code),
                                }))
                              }
                              disabled={createUserMutation.isPending}
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-opacity disabled:opacity-60 ${groupChipClass(
                                `group:${label}`
                              )}`}
                            >
                              {label}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <Input
                      value={addGroupSearch}
                      onChange={(e) => setAddGroupSearch(e.target.value)}
                      placeholder={t('users.searchGroupPlaceholder')}
                      disabled={createUserMutation.isPending}
                    />

                    <div className="max-h-36 overflow-y-auto rounded-md border border-border">
                      {filteredAddGroupOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t('users.noResults')}
                        </div>
                      ) : (
                        filteredAddGroupOptions.map((g) => (
                          <button
                            key={g.user_group_code}
                            type="button"
                            disabled={createUserMutation.isPending}
                            onClick={() => {
                              setAddDraft((prev) => ({
                                ...prev,
                                groupCodes: [...prev.groupCodes, g.user_group_code],
                              }));
                              setAddGroupSearch('');
                            }}
                            className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors disabled:opacity-60"
                          >
                            {g.user_group_name} ({g.user_group_code})
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setAddUserOpen(false)}
                  disabled={createUserMutation.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button onClick={saveAddUser} disabled={createUserMutation.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
