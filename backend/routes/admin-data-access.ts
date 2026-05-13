import { Router, type Request, type Response } from 'express';
import { buildReadOnlyScriptForDbms, type GrantRowForSql, type SchemaRow } from '../lib/client-access-sql.js';
import { db } from '../db/index.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const adminDataAccessRouter = Router();

function getUserIdFromHeader(req: Request): number | null {
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string') return null;
  const n = Number(userId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
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

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Storage model expectation (DB):
 *   access_right(resource_id bigint, user_group_code char(5), ...)
 *   UNIQUE(resource_id, user_group_code) (recommended)
 *
 * resource_id points at `resource.resource_id` which is shared by:
 *   - resource_database.database_id
 *   - resource_schema.schema_id
 *   - resource_table.table_id (base tables, views, and materialized views)
 */

adminDataAccessRouter.get('/api/admin/data-access/grants', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const resourceId = parsePositiveInt(req.query.resource_id);
    const databaseId = parsePositiveInt(req.query.database_id);

    // Modes:
    // - resource_id set: exact resource only
    // - database_id set: all resources within that database (database+schemas+tables)
    // - no params: all grants in the system (used by the "all groups" overview table)
    const mode: 'resource' | 'database' | 'all' =
      resourceId != null ? 'resource' : databaseId != null ? 'database' : 'all';
    const idParam = resourceId ?? databaseId ?? null;

    const result = await db.query(
      `
      SELECT
        ug.user_group_code,
        ug.name AS user_group_name,
        p.resource_id,
        CASE
          WHEN rd_direct.database_id IS NOT NULL THEN 'DATABASE'
          WHEN rs_direct.schema_id IS NOT NULL THEN 'SCHEMA'
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) IN ('view', 'materialized view') THEN 'VIEW'
          WHEN rt_direct.table_id IS NOT NULL THEN 'TABLE'
          ELSE 'UNKNOWN'
        END AS resource_type,
        COALESCE(rd_direct.database_id, rd_from_schema.database_id, rd_from_table.database_id) AS database_id,
        COALESCE(rd_direct.name, rd_from_schema.name, rd_from_table.name) AS database_name,
        COALESCE(rs_direct.schema_id, rs_from_table.schema_id) AS schema_id,
        COALESCE(rs_direct.name, rs_from_table.name) AS schema_name,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) NOT IN ('view', 'materialized view') THEN rt_direct.table_id
          ELSE NULL
        END AS table_id,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) NOT IN ('view', 'materialized view') THEN rt_direct.name
          ELSE NULL
        END AS table_name,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) IN ('view', 'materialized view') THEN rt_direct.table_id
          ELSE NULL
        END AS view_id,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) IN ('view', 'materialized view') THEN rt_direct.name
          ELSE NULL
        END AS view_name
      FROM access_right p
      JOIN user_group ug ON ug.user_group_code = p.user_group_code
      LEFT JOIN resource_database rd_direct ON rd_direct.database_id = p.resource_id
      LEFT JOIN resource_schema rs_direct ON rs_direct.schema_id = p.resource_id
      LEFT JOIN resource_table rt_direct ON rt_direct.table_id = p.resource_id
      LEFT JOIN table_type tt_direct ON tt_direct.table_type_id = rt_direct.table_type_id
      LEFT JOIN resource_database rd_from_schema ON rd_from_schema.database_id = rs_direct.database_id
      LEFT JOIN resource_schema rs_from_table ON rs_from_table.schema_id = rt_direct.schema_id
      LEFT JOIN resource_database rd_from_table ON rd_from_table.database_id = rs_from_table.database_id
      WHERE
        ($1::text = 'all')
        OR ($1::text = 'resource' AND p.resource_id = $2::bigint)
        OR (
          $1::text = 'database'
          AND (
            rd_direct.database_id = $2::bigint
            OR rs_direct.database_id = $2::bigint
            OR rt_direct.schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $2::bigint)
          )
        )
      ORDER BY ug.name, resource_type, schema_name NULLS FIRST, table_name NULLS FIRST, view_name NULLS FIRST
      `,
      [mode, idParam]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

adminDataAccessRouter.post(
  '/api/admin/data-access/grants/bulk',
  async (req: Request, res: Response) => {
    const client = await db.connect();
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const body = req.body ?? {};
      const actionRaw = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
      const action: 'add' | 'remove' = actionRaw === 'remove' ? 'remove' : 'add';

      const groupCodesRaw = body.user_group_codes;
      const resourceIdsRaw = body.resource_ids;
      if (!Array.isArray(groupCodesRaw) || !Array.isArray(resourceIdsRaw)) {
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
      }

      const userGroupCodes = [
        ...new Set(
          groupCodesRaw
            .filter((c: unknown) => typeof c === 'string')
            .map((c: string) => c.trim().toUpperCase())
            .filter(Boolean)
        ),
      ];
      const resourceIds = [
        ...new Set(resourceIdsRaw.map((x: unknown) => parsePositiveInt(x)).filter(Boolean)),
      ] as number[];

      if (userGroupCodes.length === 0 || resourceIds.length === 0) {
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
      }

      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

      // Validate groups exist + active
      const validGroups = await client.query(
        `SELECT user_group_code
         FROM user_group
         WHERE is_active = TRUE
           AND user_group_code = ANY($1::char(5)[])`,
        [userGroupCodes]
      );
      const validGroupSet = new Set(validGroups.rows.map((r) => String(r.user_group_code).trim()));
      const invalidGroups = userGroupCodes.filter((c) => !validGroupSet.has(c));
      if (invalidGroups.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_group_codes: invalidGroups });
      }

      // Classify requested ids; expand for add (downward only) vs remove (downward + strip ancestors for schema/table).
      const types = await client.query(
        `
        SELECT database_id::bigint AS resource_id, 'DATABASE'::text AS resource_type
        FROM resource_database
        WHERE database_id = ANY($1::bigint[])
        UNION ALL
        SELECT schema_id::bigint AS resource_id, 'SCHEMA'::text AS resource_type
        FROM resource_schema
        WHERE schema_id = ANY($1::bigint[])
        UNION ALL
        SELECT table_id::bigint AS resource_id, 'TABLE'::text AS resource_type
        FROM resource_table
        WHERE table_id = ANY($1::bigint[])
        `,
        [resourceIds]
      );
      const dbIds: number[] = [];
      const schemaIds: number[] = [];
      const tableIds: number[] = [];
      for (const row of types.rows) {
        const id = Number(row.resource_id);
        const ty = String(row.resource_type);
        if (ty === 'DATABASE') dbIds.push(id);
        else if (ty === 'SCHEMA') schemaIds.push(id);
        else if (ty === 'TABLE') tableIds.push(id);
      }

      let effectiveResourceIds: number[];

      if (action === 'add') {
        const expanded = new Set<number>(resourceIds);

        if (dbIds.length > 0) {
          const schemas = await client.query(
            `SELECT schema_id
             FROM resource_schema
             WHERE database_id = ANY($1::bigint[])`,
            [dbIds]
          );
          const dbSchemaIds = schemas.rows.map((r) => Number(r.schema_id));
          for (const id of dbSchemaIds) expanded.add(id);

          if (dbSchemaIds.length > 0) {
            const tables = await client.query(
              `SELECT table_id
               FROM resource_table
               WHERE schema_id = ANY($1::bigint[])`,
              [dbSchemaIds]
            );
            for (const r of tables.rows) expanded.add(Number(r.table_id));
          }
        }

        if (schemaIds.length > 0) {
          const tables = await client.query(
            `SELECT table_id
             FROM resource_table
             WHERE schema_id = ANY($1::bigint[])`,
            [schemaIds]
          );
          for (const r of tables.rows) expanded.add(Number(r.table_id));
        }

        effectiveResourceIds = Array.from(expanded);
      } else {
        const expanded = new Set<number>(resourceIds);

        if (dbIds.length > 0) {
          const schemas = await client.query(
            `SELECT schema_id
             FROM resource_schema
             WHERE database_id = ANY($1::bigint[])`,
            [dbIds]
          );
          const dbSchemaIds = schemas.rows.map((r) => Number(r.schema_id));
          for (const id of dbSchemaIds) expanded.add(id);

          if (dbSchemaIds.length > 0) {
            const tables = await client.query(
              `SELECT table_id
               FROM resource_table
               WHERE schema_id = ANY($1::bigint[])`,
              [dbSchemaIds]
            );
            for (const r of tables.rows) expanded.add(Number(r.table_id));
          }
        }

        if (schemaIds.length > 0) {
          const tables = await client.query(
            `SELECT table_id
             FROM resource_table
             WHERE schema_id = ANY($1::bigint[])`,
            [schemaIds]
          );
          for (const r of tables.rows) expanded.add(Number(r.table_id));

          const parentDbs = await client.query(
            `SELECT DISTINCT database_id::bigint AS database_id
             FROM resource_schema
             WHERE schema_id = ANY($1::bigint[])`,
            [schemaIds]
          );
          for (const r of parentDbs.rows) expanded.add(Number(r.database_id));
        }

        if (tableIds.length > 0) {
          const ancestors = await client.query(
            `SELECT DISTINCT rs.schema_id::bigint AS schema_id, rs.database_id::bigint AS database_id
             FROM resource_table rt
             JOIN resource_schema rs ON rs.schema_id = rt.schema_id
             WHERE rt.table_id = ANY($1::bigint[])`,
            [tableIds]
          );
          for (const r of ancestors.rows) {
            expanded.add(Number(r.schema_id));
            expanded.add(Number(r.database_id));
          }
        }

        effectiveResourceIds = Array.from(expanded);
      }

      // Validate resources exist (after expansion)
      const validResources = await client.query(
        `SELECT resource_id
         FROM resource
         WHERE resource_id = ANY($1::bigint[])`,
        [effectiveResourceIds]
      );
      const validResourceSet = new Set(validResources.rows.map((r) => Number(r.resource_id)));
      const invalidResourceIds = effectiveResourceIds.filter((id) => !validResourceSet.has(id));
      if (invalidResourceIds.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_resource_ids: invalidResourceIds });
      }

      if (action === 'add') {
        await client.query(
          `INSERT INTO access_right (user_group_code, resource_id)
           SELECT g.code, r.id
           FROM UNNEST($1::char(5)[]) AS g(code)
           CROSS JOIN UNNEST($2::bigint[]) AS r(id)
           ON CONFLICT DO NOTHING`,
          [userGroupCodes, effectiveResourceIds]
        );
      } else {
        await client.query(
          `DELETE FROM access_right
           WHERE user_group_code = ANY($1::char(5)[])
             AND resource_id = ANY($2::bigint[])`,
          [userGroupCodes, effectiveResourceIds]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true, action, expanded_resource_count: effectiveResourceIds.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
    } finally {
      client.release();
    }
  }
);

adminDataAccessRouter.post('/api/admin/data-access/client-sql', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const databaseId = parsePositiveInt(body.database_id);
    const groupCodesRaw = body.user_group_codes;
    if (databaseId == null || !Array.isArray(groupCodesRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const userGroupCodes = [
      ...new Set(
        groupCodesRaw
          .filter((c: unknown) => typeof c === 'string')
          .map((c: string) => c.trim().toUpperCase())
          .filter(Boolean)
      ),
    ];

    if (userGroupCodes.length === 0) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const dbMeta = await db.query(
      `
      SELECT
        rd.database_id,
        rd.name AS database_name,
        d.dbms_code,
        d.name AS dbms_name
      FROM resource_database rd
      LEFT JOIN LATERAL (
        SELECT dcc.dbms_version_id
        FROM database_connection_credential dcc
        WHERE dcc.database_id = rd.database_id
        ORDER BY dcc.is_active DESC, dcc.database_connection_credential_id DESC
        LIMIT 1
      ) cred ON TRUE
      LEFT JOIN dbms_version v ON v.dbms_version_id = cred.dbms_version_id
      LEFT JOIN dbms d ON d.dbms_code = v.dbms_code
      WHERE rd.database_id = $1
      LIMIT 1
      `,
      [databaseId]
    );

    if (dbMeta.rows.length === 0) {
      return sendApiError(res, 404, ErrorCodes.PERMISSION_DENIED);
    }

    const metaRow = dbMeta.rows[0] as {
      database_name: string;
      dbms_code: string | null;
      dbms_name: string | null;
    };

    const dbmsCode = metaRow.dbms_code != null ? String(metaRow.dbms_code).trim() : '';
    if (!dbmsCode) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, {
        reason: 'database_has_no_dbms',
      });
    }

    const validGroups = await db.query(
      `SELECT user_group_code, name
       FROM user_group
       WHERE is_active = TRUE
         AND user_group_code = ANY($1::char(5)[])`,
      [userGroupCodes]
    );
    const validSet = new Set(validGroups.rows.map((r) => String(r.user_group_code).trim()));
    const invalidGroups = userGroupCodes.filter((c) => !validSet.has(c));
    if (invalidGroups.length > 0) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_group_codes: invalidGroups });
    }

    const nameByCode = new Map(
      validGroups.rows.map((r) => [String(r.user_group_code).trim(), String(r.name).trim()])
    );

    const schemasRes = await db.query(
      `SELECT schema_id, name FROM resource_schema WHERE database_id = $1 ORDER BY name`,
      [databaseId]
    );
    const schemas: SchemaRow[] = schemasRes.rows.map((r) => ({
      schema_id: Number(r.schema_id),
      name: String(r.name),
    }));

    const grantsRes = await db.query(
      `
      SELECT
        p.user_group_code,
        CASE
          WHEN rd_direct.database_id IS NOT NULL THEN 'DATABASE'
          WHEN rs_direct.schema_id IS NOT NULL THEN 'SCHEMA'
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) IN ('view', 'materialized view') THEN 'VIEW'
          WHEN rt_direct.table_id IS NOT NULL THEN 'TABLE'
          ELSE 'UNKNOWN'
        END AS resource_type,
        COALESCE(rd_direct.database_id, rd_from_schema.database_id, rd_from_table.database_id) AS database_id,
        COALESCE(rs_direct.schema_id, rs_from_table.schema_id) AS schema_id,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) NOT IN ('view', 'materialized view') THEN rt_direct.name
          ELSE NULL
        END AS table_name,
        CASE
          WHEN rt_direct.table_id IS NOT NULL
            AND LOWER(TRIM(COALESCE(tt_direct.name, ''))) IN ('view', 'materialized view') THEN rt_direct.name
          ELSE NULL
        END AS view_name
      FROM access_right p
      LEFT JOIN resource_database rd_direct ON rd_direct.database_id = p.resource_id
      LEFT JOIN resource_schema rs_direct ON rs_direct.schema_id = p.resource_id
      LEFT JOIN resource_table rt_direct ON rt_direct.table_id = p.resource_id
      LEFT JOIN table_type tt_direct ON tt_direct.table_type_id = rt_direct.table_type_id
      LEFT JOIN resource_database rd_from_schema ON rd_from_schema.database_id = rs_direct.database_id
      LEFT JOIN resource_schema rs_from_table ON rs_from_table.schema_id = rt_direct.schema_id
      LEFT JOIN resource_database rd_from_table ON rd_from_table.database_id = rs_from_table.database_id
      WHERE p.user_group_code = ANY($1::char(5)[])
        AND (
          rd_direct.database_id = $2::bigint
          OR rs_direct.database_id = $2::bigint
          OR rt_direct.schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $2::bigint)
        )
      `,
      [userGroupCodes, databaseId]
    );

    const grantsByCode = new Map<string, GrantRowForSql[]>();
    for (const code of userGroupCodes) grantsByCode.set(code, []);

    for (const row of grantsRes.rows) {
      const code = String(row.user_group_code).trim();
      const list = grantsByCode.get(code);
      if (!list) continue;
      const rt = String(row.resource_type) as GrantRowForSql['resource_type'];
      list.push({
        resource_type: rt,
        database_id: row.database_id == null ? null : Number(row.database_id),
        schema_id: row.schema_id == null ? null : Number(row.schema_id),
        table_name: row.table_name == null ? null : String(row.table_name),
        view_name: row.view_name == null ? null : String(row.view_name),
      });
    }

    const sortedCodes = [...userGroupCodes].sort((a, b) => {
      const na = nameByCode.get(a) ?? a;
      const nb = nameByCode.get(b) ?? b;
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });

    const parts: string[] = [];
    const warnings: string[] = [];

    for (const code of sortedCodes) {
      const roleName = nameByCode.get(code) ?? code;
      const grantRows = grantsByCode.get(code) ?? [];
      const { sql, partial, note } = buildReadOnlyScriptForDbms(
        dbmsCode,
        roleName,
        metaRow.database_name,
        schemas,
        grantRows,
        databaseId
      );
      parts.push(`-- =====================================================================`);
      parts.push(`-- Group: ${roleName} (${code})`);
      parts.push(`-- =====================================================================`);
      parts.push(sql);
      parts.push('');
      if (partial && note) warnings.push(`${code}: ${note}`);
    }

    res.json({
      database_id: databaseId,
      database_name: metaRow.database_name,
      dbms_code: dbmsCode,
      dbms_name: metaRow.dbms_name,
      sql: parts.join('\n').trimEnd(),
      warnings,
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

adminDataAccessRouter.post('/api/admin/data-access/admin-sql', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const databaseId = parsePositiveInt(body.database_id);
    if (databaseId == null) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const roleName = 'app_admin';

    const dbMeta = await db.query(
      `
      SELECT
        rd.database_id,
        rd.name AS database_name,
        d.dbms_code,
        d.name AS dbms_name
      FROM resource_database rd
      LEFT JOIN LATERAL (
        SELECT dcc.dbms_version_id
        FROM database_connection_credential dcc
        WHERE dcc.database_id = rd.database_id
        ORDER BY dcc.is_active DESC, dcc.database_connection_credential_id DESC
        LIMIT 1
      ) cred ON TRUE
      LEFT JOIN dbms_version v ON v.dbms_version_id = cred.dbms_version_id
      LEFT JOIN dbms d ON d.dbms_code = v.dbms_code
      WHERE rd.database_id = $1
      LIMIT 1
      `,
      [databaseId]
    );

    if (dbMeta.rows.length === 0) {
      return sendApiError(res, 404, ErrorCodes.PERMISSION_DENIED);
    }

    const metaRow = dbMeta.rows[0] as {
      database_name: string;
      dbms_code: string | null;
      dbms_name: string | null;
    };

    const dbmsCode = metaRow.dbms_code != null ? String(metaRow.dbms_code).trim() : '';
    if (!dbmsCode) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, {
        reason: 'database_has_no_dbms',
      });
    }

    const schemasRes = await db.query(
      `SELECT schema_id, name FROM resource_schema WHERE database_id = $1 ORDER BY name`,
      [databaseId]
    );
    const schemas: SchemaRow[] = schemasRes.rows.map((r) => ({
      schema_id: Number(r.schema_id),
      name: String(r.name),
    }));

    // For the admin read-only database user, always generate full-database read access.
    const adminRows: GrantRowForSql[] = [
      {
        resource_type: 'DATABASE',
        database_id: databaseId,
        schema_id: null,
        table_name: null,
        view_name: null,
      },
    ];

    const { sql, partial, note } = buildReadOnlyScriptForDbms(
      dbmsCode,
      roleName,
      metaRow.database_name,
      schemas,
      adminRows,
      databaseId
    );

    res.json({
      database_id: databaseId,
      database_name: metaRow.database_name,
      dbms_code: dbmsCode,
      dbms_name: metaRow.dbms_name,
      role_name: roleName,
      sql,
      warnings: partial && note ? [note] : [],
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

