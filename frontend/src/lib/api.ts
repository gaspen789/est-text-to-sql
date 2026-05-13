import type { LanguageModel } from '@/types';
import { STORAGE_KEY } from '@/contexts/language-context';
import { parseApiErrorJson } from '@/lib/apiErrorMessage';

const BASE_URL = import.meta.env.VITE_API_URL;

/** UI language for `Accept-Language` (mirrors LanguageContext localStorage). */
export function getClientAcceptLanguage(): string {
  if (typeof localStorage === 'undefined') return 'et';
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'en' || raw === 'et' ? raw : 'et';
}

export const queryKeys = {
  llms: ['llms'] as const,
  llmNames: ['llm-names'] as const,
  languages: ['languages'] as const,
  modalities: ['modalities'] as const,
  currencies: ['currencies'] as const,
  unitTypes: ['unit-types'] as const,
  resultTypes: ['result-types'] as const,
  userRoles: ['user-roles'] as const,
  userGroups: ['user-groups'] as const,
  myDataStructure: ['my-data-structure'] as const,
  userGlobalInstruction: ['user-global-instruction'] as const,
  adminUsers: ['admin-users'] as const,
  adminRoles: ['admin-roles'] as const,
  adminGroups: ['admin-groups'] as const,
  adminClassifierLanguages: ['admin-classifier-languages'] as const,
  adminClassifierRoles: ['admin-classifier-roles'] as const,
  adminClassifierGroups: ['admin-classifier-groups'] as const,
  adminClassifierCountries: ['admin-classifier-countries'] as const,
  adminClassifierCompanies: ['admin-classifier-companies'] as const,
  adminClassifierLlmGroups: ['admin-classifier-llm-groups'] as const,
  adminClassifierModalities: ['admin-classifier-modalities'] as const,
  adminClassifierCurrencies: ['admin-classifier-currencies'] as const,
  adminClassifierResultTypes: ['admin-classifier-result-types'] as const,
  adminDatabases: ['admin-databases'] as const,
  adminDatabaseDetail: (databaseId: number) => ['admin-database-detail', databaseId] as const,
  adminDatabaseResources: (databaseId: number) => ['admin-database-resources', databaseId] as const,
  adminDbmsVersions: ['admin-classifier-dbms-versions'] as const,
  adminDbmsVersionsActive: ['admin-classifier-dbms-versions-active'] as const,
  adminDbms: ['admin-classifier-dbms'] as const,
  adminTableTypes: ['admin-classifier-table-types'] as const,
  adminDataAccessGrants: (key: string) => ['admin-data-access-grants', key] as const,
  adminChatsOverview: (from: string | null, to: string | null, flaggedOnly: boolean = false) =>
    ['admin-chats-overview', from, to, flaggedOnly] as const,
  adminChats: (paramsKey: string) => ['admin-chats', paramsKey] as const,
  adminChatMessages: (
    chatId: number,
    from: string | null,
    to: string | null,
    flaggedOnly: boolean,
    dir: string
  ) => ['admin-chat-messages', chatId, from, to, flaggedOnly, dir] as const,
  apiData: (modelId: number) => ['llm-api', modelId] as const,
  supportedLanguages: (modelId: number) => ['llm-supported-language', modelId] as const,
  supportedModalities: (modelId: number) => ['llm-modality', modelId] as const,
  prices: (modelId: number) => ['llm-price', modelId] as const,
  allApiData: ['llm-api-all'] as const,
  allPrices: ['llm-price-all'] as const,
  allModalities: ['llm-modality-all'] as const,
  allLanguages: ['llm-supported-language-all'] as const,
};

function getHeaders(extra?: Record<string, string>): Record<string, string> {
  const userId = sessionStorage.getItem('userId');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': getClientAcceptLanguage(),
  };
  if (userId) {
    headers['x-user-id'] = userId;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

async function maybeDispatchAuthDeactivated(res: Response): Promise<void> {
  if (typeof window === 'undefined') return;
  if (res.ok) return;

  // Only attempt to parse structured API errors for auth-related failures.
  if (res.status !== 401 && res.status !== 403) return;

  const payload = await parseApiErrorJson(res.clone());
  if (payload?.code !== 'ACCOUNT_DEACTIVATED') return;

  window.dispatchEvent(new CustomEvent('auth:deactivated'));
}

export function apiGet(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: getHeaders(),
  }).then(async (res) => {
    await maybeDispatchAuthDeactivated(res);
    return res;
  });
}

export function apiPost(path: string, body?: any): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    await maybeDispatchAuthDeactivated(res);
    return res;
  });
}

export function apiPut(path: string, body?: any): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    await maybeDispatchAuthDeactivated(res);
    return res;
  });
}

export function apiDelete(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: getHeaders(),
  }).then(async (res) => {
    await maybeDispatchAuthDeactivated(res);
    return res;
  });
}

/** POST that returns the raw Response so the caller can read a streaming body. */
export function apiStream(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  }).then(async (res) => {
    await maybeDispatchAuthDeactivated(res);
    return res;
  });
}

export async function apiFetchJson<T>(path: string): Promise<T> {
  const res = await apiGet(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
}

export function normalizeModelParams(item: any): LanguageModel {
  return {
    ...item,
    llm_other_parameters: Array.isArray(item.llm_other_parameters)
      ? item.llm_other_parameters
      : Object.entries(item.llm_other_parameters || {}).map(([key, value]) => ({
          key,
          value,
        })),
  };
}
