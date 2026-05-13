import { db } from '../db/index.js';

/** Must match `result_type.result_type_code` (character(10), space-padded). */
const RESULT_TABULAR = 'TABULAR   ';
const RESULT_ERROR = 'ERROR     ';

export type LogSqlQueryParams = {
  chatId: number;
  triggerMessageId: number;
  /** `resource_database.database_id` as string (usually a bigint). */
  databaseId?: string | null;
  query: string;
  isSuccessful: boolean;
  executionTimeMs: number | null;
  resultRowCount: number | null;
  errorMessage: string | null;
  /**
   * Best-effort extracted resources used by the SQL query, scoped to `databaseId`.
   * Names should be unquoted, as stored in `resource_* .name`.
   */
  usedSchemas?: string[];
  usedTables?: Array<{ schema: string; table: string }>;
  usedColumns?: Array<{ schema: string; table: string; column: string }>;
};

/**
 * Persists an LLM-generated SQL string into `sql_query`.
 *
 * Note: the `sql_query.generated_prompt_context` column has been removed from the
 * schema, so we no longer attempt to store prompt context here.
 */
export async function logSqlQueryExecution(params: LogSqlQueryParams): Promise<void> {
  const query = String(params.query ?? '').slice(0, 20000);
  if (!query.trim()) {
    return;
  }

  const err =
    params.errorMessage != null && String(params.errorMessage).trim()
      ? String(params.errorMessage).slice(0, 10000)
      : null;

  const resultCode = params.isSuccessful ? RESULT_TABULAR : RESULT_ERROR;

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO sql_query (
           chat_id,
           trigger_message_id,
           result_type_code,
           query,
           is_successful,
           execution_time_ms,
           result_row_count,
           error_message
         )
         VALUES (
           $1::bigint,
           $2::bigint,
           $3::character(10),
           $4::character varying(20000),
           $5::boolean,
           $6::integer,
           $7::integer,
           $8::character varying(10000)
         )
         RETURNING sql_query_id`,
        [
          params.chatId,
          params.triggerMessageId,
          resultCode,
          query,
          params.isSuccessful,
          params.executionTimeMs,
          params.resultRowCount,
          err,
        ]
      );

      const sqlQueryId = inserted.rows[0]?.sql_query_id as number | undefined;
      const databaseId = params.databaseId != null ? String(params.databaseId).trim() : '';
      // Historically callers passed a friendly name (e.g. "AdventureWorks") instead of the
      // numeric `resource_database.database_id` bigint. Best-effort resolve name → id so
      // we can still log resource usage.
      let resolvedDatabaseId: string | null = null;
      if (databaseId) {
        if (/^\d+$/.test(databaseId)) {
          resolvedDatabaseId = databaseId;
        } else {
          const r = await client.query(
            `SELECT rd.database_id::text AS database_id
             FROM resource_database rd
             JOIN resource r ON r.resource_id = rd.database_id AND r.is_active = TRUE
             WHERE rd.name = $1::text
             LIMIT 1`,
            [databaseId]
          );
          const found = r.rows[0]?.database_id;
          if (typeof found === 'string' && /^\d+$/.test(found.trim())) {
            resolvedDatabaseId = found.trim();
          }
        }
      }

      if (sqlQueryId && resolvedDatabaseId) {
        const resourceIds = new Set<number>();

        // Always log the chosen database as "used".
        resourceIds.add(Number(resolvedDatabaseId));

        const usedSchemas = (params.usedSchemas ?? [])
          .map((s) => String(s ?? '').trim())
          .filter(Boolean);
        if (usedSchemas.length > 0) {
          const r = await client.query(
            `SELECT schema_id::bigint AS resource_id
             FROM resource_schema
             WHERE database_id = $1::bigint
               AND name = ANY($2::text[])`,
            [resolvedDatabaseId, usedSchemas]
          );
          for (const row of r.rows as Array<{ resource_id: number }>) resourceIds.add(row.resource_id);
        }

        const usedTables = (params.usedTables ?? []).filter(
          (t) => t && String(t.schema ?? '').trim() && String(t.table ?? '').trim()
        );
        if (usedTables.length > 0) {
          const schemaNames = usedTables.map((t) => String(t.schema).trim());
          const tableNames = usedTables.map((t) => String(t.table).trim());

          const tbl = await client.query(
            `SELECT rt.table_id::bigint AS resource_id
             FROM resource_table rt
             JOIN resource_schema rs ON rs.schema_id = rt.schema_id
             JOIN (
               SELECT * FROM UNNEST($2::text[], $3::text[]) AS x(schema_name, relation_name)
             ) u ON u.schema_name = rs.name AND u.relation_name = rt.name
             WHERE rs.database_id = $1::bigint`,
            [resolvedDatabaseId, schemaNames, tableNames]
          );
          for (const row of tbl.rows as Array<{ resource_id: number }>) resourceIds.add(row.resource_id);
        }

        const usedColumns = (params.usedColumns ?? []).filter(
          (c) =>
            c &&
            String(c.schema ?? '').trim() &&
            String(c.table ?? '').trim() &&
            String(c.column ?? '').trim()
        );
        if (usedColumns.length > 0) {
          const schemaNames = usedColumns.map((c) => String(c.schema).trim());
          const tableNames = usedColumns.map((c) => String(c.table).trim());
          const columnNames = usedColumns.map((c) => String(c.column).trim());

          const col = await client.query(
            `SELECT rc.column_id::bigint AS resource_id
             FROM resource_column rc
             JOIN resource_table rt ON rt.table_id = rc.table_id
             JOIN resource_schema rs ON rs.schema_id = rt.schema_id
             JOIN (
               SELECT * FROM UNNEST($2::text[], $3::text[], $4::text[]) AS x(schema_name, table_name, column_name)
             ) u
               ON u.schema_name = rs.name
              AND u.table_name = rt.name
              AND u.column_name = rc.name
             WHERE rs.database_id = $1::bigint`,
            [resolvedDatabaseId, schemaNames, tableNames, columnNames]
          );
          for (const row of col.rows as Array<{ resource_id: number }>) resourceIds.add(row.resource_id);
        }

        const ids = Array.from(resourceIds.values());
        if (ids.length > 0) {
          await client.query(
            `INSERT INTO sql_query_resource_usage (resource_id, sql_query_id)
             SELECT x::bigint, $2::bigint
             FROM UNNEST($1::bigint[]) AS x
             ON CONFLICT DO NOTHING`,
            [ids, sqlQueryId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('logSqlQueryExecution:', e);
  }
}
