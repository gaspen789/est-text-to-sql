export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Dangerous keywords matched as whole tokens via word boundaries.
// \b works correctly here: e.g. \bSET\b won't match "SETTINGS" because the 'S' after
// 'SET' keeps the token boundary from firing at that position.
const DANGEROUS_KEYWORDS = [
  'INTO',
  'COPY',
  'PG_SLEEP',
  'PG_READ_FILE',
  'LO_IMPORT',
  'LO_EXPORT',
  'SET',
  'GRANT',
  'REVOKE',
  'INSERT',
  'DROP'
];

const DANGEROUS_PATTERN = new RegExp(
  DANGEROUS_KEYWORDS.map((k) => `\\b${k}\\b`).join('|'),
  'i'
);

export function validateQuery(sql: string): ValidationResult {
  // 1. Trim and strip trailing semicolons
  const normalized = sql.trim().replace(/;+$/, '');

  if (!normalized) {
    return { valid: false, reason: 'Query is empty.' };
  }

  // 2. Must start with SELECT or WITH
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    return { valid: false, reason: 'Only SELECT or WITH queries are allowed.' };
  }

  // 3. No embedded semicolons (multi-statement)
  if (/;/.test(normalized)) {
    return { valid: false, reason: 'Multi-statement queries are not allowed.' };
  }

  // 4. No SQL comments
  if (/--/.test(normalized) || /\/\*/.test(normalized) || /\*\//.test(normalized)) {
    return {
      valid: false,
      reason: 'SQL comments are not allowed. Remove `--` and `/* */` comments from the query.',
    };
  }

  // 5. No dangerous keywords
  const match = normalized.match(DANGEROUS_PATTERN);
  if (match) {
    return { valid: false, reason: `Forbidden keyword detected: ${match[0].toUpperCase()}.` };
  }

  return { valid: true };
}
