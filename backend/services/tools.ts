import { tool } from 'ai';
import { z } from 'zod';
import { validateQuery } from './query-validator.js';
import { logSqlQueryExecution } from './sql-query-log.js';
import { applyRowLimit, type ExternalDbPool } from './external-db.js';

export interface DatabaseEntry {
  name: string;
  description: string;
  /**
   * Candidate read-only connections for this logical database.
   * When users belong to multiple groups, we may have multiple DB users that
   * correspond to those group names; we try them in order until one succeeds.
   */
  pools: ExternalDbPool[];
}

export type AllowedTable = {
  database_name: string;
  schema_name: string;
  table_name: string;
};

/** When set, each `execute_query` run is recorded in `sql_query`. */
export type SqlQueryLogContext = {
  chatId: number;
  triggerMessageId: number;
};

/**
 * Build a fast lookup: `"dbName\0schema\0table"` → true.
 * When `allowedTables` is empty the set is empty; callers that should bypass
 * (admins) must pass all tables — the resolution already happens upstream.
 */
function buildAllowedSet(allowedTables: AllowedTable[]): Set<string> {
  const s = new Set<string>();
  for (const t of allowedTables) {
    s.add(`${t.database_name}\0${t.schema_name}\0${t.table_name}`);
  }
  return s;
}

function isTableAllowed(
  allowed: Set<string>,
  databaseId: string,
  schema: string,
  tableName: string
): boolean {
  return allowed.has(`${databaseId}\0${schema}\0${tableName}`);
}

/**
 * EXTRACT(field FROM expr) uses the keyword FROM for the source expression, not for a
 * relation. Without masking, relation extraction falsely treats expr (e.g. a column)
 * as `FROM <table>` and rejects the query.
 */
function maskExtractFieldFromSource(sql: string): string {
  return sql.replace(/\bEXTRACT\s*\(\s*\w+\s+FROM\s+/gi, (m) =>
    m.replace(/\bFROM\s+/i, '__NOT_REL_FROM__ ')
  );
}

/**
 * Extract relation references from a SQL string so we can verify the user
 * may access every table mentioned and (best-effort) log used resources.
 *
 * Covers `FROM table`, `JOIN table`, `FROM schema.table`, plus common `AS alias`
 * patterns. Not a full parser but catches common cases an LLM will produce.
 */
function extractRelationRefsFromSql(sql: string): Array<{ schema: string; table: string; alias?: string }> {
  const refs: Array<{ schema: string; table: string; alias?: string }> = [];
  const scanSql = maskExtractFieldFromSource(sql);
  const pattern =
    /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:"?(\w+)"?\."?(\w+)"?|"?(\w+)"?)(?:\s+(?:AS\s+)?("?(\w+)"?))?/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(scanSql)) !== null) {
    if (m[1] && m[2]) {
      refs.push({ schema: m[1], table: m[2], alias: m[5] ? m[5] : undefined });
    } else if (m[3]) {
      const name = m[3].toLowerCase();
      if (['select', 'lateral', 'unnest', 'generate_series', 'values'].includes(name)) continue;
      refs.push({ schema: 'public', table: m[3], alias: m[5] ? m[5] : undefined });
    }
  }
  return refs;
}

function isAuthOrPrivilegeError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; message?: unknown } | null;
  const code = anyErr?.code;
  const codeStr = typeof code === 'string' ? code : null;
  if (codeStr && ['42501', '28000', '28P01'].includes(codeStr)) return true;
  // MySQL common access errors:
  // - ER_ACCESS_DENIED_ERROR = 1045, ER_DBACCESS_DENIED_ERROR = 1044
  const codeNum = typeof code === 'number' ? code : Number.isFinite(Number(code)) ? Number(code) : null;
  if (codeNum != null && [1045, 1044].includes(codeNum)) return true;

  const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
  if (!msg) return false;
  return (
    /\bpermission denied\b/i.test(msg) ||
    /\bnot authorized\b/i.test(msg) ||
    /\brole\b.*\bdoes not exist\b/i.test(msg) ||
    /\baccess denied\b/i.test(msg) ||
    /\bORA-01031\b/i.test(msg) // Oracle: insufficient privileges
  );
}

