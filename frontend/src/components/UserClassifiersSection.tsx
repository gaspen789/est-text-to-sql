import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
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
import { TablePaginationBar, type TablePageSize } from '@/components/table-pagination';

type Tab =
  | 'languages'
  | 'roles'
  | 'groups'
  | 'countries'
  | 'companies'
  | 'llmGroups'
  | 'modalities'
  | 'currencies'
  | 'unitTypes'
  | 'resultTypes';

type ClassifierRow = Record<string, any>;

type TabConfig = {
  id: Tab;
  labelKey: string;
  addKey: string;
  editKey: string;
  queryKey: readonly unknown[];
  listPath: string;
  createPath: string;
  updatePath: (code: string) => string;
  deletePath: (code: string) => string;
  activatePath: (code: string) => string;
  deactivatePath: (code: string) => string;
  codeField: string;
  nameField: string;
  codePattern?: RegExp;
  codeHintKey?: string;
  maxCodeLength?: number;
  nameHintKey?: string;
  maxNameLength?: number;
  extraSelect?: {
    field: 'country_code' | 'company_code';
    labelKey: string;
    sourceTab: Tab;
    optionCodeField: string;
    optionNameField: string;
  };
  hasCodeOnAdd?: boolean;
};

type ModalState =
  | { open: false }
  | {
      open: true;
      tab: Tab;
      mode: 'add' | 'edit';
      code?: string;
      name: string;
      description: string;
      is_active: boolean;
      country_code?: string;
      company_code?: string;
    };

const USER_TABS: TabConfig[] = [
  {
    id: 'languages',
    labelKey: 'users.classifiers.tabLanguages',
    addKey: 'users.classifiers.addLanguage',
    editKey: 'users.classifiers.editLanguage',
    queryKey: queryKeys.adminClassifierLanguages,
    listPath: '/api/admin/classifiers/languages',
    createPath: '/api/admin/classifiers/languages',
    updatePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/languages/${encodeURIComponent(code)}/deactivate`,
    codeField: 'language_code',
    nameField: 'language_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    nameHintKey: 'users.classifiers.languageNameHint',
    maxNameLength: 100,
  },
  {
    id: 'roles',
    labelKey: 'users.classifiers.tabRoles',
    addKey: 'users.classifiers.addRole',
    editKey: 'users.classifiers.editRole',
    queryKey: queryKeys.adminClassifierRoles,
    listPath: '/api/admin/classifiers/roles',
    createPath: '/api/admin/classifiers/roles',
    updatePath: (code) => `/api/admin/classifiers/roles/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/roles/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/roles/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) => `/api/admin/classifiers/roles/${encodeURIComponent(code)}/deactivate`,
    codeField: 'user_role_code',
    nameField: 'user_role_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    nameHintKey: 'users.classifiers.roleNameHint',
    maxNameLength: 15,
  },
  {
    id: 'groups',
    labelKey: 'users.classifiers.tabGroups',
    addKey: 'users.classifiers.addGroup',
    editKey: 'users.classifiers.editGroup',
    queryKey: queryKeys.adminClassifierGroups,
    listPath: '/api/admin/classifiers/groups',
    createPath: '/api/admin/classifiers/groups',
    updatePath: (code) => `/api/admin/classifiers/groups/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/groups/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/groups/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/groups/${encodeURIComponent(code)}/deactivate`,
    codeField: 'user_group_code',
    nameField: 'user_group_name',
    codePattern: /^[A-Z]{5}$/,
    codeHintKey: 'users.classifiers.codeHint5',
    maxCodeLength: 5,
    nameHintKey: 'users.classifiers.groupNameHint',
    maxNameLength: 50,
  },
];

