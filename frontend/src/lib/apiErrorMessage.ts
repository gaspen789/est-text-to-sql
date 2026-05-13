import type { TranslationParams } from '@/contexts/language-context';

/** JSON body shape for API errors from the Express backend */
export type ApiErrorJson = {
  code?: string;
  params?: TranslationParams;
  /** Legacy: older responses; kept for fallback */
  error?: string;
};

export function formatApiErrorMessage(
  t: (key: string, params?: TranslationParams) => string,
  payload: ApiErrorJson | null | undefined,
  fallbackKey: string
): string {
  if (payload?.code) {
    const key = `apiErrors.${payload.code}`;
    const msg = t(key, payload.params);
    if (msg !== key) return msg;
  }
  if (payload?.error && typeof payload.error === 'string' && payload.error.trim() !== '') {
    return payload.error;
  }
  return t(fallbackKey);
}

/** Parse JSON error body after a failed fetch (safe if body is empty or not JSON). */
export async function parseApiErrorJson(res: Response): Promise<ApiErrorJson | null> {
  try {
    const ct = res.headers.get('content-type');
    if (!ct?.includes('application/json')) return null;
    const data: unknown = await res.json();
    if (data && typeof data === 'object') {
      return data as ApiErrorJson;
    }
  } catch {
    /* ignore */
  }
  return null;
}