async function queryViaPools<T = unknown>(
  entry: DatabaseEntry,
  sql: string
): Promise<{ rows: T[] }> {
  if (!entry.pools.length) {
    throw new Error('No configured connection pools for this database.');
  }
  let lastErr: unknown = null;
  for (let i = 0; i < entry.pools.length; i++) {
    const pool = entry.pools[i]!;
    const client = await pool.connect();
    try {
      const res = await client.query(sql);
      return { rows: res.rows as T[] };
    } catch (e) {
      lastErr = e;
      if (i < entry.pools.length - 1 && isAuthOrPrivilegeError(e)) continue;
      throw e;
    } finally {
      await client.release();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sqlStringLiteral(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function preferredDbms(entry: DatabaseEntry): 'PGS' | 'MYQ' | 'ORA' {
  // Use the first pool as representative (they should be same DBMS for one logical db).
  return entry.pools[0]?.dbms ?? 'PGS';
}

export type RelationDescribeResult = {
  schema: string;
  table_name: string;
  columns: Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
  }>;
  primary_keys: string[];
  foreign_keys: Array<{
    column_name: string;
    references_table: string;
    references_column: string;
  }>;
};

/**
 * Load column / PK / FK metadata for one relation (same logic as the former describe_table tool).
 */
export async function fetchDescribeRelation(
  entry: DatabaseEntry,
  schema: string,
  table_name: string
): Promise<{ ok: true; data: RelationDescribeResult } | { ok: false; error: string }> {
  try {
    const dbms = preferredDbms(entry);
    const schLit = sqlStringLiteral(schema);
    const tblLit = sqlStringLiteral(table_name);

    const columnsSql =
      dbms === 'ORA'
        ? `SELECT column_name,
                 data_type,
                 CASE WHEN nullable = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable,
                 data_default AS column_default,
                 data_length AS character_maximum_length
           FROM all_tab_columns
           WHERE owner = ${schLit}
             AND table_name = ${tblLit}
           ORDER BY column_id`
        : dbms === 'MYQ'
          ? `SELECT column_name,
                   column_type AS data_type,
                   is_nullable,
                   column_default,
                   character_maximum_length
             FROM information_schema.columns
             WHERE table_schema = ${schLit}
               AND table_name = ${tblLit}
             ORDER BY ordinal_position`
          : `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
             FROM information_schema.columns
             WHERE table_schema = ${schLit}
               AND table_name = ${tblLit}
             ORDER BY ordinal_position`;

    const pkSql =
      dbms === 'ORA'
        ? `SELECT acc.column_name
           FROM all_constraints ac
           JOIN all_cons_columns acc
             ON acc.owner = ac.owner
            AND acc.constraint_name = ac.constraint_name
           WHERE ac.constraint_type = 'P'
             AND ac.owner = ${schLit}
             AND ac.table_name = ${tblLit}
           ORDER BY acc.position`
        : dbms === 'MYQ'
          ? `SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
              AND tc.table_name = kcu.table_name
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = ${schLit}
               AND tc.table_name = ${tblLit}
             ORDER BY kcu.ordinal_position`
          : `SELECT a.attname AS column_name
             FROM pg_catalog.pg_constraint c
             JOIN pg_catalog.pg_class t     ON t.oid = c.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
                                           AND a.attnum = ANY(c.conkey)
             WHERE c.contype = 'p'
               AND n.nspname = ${schLit}
               AND t.relname = ${tblLit}
             ORDER BY array_position(c.conkey, a.attnum)`;

    const fkSql =
      dbms === 'ORA'
        ? `SELECT acc.column_name AS column_name,
                 acc_r.table_name AS references_table,
                 acc_r.column_name AS references_column
           FROM all_constraints ac
           JOIN all_cons_columns acc
             ON acc.owner = ac.owner
            AND acc.constraint_name = ac.constraint_name
           JOIN all_constraints ac_r
             ON ac_r.owner = ac.r_owner
            AND ac_r.constraint_name = ac.r_constraint_name
           JOIN all_cons_columns acc_r
             ON acc_r.owner = ac_r.owner
            AND acc_r.constraint_name = ac_r.constraint_name
            AND acc_r.position = acc.position
           WHERE ac.constraint_type = 'R'
             AND ac.owner = ${schLit}
             AND ac.table_name = ${tblLit}`
        : dbms === 'MYQ'
          ? `SELECT kcu.column_name,
                   kcu.referenced_table_name  AS references_table,
                   kcu.referenced_column_name AS references_column
             FROM information_schema.key_column_usage kcu
             WHERE kcu.table_schema = ${schLit}
               AND kcu.table_name = ${tblLit}
               AND kcu.referenced_table_name IS NOT NULL
             ORDER BY kcu.ordinal_position`
          : `SELECT a.attname        AS column_name,
                    tf.relname       AS references_table,
                    af.attname       AS references_column
             FROM pg_catalog.pg_constraint c
             JOIN pg_catalog.pg_class t     ON t.oid = c.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
                                           AND a.attnum = ANY(c.conkey)
             JOIN pg_catalog.pg_class tf     ON tf.oid = c.confrelid
             JOIN pg_catalog.pg_attribute af ON af.attrelid = tf.oid
                                           AND af.attnum = c.confkey[array_position(c.conkey, a.attnum)]
             WHERE c.contype = 'f'
               AND n.nspname = ${schLit}
               AND t.relname = ${tblLit}
             ORDER BY array_position(c.conkey, a.attnum)`;

    const [columnsRes, pkRes, fkRes] = await Promise.all([
      queryViaPools<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
      }>(entry, columnsSql),
      queryViaPools<{ column_name: string }>(entry, pkSql),
      queryViaPools<{
        column_name: string;
        references_table: string;
        references_column: string;
      }>(entry, fkSql),
    ]);

    if (columnsRes.rows.length === 0) {
      return {
        ok: false,
        error: `Relation "${schema}.${table_name}" not found or not visible.`,
      };
    }

    return {
      ok: true,
      data: {
        schema,
        table_name,
        columns: columnsRes.rows,
        primary_keys: pkRes.rows.map((r) => r.column_name),
        foreign_keys: fkRes.rows,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatDescribeMarkdown(d: RelationDescribeResult): string {
  const colLines = d.columns.map(
    (c) =>
      `- \`${c.column_name}\`: ${c.data_type}${c.character_maximum_length != null ? `(${c.character_maximum_length})` : ''} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}${c.column_default != null ? ` default=${c.column_default}` : ''}`
  );
  const pk =
    d.primary_keys.length > 0 ? d.primary_keys.map((c) => `\`${c}\``).join(', ') : '*(none)*';
  const fk =
    d.foreign_keys.length > 0
      ? d.foreign_keys
          .map((f) => `\`${f.column_name}\` → \`${f.references_table}.${f.references_column}\``)
          .join('; ')
      : '*(none)*';
  return [
    `**Columns**`,
    ...colLines,
    `**Primary key:** ${pk}`,
    `**Foreign keys:** ${fk}`,
  ].join('\n');
}

/**
 * Markdown block with every allowed relation’s columns and keys, grouped by database.
 * Used in the system prompt or first user message so the model does not call discovery tools.
 */
export async function buildAccessibleSchemaMarkdown(
  databaseMap: Map<string, DatabaseEntry>,
  allowedTables: AllowedTable[]
): Promise<string> {
  const lines: string[] = [
    '## Accessible data model',
    '',
    'You may only query these databases and relations. Use `database_id` exactly as given when calling `execute_query`.',
    '',
  ];

  for (const [dbId, entry] of databaseMap) {
    lines.push(`### Database \`${dbId}\` (${entry.name})`);
    if (entry.description?.trim()) {
      lines.push(`${entry.description.trim()}`);
      lines.push('');
    }

    const forDb = allowedTables
      .filter((t) => t.database_name === dbId)
      .sort((a, b) => {
        const s = a.schema_name.localeCompare(b.schema_name);
        return s !== 0 ? s : a.table_name.localeCompare(b.table_name);
      });

    if (forDb.length === 0) {
      lines.push('*(No relations granted for this database.)*', '');
      continue;
    }

    for (const t of forDb) {
      lines.push(`#### \`${t.schema_name}.${t.table_name}\``);
      const res = await fetchDescribeRelation(entry, t.schema_name, t.table_name);
      if (!res.ok) {
        lines.push(`*Could not load metadata: ${res.error}*`, '');
        continue;
      }
      lines.push(formatDescribeMarkdown(res.data), '');
    }
  }

  return lines.join('\n').trimEnd();
}

function extractColumnRefsFromSql(
  sql: string,
  relations: Array<{ schema: string; table: string; alias?: string }>
): Array<{ schema: string; table: string; column: string }> {
  const aliasToRelation = new Map<string, { schema: string; table: string }>();
  for (const r of relations) {
    aliasToRelation.set(r.table, { schema: r.schema, table: r.table });
    if (r.alias) aliasToRelation.set(r.alias, { schema: r.schema, table: r.table });
  }

  const cols = new Map<string, { schema: string; table: string; column: string }>();

  // schema.table.column
  const triple = /"?(?<schema>\w+)"?\s*\.\s*"?(?<table>\w+)"?\s*\.\s*"?(?<column>\w+)"?/g;
  for (const m of sql.matchAll(triple)) {
    const g = m.groups as { schema?: string; table?: string; column?: string } | undefined;
    if (!g?.schema || !g?.table || !g?.column) continue;
    const key = `${g.schema}\0${g.table}\0${g.column}`;
    cols.set(key, { schema: g.schema, table: g.table, column: g.column });
  }

  // alias.column (or table.column)
  const double = /"?(?<rel>\w+)"?\s*\.\s*"?(?<column>\w+)"?/g;
  for (const m of sql.matchAll(double)) {
    const g = m.groups as { rel?: string; column?: string } | undefined;
    if (!g?.rel || !g?.column) continue;
    const rel = aliasToRelation.get(g.rel);
    if (!rel) continue;
    const key = `${rel.schema}\0${rel.table}\0${g.column}`;
    cols.set(key, { schema: rel.schema, table: rel.table, column: g.column });
  }

  return Array.from(cols.values());
}

export function buildTools(
  databaseMap: Map<string, DatabaseEntry>,
  allowedTables: AllowedTable[] = [],
  sqlLog?: SqlQueryLogContext
) {
  const allowed = buildAllowedSet(allowedTables);

  return {
    execute_query: tool({
      description:
        'Execute a read-only SELECT query against a database. Results are capped at 500 rows. Use database_id and relation names exactly as in the Accessible data model supplied in the prompt.',
      inputSchema: z.object({
        database_id: z.string().describe('Database ID string from the Accessible data model (same as in the database list).'),
        query: z
          .string()
          .describe(
            'A SELECT or WITH...SELECT SQL query. Do not include trailing semicolons.'
          ),
      }),
      execute: async ({ database_id, query }) => {
        const entry = databaseMap.get(database_id);
        if (!entry) {
          return { error: `Unknown database_id: "${database_id}".` };
        }

        const trimmed = query.trim().replace(/;+$/, '');

        const validation = validateQuery(trimmed);
        if (!validation.valid) {
          if (sqlLog) {
            void logSqlQueryExecution({
              chatId: sqlLog.chatId,
              triggerMessageId: sqlLog.triggerMessageId,
              query: trimmed,
              isSuccessful: false,
              executionTimeMs: null,
              resultRowCount: null,
              errorMessage: validation.reason ?? 'Query rejected.',
            });
          }
          return { error: `Query rejected: ${validation.reason}` };
        }

        const relationRefs = extractRelationRefsFromSql(trimmed);
        const denied = relationRefs.filter(
          (ref) => !isTableAllowed(allowed, database_id, ref.schema, ref.table)
        );
        if (denied.length > 0) {
          const names = denied.map((r) => `${r.schema}.${r.table}`).join(', ');
          const msg = `Access denied: you do not have permission to query: ${names}. Only use relations from the Accessible data model.`;
          if (sqlLog) {
            void logSqlQueryExecution({
              chatId: sqlLog.chatId,
              triggerMessageId: sqlLog.triggerMessageId,
              databaseId: database_id,
              query: trimmed,
              isSuccessful: false,
              executionTimeMs: null,
              resultRowCount: null,
              errorMessage: msg,
              usedSchemas: Array.from(new Set(relationRefs.map((r) => r.schema))),
              usedTables: relationRefs.map((r) => ({ schema: r.schema, table: r.table })),
              usedColumns: extractColumnRefsFromSql(trimmed, relationRefs),
            });
          }
          return { error: msg };
        }

        const dbms = preferredDbms(entry);
        const finalQuery = applyRowLimit(dbms, trimmed, 500);

        const usedSchemas = Array.from(new Set(relationRefs.map((r) => r.schema)));
        const usedTables = relationRefs.map((r) => ({ schema: r.schema, table: r.table }));
        const usedColumns = extractColumnRefsFromSql(trimmed, relationRefs);

        if (!entry.pools.length) {
          const msg = 'No configured connection pools for this database.';
          if (sqlLog) {
            void logSqlQueryExecution({
              chatId: sqlLog.chatId,
              triggerMessageId: sqlLog.triggerMessageId,
              databaseId: database_id,
              query: finalQuery,
              isSuccessful: false,
              executionTimeMs: null,
              resultRowCount: null,
              errorMessage: msg,
              usedSchemas,
              usedTables,
              usedColumns,
            });
          }
          return { error: msg };
        }

        let lastErr: unknown = null;
        for (let i = 0; i < entry.pools.length; i++) {
          const pool = entry.pools[i]!;
          const client = await pool.connect();
          try {
            if (client.beginReadOnly) {
              await client.beginReadOnly();
            }

            const t0 = Date.now();
            const result = await client.query(finalQuery);
            const executionTimeMs = Date.now() - t0;
            if (client.commit) {
              await client.commit();
            }

            const truncated = result.rowCount >= 500;
            if (sqlLog) {
              void logSqlQueryExecution({
                chatId: sqlLog.chatId,
                triggerMessageId: sqlLog.triggerMessageId,
                databaseId: database_id,
                query: finalQuery,
                isSuccessful: true,
                executionTimeMs,
                resultRowCount: result.rowCount,
                errorMessage: null,
                usedSchemas,
                usedTables,
                usedColumns,
              });
            }

            const toolResultForLlm = {
              columns: result.columns,
              rows: result.rows,
              row_count: result.rowCount,
              truncated,
            };
            const maxLogRows = 50;
            console.log('[execute_query] tool result passed to LLM (for natural-language answer)', {
              database_id,
              query: finalQuery,
              ...toolResultForLlm,
              ...(result.rows.length > maxLogRows
                ? {
                    rows: result.rows.slice(0, maxLogRows),
                    _logOnly: `${String(result.rows.length - maxLogRows)} more row(s) omitted from log; full rows are in the tool result`,
                  }
                : {}),
            });

            return toolResultForLlm;
          } catch (err: unknown) {
            lastErr = err;
            if (client.rollback) {
              await client.rollback().catch(() => {});
            }
            if (i < entry.pools.length - 1 && isAuthOrPrivilegeError(err)) {
              continue;
            }

            const errMsg = err instanceof Error ? err.message : String(err);
            if (sqlLog) {
              void logSqlQueryExecution({
                chatId: sqlLog.chatId,
                triggerMessageId: sqlLog.triggerMessageId,
                databaseId: database_id,
                query: finalQuery,
                isSuccessful: false,
                executionTimeMs: null,
                resultRowCount: null,
                errorMessage: errMsg,
                usedSchemas,
                usedTables,
                usedColumns,
              });
            }
            return { error: errMsg };
          } finally {
            await client.release();
          }
        }

        const errMsg =
          lastErr instanceof Error ? lastErr.message : lastErr != null ? String(lastErr) : 'Query failed.';
        if (sqlLog) {
          void logSqlQueryExecution({
            chatId: sqlLog.chatId,
            triggerMessageId: sqlLog.triggerMessageId,
            databaseId: database_id,
            query: finalQuery,
            isSuccessful: false,
            executionTimeMs: null,
            resultRowCount: null,
            errorMessage: errMsg,
            usedSchemas,
            usedTables,
            usedColumns,
          });
        }
        return { error: errMsg };
      },
    }),
  };
}
