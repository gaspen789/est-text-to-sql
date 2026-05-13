const UI_TRANSLATED_ROLE_CODES = new Set(['ADM', 'CHA', 'AUD']);

function normalizedRoleCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Label for a user role in the current UI language. Known codes use `roles.*` in locale JSON;
 * other codes fall back to the backend name.
 */
export function userRoleDisplayName(
  code: string,
  backendName: string,
  t: (key: string) => string
): string {
  const c = normalizedRoleCode(code);
  if (!c) return backendName;
  if (!UI_TRANSLATED_ROLE_CODES.has(c)) return backendName;

  const key = `roles.${c}`;
  const translated = t(key);
  return translated !== key ? translated : backendName;
}