const LLM_TABS: TabConfig[] = [
  {
    id: 'languages',
    labelKey: 'llmClassifiers.tabLanguages',
    addKey: 'llmClassifiers.addLanguage',
    editKey: 'llmClassifiers.editLanguage',
    queryKey: queryKeys.adminClassifierLanguages,
    listPath: '/api/admin/classifiers/languages',
    createPath: '/api/admin/classifiers/languages',
    updatePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/languages/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/languages/${encodeURIComponent(code)}/deactivate`,
    codeField: 'language_code',
    nameField: 'language_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    maxNameLength: 100,
  },
  {
    id: 'countries',
    labelKey: 'llmClassifiers.tabCountries',
    addKey: 'llmClassifiers.addCountry',
    editKey: 'llmClassifiers.editCountry',
    queryKey: ['admin-classifier-countries'] as const,
    listPath: '/api/admin/classifiers/countries',
    createPath: '/api/admin/classifiers/countries',
    updatePath: (code) => `/api/admin/classifiers/countries/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/countries/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/countries/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/countries/${encodeURIComponent(code)}/deactivate`,
    codeField: 'country_code',
    nameField: 'country_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    maxNameLength: 100,
  },
  {
    id: 'companies',
    labelKey: 'llmClassifiers.tabCompanies',
    addKey: 'llmClassifiers.addCompany',
    editKey: 'llmClassifiers.editCompany',
    queryKey: ['admin-classifier-companies'] as const,
    listPath: '/api/admin/classifiers/companies',
    createPath: '/api/admin/classifiers/companies',
    updatePath: (code) => `/api/admin/classifiers/companies/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/companies/${encodeURIComponent(code)}`,
    activatePath: (code) => `/api/admin/classifiers/companies/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/companies/${encodeURIComponent(code)}/deactivate`,
    codeField: 'company_code',
    nameField: 'company_name',
    maxCodeLength: 10,
    maxNameLength: 200,
    extraSelect: {
      field: 'country_code',
      labelKey: 'llmClassifiers.country',
      sourceTab: 'countries',
      optionCodeField: 'country_code',
      optionNameField: 'country_name',
    },
  },
  {
    id: 'llmGroups',
    labelKey: 'llmClassifiers.tabGroups',
    addKey: 'llmClassifiers.addGroup',
    editKey: 'llmClassifiers.editGroup',
    queryKey: ['admin-classifier-llm-groups'] as const,
    listPath: '/api/admin/classifiers/llm-groups',
    createPath: '/api/admin/classifiers/llm-groups',
    updatePath: (code) => `/api/admin/classifiers/llm-groups/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/llm-groups/${encodeURIComponent(code)}`,
    activatePath: (code) =>
      `/api/admin/classifiers/llm-groups/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/llm-groups/${encodeURIComponent(code)}/deactivate`,
    codeField: 'llm_group_id',
    nameField: 'llm_group_name',
    hasCodeOnAdd: false,
    maxNameLength: 100,
    extraSelect: {
      field: 'company_code',
      labelKey: 'llmClassifiers.company',
      sourceTab: 'companies',
      optionCodeField: 'company_code',
      optionNameField: 'company_name',
    },
  },
  {
    id: 'modalities',
    labelKey: 'llmClassifiers.tabModalities',
    addKey: 'llmClassifiers.addModality',
    editKey: 'llmClassifiers.editModality',
    queryKey: ['admin-classifier-modalities'] as const,
    listPath: '/api/admin/classifiers/modalities',
    createPath: '/api/admin/classifiers/modalities',
    updatePath: (code) => `/api/admin/classifiers/modalities/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/modalities/${encodeURIComponent(code)}`,
    activatePath: (code) =>
      `/api/admin/classifiers/modalities/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/modalities/${encodeURIComponent(code)}/deactivate`,
    codeField: 'modality_code',
    nameField: 'modality_name',
    codePattern: /^[A-Z]{1}$/,
    codeHintKey: 'llmClassifiers.codeHint1',
    maxCodeLength: 1,
    maxNameLength: 30,
  },
  {
    id: 'currencies',
    labelKey: 'llmClassifiers.tabCurrencies',
    addKey: 'llmClassifiers.addCurrency',
    editKey: 'llmClassifiers.editCurrency',
    queryKey: ['admin-classifier-currencies'] as const,
    listPath: '/api/admin/classifiers/currencies',
    createPath: '/api/admin/classifiers/currencies',
    updatePath: (code) => `/api/admin/classifiers/currencies/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/currencies/${encodeURIComponent(code)}`,
    activatePath: (code) =>
      `/api/admin/classifiers/currencies/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/currencies/${encodeURIComponent(code)}/deactivate`,
    codeField: 'currency_code',
    nameField: 'currency_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    maxNameLength: 100,
  },
  {
    id: 'unitTypes',
    labelKey: 'llmClassifiers.tabUnitTypes',
    addKey: 'llmClassifiers.addUnitType',
    editKey: 'llmClassifiers.editUnitType',
    queryKey: ['admin-classifier-unit-types'] as const,
    listPath: '/api/admin/classifiers/unit-types',
    createPath: '/api/admin/classifiers/unit-types',
    updatePath: (code) => `/api/admin/classifiers/unit-types/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/unit-types/${encodeURIComponent(code)}`,
    activatePath: (code) =>
      `/api/admin/classifiers/unit-types/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/unit-types/${encodeURIComponent(code)}/deactivate`,
    codeField: 'unit_type_code',
    nameField: 'unit_type_name',
    codePattern: /^[A-Z]{3}$/,
    codeHintKey: 'users.classifiers.codeHint3',
    maxCodeLength: 3,
    maxNameLength: 50,
  },
];

const RESULT_TABS: TabConfig[] = [
  {
    id: 'resultTypes',
    labelKey: 'adminClassifiers.tabResultTypes',
    addKey: 'adminClassifiers.addResultType',
    editKey: 'adminClassifiers.editResultType',
    queryKey: queryKeys.adminClassifierResultTypes,
    listPath: '/api/admin/classifiers/result-types',
    createPath: '/api/admin/classifiers/result-types',
    updatePath: (code) => `/api/admin/classifiers/result-types/${encodeURIComponent(code)}`,
    deletePath: (code) => `/api/admin/classifiers/result-types/${encodeURIComponent(code)}`,
    activatePath: (code) =>
      `/api/admin/classifiers/result-types/${encodeURIComponent(code)}/activate`,
    deactivatePath: (code) =>
      `/api/admin/classifiers/result-types/${encodeURIComponent(code)}/deactivate`,
    codeField: 'result_type_code',
    nameField: 'result_type_name',
    maxCodeLength: 10,
    maxNameLength: 30,
  },
];

function ClassifiersSection({
  titleKey,
  introKey,
  tabs,
  rootId,
  extraInvalidateKeys,
  showAdminClassifiersLink = false,
}: {
  titleKey: string;
  introKey: string;
  tabs: TabConfig[];
  rootId?: string;
  extraInvalidateKeys?: readonly (readonly unknown[])[];
  showAdminClassifiersLink?: boolean;
}) {
  const { t } = useTranslation();
  const { confirm } = useModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  const [modal, setModal] = useState<ModalState>({ open: false });
  const activeTab = tabs.find((x) => x.id === tab) ?? tabs[0]!;

  const defaultPage = Object.fromEntries(tabs.map((x) => [x.id, 10])) as Record<Tab, TablePageSize>;
  const defaultIndex = Object.fromEntries(tabs.map((x) => [x.id, 0])) as Record<Tab, number>;
  const defaultSearch = Object.fromEntries(tabs.map((x) => [x.id, ''])) as Record<Tab, string>;
  const [pageSizeByTab, setPageSizeByTab] = useState<Record<Tab, TablePageSize>>(defaultPage);
  const [pageIndexByTab, setPageIndexByTab] = useState<Record<Tab, number>>(defaultIndex);
  const [searchByTab, setSearchByTab] = useState<Record<Tab, string>>(defaultSearch);

  const [sortByTab, setSortByTab] = useState<
    Record<Tab, { key: 'code' | 'name' | 'description' | 'active'; dir: 'asc' | 'desc' }>
  >(
    Object.fromEntries(tabs.map((x) => [x.id, { key: 'name', dir: 'asc' }])) as Record<
      Tab,
      { key: 'code' | 'name' | 'description' | 'active'; dir: 'asc' | 'desc' }
    >
  );

  const toggleSort = (nextKey: 'code' | 'name' | 'description' | 'active') => {
    setPageIndexByTab((prev) => ({ ...prev, [tab]: 0 }));
    setSortByTab((prev) => {
      const cur = prev[tab];
      if (cur.key === nextKey) {
        return { ...prev, [tab]: { key: cur.key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } };
      }
      return { ...prev, [tab]: { key: nextKey, dir: 'asc' } };
    });
  };

  const sortIndicator = (key: 'code' | 'name' | 'description' | 'active') => {
    const cur = sortByTab[tab];
    if (cur.key !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
    return cur.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const queryResults = useQueries({
    queries: tabs.map((cfg) => ({
      queryKey: cfg.queryKey,
      queryFn: () => apiFetchJson<ClassifierRow[]>(cfg.listPath),
    })),
  });
  const rowsByTab = useMemo(() => {
    const out: Record<Tab, ClassifierRow[]> = {} as Record<Tab, ClassifierRow[]>;
    tabs.forEach((cfg, idx) => {
      out[cfg.id] = (queryResults[idx]?.data as ClassifierRow[] | undefined) ?? [];
    });
    return out;
  }, [tabs, queryResults]);
  const loadingByTab = useMemo(() => {
    const out: Record<Tab, boolean> = {} as Record<Tab, boolean>;
    tabs.forEach((cfg, idx) => {
      out[cfg.id] = Boolean(queryResults[idx]?.isLoading);
    });
    return out;
  }, [tabs, queryResults]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { method: 'POST' | 'PUT'; path: string; body: object }) => {
      const res =
        payload.method === 'POST'
          ? await apiPost(payload.path, payload.body)
          : await apiPut(payload.path, payload.body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      tabs.forEach((cfg) => queryClient.invalidateQueries({ queryKey: cfg.queryKey }));
      (extraInvalidateKeys ?? []).forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await apiDelete(path);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      tabs.forEach((cfg) => queryClient.invalidateQueries({ queryKey: cfg.queryKey }));
      toast.success(t('users.classifiers.classifierDeleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (payload: { path: string }) => {
      const res = await apiPost(payload.path, {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'users.updateFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      tabs.forEach((cfg) => queryClient.invalidateQueries({ queryKey: cfg.queryKey }));
      toast.success(t('users.classifiers.classifierSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openAdd = () => {
    setModal({
      open: true,
      tab,
      mode: 'add',
      name: '',
      description: '',
      is_active: true,
      country_code: '',
      company_code: '',
    });
  };

  const openEdit = (row: ClassifierRow) => {
    const cfg = activeTab;
    const code = String(row[cfg.codeField] ?? '').trim();
    setModal({
      open: true,
      tab,
      mode: 'edit',
      code,
      name: String(row[cfg.nameField] ?? ''),
      description: row.description ?? '',
      is_active: row.is_active,
      country_code: row.country_code ?? '',
      company_code: row.company_code ?? '',
    });
    setCodeDraft(code);
  };

  const [codeDraft, setCodeDraft] = useState('');

  const handleSubmitModal = async () => {
    if (!modal.open) return;
    const m = modal;
    try {
      const cfg = tabs.find((x) => x.id === m.tab)!;
      const code =
        cfg.hasCodeOnAdd !== false ? codeDraft.trim().toUpperCase() : String(m.code ?? '').trim();
      if (cfg.hasCodeOnAdd !== false || m.mode === 'edit') {
        if (!code) return;
      }
      if (m.mode === 'add' && cfg.codePattern && !cfg.codePattern.test(code)) {
        toast.error(t(cfg.codeHintKey ?? 'users.classifiers.codeHint3'));
        return;
      }
      if (m.mode === 'edit' && cfg.codePattern && !cfg.codePattern.test(code)) {
        toast.error(t(cfg.codeHintKey ?? 'users.classifiers.codeHint3'));
        return;
      }
      if (!m.name.trim()) {
        toast.error(t('editForm.fillRequired'));
        return;
      }
      if (cfg.maxNameLength && m.name.trim().length > cfg.maxNameLength) {
        toast.error(t(cfg.nameHintKey ?? 'editForm.fillRequired'));
        return;
      }
      if (cfg.extraSelect && !m[cfg.extraSelect.field]) {
        toast.error(t('editForm.fillRequired'));
        return;
      }
      const body: Record<string, unknown> = {
        name: m.name.trim(),
        description: m.description.trim() || null,
        is_active: m.is_active,
      };
      if (m.mode === 'add' && cfg.hasCodeOnAdd !== false) body.code = code;
      if (m.mode === 'edit' && cfg.hasCodeOnAdd !== false) body.code = code;
      if (cfg.extraSelect) body[cfg.extraSelect.field] = m[cfg.extraSelect.field];

      await saveMutation.mutateAsync({
        method: m.mode === 'add' ? 'POST' : 'PUT',
        path: m.mode === 'add' ? cfg.createPath : cfg.updatePath(String(m.code ?? '').trim()),
        body,
      });
      closeModal();
    } catch {
      /* toast from mutation */
    }
  };

  const closeModal = () => {
    setModal({ open: false });
    setCodeDraft('');
  };

  const handleDelete = async (kind: Tab, code: string) => {
    const ok = await confirm({
      title: t('common.confirmation'),
      message: t('users.classifiers.deleteConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const cfg = tabs.find((x) => x.id === kind);
    if (!cfg) return;
    const path = cfg.deletePath(code);
    deleteMutation.mutate(path);
  };

  const handleToggleActive = (kind: Tab, code: string, isActive: boolean) => {
    const cfg = tabs.find((x) => x.id === kind);
    if (!cfg) return;
    const path = isActive ? cfg.deactivatePath(code) : cfg.activatePath(code);
    toggleActiveMutation.mutate({ path });
  };

  const tabBtn = (id: Tab, label: string) => (
    <Button
      type="button"
      variant={tab === id ? 'default' : 'outline'}
      size="sm"
      onClick={() => setTab(id)}
      className={tab === id ? '' : ''}
    >
      {label}
    </Button>
  );

  const renderPaging = (total: number) => {
    const pageSize = pageSizeByTab[tab];
    const pageIndex = pageIndexByTab[tab];
    const pageCount =
      pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / (pageSize as 10 | 20 | 30)));
    const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
    const from =
      total === 0 ? 0 : pageSize === 'all' ? 1 : safePageIndex * (pageSize as number) + 1;
    const to =
      total === 0
        ? 0
        : pageSize === 'all'
          ? total
          : Math.min((safePageIndex + 1) * (pageSize as number), total);

    if (safePageIndex !== pageIndex && pageSize !== 'all') {
      setPageIndexByTab((prev) => ({ ...prev, [tab]: safePageIndex }));
    }

    return (
      <TablePaginationBar
        total={total}
        from={from}
        to={to}
        pageSize={pageSize}
        pageIndex={safePageIndex}
        pageCount={pageCount}
        onPageSizeChange={(next) => {
          setPageSizeByTab((prev) => ({ ...prev, [tab]: next }));
          setPageIndexByTab((prev) => ({ ...prev, [tab]: 0 }));
        }}
        onPageIndexChange={(next) => setPageIndexByTab((prev) => ({ ...prev, [tab]: next }))}
        className="px-3 pb-3 pt-2"
      />
    );
  };

  const sortAndPage = <T,>(
    rows: T[],
    getters: {
      code: (r: T) => string;
      name: (r: T) => string;
      description: (r: T) => string;
      active: (r: T) => boolean;
    }
  ): { rows: T[]; total: number; paging: ReactElement } => {
    const { key, dir } = sortByTab[tab];
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (key === 'active') cmp = Number(getters.active(a)) - Number(getters.active(b));
      else {
        const av =
          key === 'code'
            ? getters.code(a)
            : key === 'name'
              ? getters.name(a)
              : getters.description(a);
        const bv =
          key === 'code'
            ? getters.code(b)
            : key === 'name'
              ? getters.name(b)
              : getters.description(b);
        cmp = (av ?? '').localeCompare(bv ?? '', undefined, { sensitivity: 'base' });
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    const total = sorted.length;
    const pageSize = pageSizeByTab[tab];
    const pageIndex = pageIndexByTab[tab];
    let slice = sorted;
    if (pageSize !== 'all') {
      const size = pageSize as number;
      const pageCount = Math.max(1, Math.ceil(total / size));
      const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
      const start = safePageIndex * size;
      const end = Math.min(start + size, total);
      slice = sorted.slice(start, end);
      if (safePageIndex !== pageIndex) {
        setPageIndexByTab((prev) => ({ ...prev, [tab]: safePageIndex }));
      }
    } else if (pageIndex !== 0) {
      setPageIndexByTab((prev) => ({ ...prev, [tab]: 0 }));
    }

    return { rows: slice, total, paging: renderPaging(total) };
  };

  return (
    <div
      id={rootId}
      className={`mt-10 space-y-4 border-t border-border pt-8${rootId ? ' scroll-mt-24' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold">{t(titleKey)}</h2>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-3xl">{t(introKey)}</p>
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
        {tabs.map((cfg) => tabBtn(cfg.id, t(cfg.labelKey)))}
        <div className="flex-1 min-w-[14rem]">
          <Input
            value={searchByTab[tab] ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              setSearchByTab((prev) => ({ ...prev, [tab]: next }));
              setPageIndexByTab((prev) => ({ ...prev, [tab]: 0 }));
            }}
            placeholder={t('users.search')}
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200"
          onClick={() => {
            setCodeDraft('');
            openAdd();
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t(activeTab.addKey)}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        {(() => {
          const data = rowsByTab[tab] ?? [];
          const search = (searchByTab[tab] ?? '').trim().toLowerCase();
          const filtered =
            search === ''
              ? data
              : data.filter((r) => {
                  const code = String(r[activeTab.codeField] ?? '').toLowerCase();
                  const name = String(r[activeTab.nameField] ?? '').toLowerCase();
                  const description = String(r.description ?? '').toLowerCase();
                  return (
                    code.includes(search) || name.includes(search) || description.includes(search)
                  );
                });
          const { rows, paging } = sortAndPage<ClassifierRow>(filtered, {
            code: (r) => String(r[activeTab.codeField] ?? ''),
            name: (r) => String(r[activeTab.nameField] ?? ''),
            description: (r) => String(r.description ?? '').trim(),
            active: (r) => Boolean(r.is_active),
          });
          return (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t('common.actions')}</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('code')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {t('users.classifiers.code')}
                        {sortIndicator('code')}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {t('users.classifiers.name')}
                        {sortIndicator('name')}
                      </button>
                    </TableHead>
                    {activeTab.extraSelect && (
                      <TableHead>{t(activeTab.extraSelect.labelKey)}</TableHead>
                    )}
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('description')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {t('users.classifiers.description')}
                        {sortIndicator('description')}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('active')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {t('users.active')}
                        {sortIndicator('active')}
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const columnCount = 5 + (activeTab.extraSelect ? 1 : 0);
                    if (loadingByTab[tab]) {
                      return (
                        <TableRow>
                          <TableCell colSpan={columnCount} className="text-muted-foreground">
                            {t('common.loading')}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (rows.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={columnCount} className="text-muted-foreground">
                            {t('users.noResults')}
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const extraLookup = activeTab.extraSelect
                      ? new Map(
                          (rowsByTab[activeTab.extraSelect.sourceTab] ?? []).map((r) => [
                            String(r[activeTab.extraSelect!.optionCodeField] ?? '').trim(),
                            String(r[activeTab.extraSelect!.optionNameField] ?? '').trim(),
                          ])
                        )
                      : null;
                    return rows.map((row) => {
                      const code = String(row[activeTab.codeField] ?? '');
                      const extraCode = activeTab.extraSelect
                        ? String(row[activeTab.extraSelect.field] ?? '').trim()
                        : '';
                      const extraName = extraLookup?.get(extraCode) ?? '';
                      return (
                        <TableRow key={code}>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="hover:text-foreground"
                                onClick={() => openEdit(row)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  handleToggleActive(tab, code, Boolean(row.is_active))
                                }
                                className={
                                  row.is_active ? 'hover:text-destructive' : 'hover:text-foreground'
                                }
                                disabled={toggleActiveMutation.isPending}
                                title={
                                  row.is_active ? t('common.deactivate') : t('common.activate')
                                }
                                data-testid="classifier-toggle-btn"
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
                                onClick={() => void handleDelete(tab, code)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{code}</TableCell>
                          <TableCell>{String(row[activeTab.nameField] ?? '')}</TableCell>
                          {activeTab.extraSelect && (
                            <TableCell>{extraName || (extraCode ? extraCode : '—')}</TableCell>
                          )}
                          <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                            {(row.description ?? '').trim() || '—'}
                          </TableCell>
                          <TableCell>{row.is_active ? t('common.yes') : t('common.no')}</TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
              {paging}
            </>
          );
        })()}
      </div>

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div
            className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
            data-testid="classifier-modal"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold">
                {modal.mode === 'add' ? t(activeTab.addKey) : t(activeTab.editKey)}
              </h3>
              <Button type="button" variant="ghost" size="icon-sm" onClick={closeModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {activeTab.hasCodeOnAdd !== false && (
              <Field>
                <FieldLabel>
                  {t('users.classifiers.code')} <RequiredMark />
                </FieldLabel>
                <Input
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
                  maxLength={activeTab.maxCodeLength ?? 10}
                  className="font-mono"
                  placeholder={
                    activeTab.maxCodeLength === 5
                      ? 'ABCDE'
                      : activeTab.maxCodeLength === 1
                        ? 'A'
                        : 'ABC'
                  }
                  data-testid="classifier-code-input"
                />
                {activeTab.codeHintKey && (
                  <p className="text-xs text-muted-foreground mt-1">{t(activeTab.codeHintKey)}</p>
                )}
              </Field>
            )}

            <Field>
              <FieldLabel>
                {t('users.classifiers.name')} <RequiredMark />
              </FieldLabel>
              <Input
                value={modal.name}
                onChange={(e) => setModal((m) => (m.open ? { ...m, name: e.target.value } : m))}
                maxLength={activeTab.maxNameLength ?? 100}
                data-testid="classifier-name-input"
              />
              {activeTab.nameHintKey && (
                <p className="text-xs text-muted-foreground mt-1">{t(activeTab.nameHintKey)}</p>
              )}
            </Field>

            {activeTab.extraSelect && (
              <Field>
                <FieldLabel>
                  {t(activeTab.extraSelect.labelKey)} <RequiredMark />
                </FieldLabel>
                <SearchableSelect
                  value={modal[activeTab.extraSelect.field] ?? ''}
                  onChange={(next) =>
                    setModal((m) => (m.open ? { ...m, [activeTab.extraSelect!.field]: next } : m))
                  }
                  options={(rowsByTab[activeTab.extraSelect.sourceTab] ?? []).map((row) => {
                    const code = String(row[activeTab.extraSelect!.optionCodeField] ?? '').trim();
                    const name = String(row[activeTab.extraSelect!.optionNameField] ?? '').trim();
                    return {
                      value: code,
                      label: `${name} (${code})`,
                    };
                  })}
                  placeholder={t('common.select')}
                  allowClear
                />
              </Field>
            )}

            <Field>
              <FieldLabel>{t('users.classifiers.description')}</FieldLabel>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={modal.description}
                onChange={(e) =>
                  setModal((m) => (m.open ? { ...m, description: e.target.value } : m))
                }
              />
            </Field>

            <div className="flex items-center gap-2">
              <Checkbox
                id="clf-active"
                checked={modal.is_active}
                onCheckedChange={(v) =>
                  setModal((m) => (m.open ? { ...m, is_active: v === true } : m))
                }
              />
              <Label htmlFor="clf-active" className="text-sm font-normal cursor-pointer">
                {t('users.active')}
              </Label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap gap-2">
                {modal.mode === 'edit' && modal.code ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={saveMutation.isPending || deleteMutation.isPending}
                    onClick={async () => {
                      const targetCode = String(modal.code ?? '').trim();
                      const targetTab = modal.tab;
                      if (!targetCode) return;
                      const ok = await confirm({
                        title: t('common.confirmation'),
                        message: t('users.classifiers.deleteConfirm'),
                        confirmText: t('common.delete'),
                        cancelText: t('common.cancel'),
                        destructive: true,
                      });
                      if (!ok) return;
                      const cfg = tabs.find((x) => x.id === targetTab);
                      if (!cfg) return;
                      try {
                        await deleteMutation.mutateAsync(cfg.deletePath(targetCode));
                        closeModal();
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
                <Button type="button" variant="outline" onClick={closeModal}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" disabled={saveMutation.isPending} onClick={handleSubmitModal}>
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

export function UserClassifiersSection({
  showAdminClassifiersLink = false,
  rootId = 'users-classifiers-section',
}: { showAdminClassifiersLink?: boolean; rootId?: string } = {}) {
  return (
    <ClassifiersSection
      titleKey="users.classifiers.title"
      introKey="users.classifiers.intro"
      tabs={USER_TABS}
      rootId={rootId}
      extraInvalidateKeys={[
        queryKeys.languages,
        queryKeys.adminRoles,
        queryKeys.adminGroups,
        queryKeys.adminUsers,
      ]}
      showAdminClassifiersLink={showAdminClassifiersLink}
    />
  );
}

export function LlmClassifiersSection({
  showAdminClassifiersLink = false,
  rootId,
}: { showAdminClassifiersLink?: boolean; rootId?: string } = {}) {
  return (
    <ClassifiersSection
      titleKey="llmClassifiers.title"
      introKey="llmClassifiers.intro"
      tabs={LLM_TABS}
      rootId={rootId}
      extraInvalidateKeys={[
        queryKeys.llms,
        queryKeys.llmNames,
        queryKeys.modalities,
        queryKeys.currencies,
      ]}
      showAdminClassifiersLink={showAdminClassifiersLink}
    />
  );
}

export function ResultTypeClassifiersSection({
  showAdminClassifiersLink = false,
  rootId,
}: { showAdminClassifiersLink?: boolean; rootId?: string } = {}) {
  return (
    <ClassifiersSection
      titleKey="adminClassifiers.resultTypesTitle"
      introKey="adminClassifiers.resultTypesIntro"
      tabs={RESULT_TABS}
      rootId={rootId}
      showAdminClassifiersLink={showAdminClassifiersLink}
    />
  );
}
