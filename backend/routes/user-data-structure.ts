import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { getOrCreatePool } from '../services/pool-manager.js';
import { decrypt } from '../services/encryption.js';
import { isViewLikeTableTypeName } from '../services/relation-kind.js';

export const userDataStructureRouter = Router();

function getUserIdFromHeader(req: Request): number | null {
  const userId = req.headers['x-user-id'];
  if (
    !userId ||
    typeof userId !== 'string' ||
    !Number.isInteger(Number(userId)) ||
    Number(userId) <= 0
  ) {
    return null;
  }
  return Number(userId);
}

async function isAdminUser(appUserId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
     FROM app_user_role_assignment
     WHERE app_user_id = $1
       AND user_role_code = 'ADM'
     LIMIT 1`,
    [appUserId]
  );
  return result.rows.length > 0;
}

type TableRow = {
  table_id: number;
  database_id: number;
  database_name: string;
  database_comment_for_user: string | null;
  schema_name: string;
  schema_comment_for_user: string | null;
  table_name: string;
  table_comment_for_user: string | null;
  table_type_name: string | null;
};

/** Schemas the user may access (DB- or schema-level grant) that have no registered tables in the catalog. */
type EmptySchemaRow = {
  database_id: number;
  database_name: string;
  database_comment_for_user: string | null;
  schema_name: string;
  schema_comment_for_user: string | null;
};

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
  comment_for_user?: string | null;
};

userDataStructureRouter.get('/api/me/data-structure', async (req: Request, res: Response) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

  try {
    const admin = await isAdminUser(userId);

    const tablesSql = `
      WITH member_groups AS (
        SELECT user_group_code
        FROM app_user_group_member
        WHERE app_user_id = $1
      ),
      granted AS (
        SELECT r.resource_id
        FROM resource r
        WHERE $2::boolean = TRUE
          AND r.is_active = TRUE
        UNION
        SELECT DISTINCT ar.resource_id
        FROM access_right ar
        INNER JOIN member_groups mg ON mg.user_group_code = ar.user_group_code
        WHERE $2::boolean = FALSE
      ),
      from_table AS (
        SELECT
          rt.table_id,
          rd.database_id,
          rd.name AS database_name,
          r_d.comment_for_user AS database_comment_for_user,
          rs.name AS schema_name,
          r_s.comment_for_user AS schema_comment_for_user,
          rt.name AS table_name,
          r_t.comment_for_user AS table_comment_for_user,
          tt.name AS table_type_name
        FROM granted g
        INNER JOIN resource_table rt ON rt.table_id = g.resource_id
        INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
        LEFT JOIN table_type tt ON tt.table_type_id = rt.table_type_id
        INNER JOIN resource_schema rs ON rs.schema_id = rt.schema_id
        INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
        INNER JOIN resource_database rd ON rd.database_id = rs.database_id
        INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
      ),
      from_schema AS (
        SELECT
          rt.table_id,
          rd.database_id,
          rd.name AS database_name,
          r_d.comment_for_user AS database_comment_for_user,
          rs.name AS schema_name,
          r_s.comment_for_user AS schema_comment_for_user,
          rt.name AS table_name,
          r_t.comment_for_user AS table_comment_for_user,
          tt.name AS table_type_name
        FROM granted g
        INNER JOIN resource_schema rs ON rs.schema_id = g.resource_id
        INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
        INNER JOIN resource_database rd ON rd.database_id = rs.database_id
        INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
        INNER JOIN resource_table rt ON rt.schema_id = rs.schema_id
        INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
        LEFT JOIN table_type tt ON tt.table_type_id = rt.table_type_id
      ),
      from_database AS (
        SELECT
          rt.table_id,
          rd.database_id,
          rd.name AS database_name,
          r_d.comment_for_user AS database_comment_for_user,
          rs.name AS schema_name,
          r_s.comment_for_user AS schema_comment_for_user,
          rt.name AS table_name,
          r_t.comment_for_user AS table_comment_for_user,
          tt.name AS table_type_name
        FROM granted g
        INNER JOIN resource_database rd ON rd.database_id = g.resource_id
        INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
        INNER JOIN resource_schema rs ON rs.database_id = rd.database_id
        INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
        INNER JOIN resource_table rt ON rt.schema_id = rs.schema_id
        INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
        LEFT JOIN table_type tt ON tt.table_type_id = rt.table_type_id
      ),
      combined AS (
        SELECT * FROM from_table
        UNION ALL
        SELECT * FROM from_schema
        UNION ALL
        SELECT * FROM from_database
      )
      SELECT DISTINCT ON (table_id)
        table_id,
        database_id,
        database_name,
        database_comment_for_user,
        schema_name,
        schema_comment_for_user,
        table_name,
        table_comment_for_user,
        table_type_name
      FROM combined
      ORDER BY table_id, database_name, schema_name, table_name
    `;

    const emptySchemasSql = `
      WITH member_groups AS (
        SELECT user_group_code
        FROM app_user_group_member
        WHERE app_user_id = $1
      ),
      granted AS (
        SELECT r.resource_id
        FROM resource r
        WHERE $2::boolean = TRUE
          AND r.is_active = TRUE
        UNION
        SELECT DISTINCT ar.resource_id
        FROM access_right ar
        INNER JOIN member_groups mg ON mg.user_group_code = ar.user_group_code
        WHERE $2::boolean = FALSE
      ),
      schema_has_registered_relation AS (
        SELECT rt.schema_id
        FROM resource_table rt
        INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
      ),
      from_schema_grant AS (
        SELECT
          rd.database_id,
          rd.name AS database_name,
          r_d.comment_for_user AS database_comment_for_user,
          rs.name AS schema_name,
          r_s.comment_for_user AS schema_comment_for_user
        FROM granted g
        INNER JOIN resource_schema rs ON rs.schema_id = g.resource_id
        INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
        INNER JOIN resource_database rd ON rd.database_id = rs.database_id
        INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM schema_has_registered_relation t WHERE t.schema_id = rs.schema_id
        )
      ),
      from_database_grant AS (
        SELECT
          rd.database_id,
          rd.name AS database_name,
          r_d.comment_for_user AS database_comment_for_user,
          rs.name AS schema_name,
          r_s.comment_for_user AS schema_comment_for_user
        FROM granted g
        INNER JOIN resource_database rd ON rd.database_id = g.resource_id
        INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
        INNER JOIN resource_schema rs ON rs.database_id = rd.database_id
        INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM schema_has_registered_relation t WHERE t.schema_id = rs.schema_id
        )
      ),
      combined_empty AS (
        SELECT * FROM from_schema_grant
        UNION
        SELECT * FROM from_database_grant
      )
      SELECT DISTINCT database_id, database_name, database_comment_for_user, schema_name, schema_comment_for_user
      FROM combined_empty
      ORDER BY database_name, schema_name
    `;

    const [tablesResult, emptySchemasResult] = await Promise.all([
      db.query(tablesSql, [userId, admin]),
      db.query(emptySchemasSql, [userId, admin]),
    ]);

    const tableRows = tablesResult.rows as TableRow[];
    const viewRows = tableRows.filter((r) => isViewLikeTableTypeName(r.table_type_name));
    const baseTableRows = tableRows.filter((r) => !isViewLikeTableTypeName(r.table_type_name));

    const emptySchemaRows = emptySchemasResult.rows as EmptySchemaRow[];

    const columnCommentsByTableId = new Map<number, Map<string, string | null>>();
    const accessibleTableIds = [...new Set(tableRows.map((r) => r.table_id))];
    if (accessibleTableIds.length > 0) {
      const columnCommentsRes = await db.query(
        `SELECT rc.table_id, rc.name AS column_name, r.comment_for_user
         FROM resource_column rc
         INNER JOIN resource r ON r.resource_id = rc.column_id AND r.is_active = TRUE
         WHERE rc.table_id = ANY($1::bigint[])`,
        [accessibleTableIds]
      );
      for (const row of columnCommentsRes.rows as Array<{
        table_id: number;
        column_name: string;
        comment_for_user: string | null;
      }>) {
        const tableId = Number(row.table_id);
        let byColumn = columnCommentsByTableId.get(tableId);
        if (!byColumn) {
          byColumn = new Map();
          columnCommentsByTableId.set(tableId, byColumn);
        }
        byColumn.set(row.column_name, row.comment_for_user);
      }
    }

    if (tableRows.length === 0 && emptySchemaRows.length === 0) {
      res.json({ databases: [] });
      return;
    }

    const dbIds = [
      ...new Set([
        ...tableRows.map((r) => r.database_id),
        ...emptySchemaRows.map((r) => Number(r.database_id)),
      ]),
    ];
    const credResult = await db.query(
      `
      SELECT
        rd.database_id,
        rd.name AS database_name,
        dcc.host_name,
        dcc.port,
        dcc.username,
        dcc.password
      FROM resource_database rd
      JOIN LATERAL (
        SELECT encrypted_host_name AS host_name,
               port,
               encrypted_username  AS username,
               encrypted_password  AS password
        FROM database_connection_credential
        WHERE database_id = rd.database_id
          AND is_active = TRUE
        ORDER BY database_connection_credential_id DESC
        LIMIT 1
      ) dcc ON TRUE
      WHERE rd.database_id = ANY($1::bigint[])
      `,
      [dbIds]
    );

    type CredRow = {
      database_id: number;
      database_name: string;
      host_name: string;
      port: number;
      username: string;
      password: string;
    };

    const credByDbId = new Map<number, CredRow>();
    for (const row of credResult.rows as CredRow[]) {
      credByDbId.set(Number(row.database_id), row);
    }

    /** schema_name -> relation name (table or view) -> columns */
    const columnMap = new Map<
      number,
      Map<string, Map<string, ColumnInfo[] | { error: string }>>
    >();

    for (const dbId of dbIds) {
      columnMap.set(dbId, new Map());
    }

    for (const dbId of dbIds) {
      const cred = credByDbId.get(dbId);
      const tablesForDb = baseTableRows.filter((t) => t.database_id === dbId);
      const viewsForDb = viewRows.filter((v) => v.database_id === dbId);
      const schemaMap = columnMap.get(dbId)!;

      if (!cred) {
        for (const t of tablesForDb) {
          if (!schemaMap.has(t.schema_name)) schemaMap.set(t.schema_name, new Map());
          const tm = schemaMap.get(t.schema_name)!;
          tm.set(t.table_name, {
            error: 'No active connection credentials configured for this database.',
          });
        }
        for (const v of viewsForDb) {
          if (!schemaMap.has(v.schema_name)) schemaMap.set(v.schema_name, new Map());
          const tm = schemaMap.get(v.schema_name)!;
          tm.set(v.table_name, {
            error: 'No active connection credentials configured for this database.',
          });
        }
        continue;
      }

      const pairKey = (schema: string, rel: string) => `${schema}\0${rel}`;
      const tableIdByPair = new Map<string, number>();
      for (const t of [...tablesForDb, ...viewsForDb]) {
        tableIdByPair.set(pairKey(t.schema_name, t.table_name), t.table_id);
      }
      const uniquePairs: { schema_name: string; rel_name: string }[] = [];
      const seenPair = new Set<string>();
      for (const t of tablesForDb) {
        const k = pairKey(t.schema_name, t.table_name);
        if (seenPair.has(k)) continue;
        seenPair.add(k);
        uniquePairs.push({ schema_name: t.schema_name, rel_name: t.table_name });
      }
      for (const v of viewsForDb) {
        const k = pairKey(v.schema_name, v.table_name);
        if (seenPair.has(k)) continue;
        seenPair.add(k);
        uniquePairs.push({ schema_name: v.schema_name, rel_name: v.table_name });
      }

      if (uniquePairs.length === 0) {
        continue;
      }

      const pool = getOrCreatePool({
        host: decrypt(cred.host_name) ?? cred.host_name,
        port: Number(cred.port),
        database: cred.database_name,
        user: decrypt(cred.username) ?? cred.username,
        password: decrypt(cred.password) ?? cred.password,
      });

      const schemas = uniquePairs.map((p) => p.schema_name);
      const names = uniquePairs.map((p) => p.rel_name);

      try {
        const colRes = await pool.query(
          `
          SELECT
            n.nspname AS table_schema,
            c.relname  AS table_name,
            a.attname  AS column_name,
            CASE
              WHEN a.atttypid = 1043 THEN 'character varying'
              WHEN a.atttypid = 1042 THEN 'character'
              ELSE pg_catalog.format_type(a.atttypid, a.atttypmod)
            END AS data_type,
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
            CASE
              WHEN a.atttypmod > 0 AND a.atttypid IN (1042, 1043) THEN a.atttypmod - 4
              ELSE NULL
            END AS character_maximum_length,
            a.attnum AS ordinal_position
          FROM pg_catalog.pg_class c
          INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          INNER JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
          INNER JOIN UNNEST($1::text[], $2::text[]) AS pair(schema_name, rel_name)
            ON n.nspname = pair.schema_name AND c.relname = pair.rel_name
          WHERE a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY n.nspname, c.relname, a.attnum
          `,
          [schemas, names]
        );

        const colsByPair = new Map<string, ColumnInfo[]>();
        for (const row of colRes.rows as Array<{
          table_schema: string;
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
          character_maximum_length: number | null;
          ordinal_position: number;
        }>) {
          const k = pairKey(row.table_schema, row.table_name);
          const tableId = tableIdByPair.get(k);
          const col: ColumnInfo = {
            column_name: row.column_name,
            data_type: row.data_type,
            is_nullable: row.is_nullable,
            character_maximum_length: row.character_maximum_length,
            comment_for_user:
              tableId != null
                ? (columnCommentsByTableId.get(tableId)?.get(row.column_name) ?? null)
                : null,
          };
          const list = colsByPair.get(k);
          if (list) list.push(col);
          else colsByPair.set(k, [col]);
        }

        for (const t of tablesForDb) {
          if (!schemaMap.has(t.schema_name)) schemaMap.set(t.schema_name, new Map());
          const tm = schemaMap.get(t.schema_name)!;
          if (tm.has(t.table_name)) continue;
          const k = pairKey(t.schema_name, t.table_name);
          const cols = colsByPair.get(k);
          if (cols && cols.length > 0) tm.set(t.table_name, cols);
          else
            tm.set(t.table_name, {
              error: 'Table not found or has no visible columns.',
            });
        }
        for (const v of viewsForDb) {
          if (!schemaMap.has(v.schema_name)) schemaMap.set(v.schema_name, new Map());
          const tm = schemaMap.get(v.schema_name)!;
          if (tm.has(v.table_name)) continue;
          const k = pairKey(v.schema_name, v.table_name);
          const cols = colsByPair.get(k);
          if (cols && cols.length > 0) tm.set(v.table_name, cols);
          else
            tm.set(v.table_name, {
              error: 'View not found or has no visible columns.',
            });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const t of tablesForDb) {
          if (!schemaMap.has(t.schema_name)) schemaMap.set(t.schema_name, new Map());
          const tm = schemaMap.get(t.schema_name)!;
          tm.set(t.table_name, { error: msg });
        }
        for (const v of viewsForDb) {
          if (!schemaMap.has(v.schema_name)) schemaMap.set(v.schema_name, new Map());
          const tm = schemaMap.get(v.schema_name)!;
          tm.set(v.table_name, { error: msg });
        }
      }
    }

    const databasesOut = dbIds.map((databaseId) => {
      const meta = credByDbId.get(databaseId);
      const nameFromRow =
        tableRows.find((r) => r.database_id === databaseId)?.database_name ??
        emptySchemaRows.find((r) => Number(r.database_id) === databaseId)?.database_name ??
        '';
      const dbCommentFromRow =
        tableRows.find((r) => r.database_id === databaseId)?.database_comment_for_user ??
        emptySchemaRows.find((r) => Number(r.database_id) === databaseId)?.database_comment_for_user ??
        null;
      const schemaMap = columnMap.get(databaseId)!;

      const schemaNames = [
        ...new Set([
          ...tableRows.filter((t) => t.database_id === databaseId).map((t) => t.schema_name),
          ...viewRows.filter((v) => v.database_id === databaseId).map((v) => v.schema_name),
          ...emptySchemaRows
            .filter((r) => Number(r.database_id) === databaseId)
            .map((r) => r.schema_name),
        ]),
      ].sort((a, b) => a.localeCompare(b));

      const schemas = schemaNames.map((schemaName) => {
        const schemaCommentFromRow =
          tableRows.find((r) => r.database_id === databaseId && r.schema_name === schemaName)
            ?.schema_comment_for_user ??
          viewRows.find((r) => r.database_id === databaseId && r.schema_name === schemaName)
            ?.schema_comment_for_user ??
          emptySchemaRows.find(
            (r) => Number(r.database_id) === databaseId && r.schema_name === schemaName
          )?.schema_comment_for_user ??
          null;

        const tableNames = [
          ...new Set(
            baseTableRows
              .filter((t) => t.database_id === databaseId && t.schema_name === schemaName)
              .map((t) => t.table_name)
          ),
        ].sort((a, b) => a.localeCompare(b));

        const tables = tableNames.map((tableName) => {
          const tm = schemaMap.get(schemaName);
          const colEntry = tm?.get(tableName);
          let columns: ColumnInfo[] = [];
          let columnError: string | undefined;
          if (colEntry && Array.isArray(colEntry)) {
            columns = colEntry;
          } else if (colEntry && typeof colEntry === 'object' && 'error' in colEntry) {
            columnError = colEntry.error;
          }
          const tableCommentFromRow =
            baseTableRows.find(
              (r) =>
                r.database_id === databaseId &&
                r.schema_name === schemaName &&
                r.table_name === tableName
            )?.table_comment_for_user ?? null;
          return {
            table_name: tableName,
            comment_for_user: tableCommentFromRow,
            columns,
            column_error: columnError,
          };
        });

        const viewNames = [
          ...new Set(
            viewRows
              .filter((v) => v.database_id === databaseId && v.schema_name === schemaName)
              .map((v) => v.table_name)
          ),
        ].sort((a, b) => a.localeCompare(b));

        const views = viewNames.map((viewName) => {
          const tm = schemaMap.get(schemaName);
          const colEntry = tm?.get(viewName);
          let columns: ColumnInfo[] = [];
          let columnError: string | undefined;
          if (colEntry && Array.isArray(colEntry)) {
            columns = colEntry;
          } else if (colEntry && typeof colEntry === 'object' && 'error' in colEntry) {
            columnError = colEntry.error;
          }
          const viewCommentFromRow =
            viewRows.find(
              (r) =>
                r.database_id === databaseId &&
                r.schema_name === schemaName &&
                r.table_name === viewName
            )?.table_comment_for_user ?? null;
          return {
            view_name: viewName,
            comment_for_user: viewCommentFromRow,
            columns,
            column_error: columnError,
          };
        });

        return {
          schema_name: schemaName,
          comment_for_user: schemaCommentFromRow,
          tables,
          views,
        };
      });

      return {
        database_id: databaseId,
        database_name: meta?.database_name ?? nameFromRow,
        comment_for_user: dbCommentFromRow,
        schemas,
      };
    });

    res.json({ databases: databasesOut });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});
