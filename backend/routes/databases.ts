import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { db } from '../db/index.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { getOrCreatePool } from '../services/pool-manager.js';
import { tableTypeToResourceSection } from '../services/relation-kind.js';

export const databasesRouter = Router();

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

function paramString(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === 'string' ? s : undefined;
}

function parseDatabaseId(req: Request): number | null {
  const raw = paramString(req.params.id);
  if (raw === undefined) return null;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePositiveIntParam(raw: string | string[] | undefined): number | null {
  const s = paramString(raw);
  if (s === undefined) return null;
  const parsed = parseInt(s, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isValidResourceHierarchyName(name: string): boolean {
  const t = name.trim();
  if (t.length === 0 || t.length > 100) return false;
  if (!/\p{L}/u.test(t)) return false;
  return /^[\p{L}\p{N}\p{P}\p{S}\s]+$/u.test(t);
}


function isValidResourceColumnName(name: string): boolean {
  const t = name.trim();
  if (t.length === 0 || t.length > 100) return false;
  return /^(?=.*[\p{L}\p{N}])[\p{L}\p{N}\p{P}\s]+$/u.test(t);
}

async function assertDatabaseExists(databaseId: number): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM resource_database WHERE database_id = $1`, [databaseId]);
  return r.rows.length > 0;
}

/** Map key: schema NUL table NUL column → PostgreSQL type string from the live database (empty if unavailable). */
async function fetchColumnDataTypesFromExternalDb(databaseId: number): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  try {
    const credRes = await db.query(
      `SELECT rd.name AS database_name,
              dcc.host_name,
              dcc.port,
              dcc.username,
              dcc.password
       FROM resource_database rd
       JOIN resource r ON r.resource_id = rd.database_id AND r.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT encrypted_host_name AS host_name,
                port,
                encrypted_username AS username,
                encrypted_password AS password
         FROM database_connection_credential
         WHERE database_id = rd.database_id
           AND is_active = TRUE
           AND is_admin = TRUE
         ORDER BY database_connection_credential_id DESC
         LIMIT 1
       ) dcc ON TRUE
       WHERE rd.database_id = $1`,
      [databaseId]
    );
    if (credRes.rows.length === 0) return empty;

    const row = credRes.rows[0] as Record<string, unknown>;
    const databaseName = row.database_name as string;
    const host = decrypt(row.host_name as string | null) ?? '';
    const port = row.port === null || row.port === undefined ? 0 : Number(row.port);
    const user = decrypt(row.username as string | null) ?? '';
    const password = decrypt(row.password as string | null) ?? '';
    if (!host || !Number.isFinite(port) || port <= 0 || !user || !password) return empty;

    const extPool = getOrCreatePool({
      host,
      port,
      database: databaseName,
      user,
      password,
    });

    const r = await extPool.query(
      `SELECT cols.table_schema AS schema_name,
              cols.table_name AS table_name,
              cols.column_name AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
       FROM information_schema.columns cols
       INNER JOIN information_schema.tables tbl
         ON tbl.table_schema = cols.table_schema
        AND tbl.table_name = cols.table_name
       INNER JOIN pg_catalog.pg_namespace n ON n.nspname = cols.table_schema
       INNER JOIN pg_catalog.pg_class c
         ON c.relnamespace = n.oid AND c.relname = cols.table_name
       INNER JOIN pg_catalog.pg_attribute a
         ON a.attrelid = c.oid
        AND a.attname = cols.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
       WHERE (
           (tbl.table_type = 'BASE TABLE' AND c.relkind IN ('r', 'p'))
           OR (tbl.table_type = 'VIEW' AND c.relkind = 'v')
           OR (tbl.table_type = 'MATERIALIZED VIEW' AND c.relkind = 'm')
         )
         AND cols.table_schema NOT IN ('pg_catalog', 'information_schema')
         AND cols.table_schema NOT LIKE 'pg\\_%' ESCAPE '\\'`
    );

    const m = new Map<string, string>();
    for (const col of r.rows as Array<{
      schema_name: string;
      table_name: string;
      column_name: string;
      data_type: string;
    }>) {
      m.set(`${col.schema_name}\0${col.table_name}\0${col.column_name}`, col.data_type);
    }
    return m;
  } catch (err) {
    console.error('fetchColumnDataTypesFromExternalDb', err);
    return empty;
  }
}

async function beginAdminSession(client: PoolClient, userId: number): Promise<void> {
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);
}

/** Serializes credential admin changes per database (pairs with demote + partial unique index). */
async function lockResourceDatabaseRow(
  client: PoolClient,
  databaseId: number
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM resource_database WHERE database_id = $1 FOR UPDATE`,
    [databaseId]
  );
  return r.rows.length > 0;
}

/** Clears is_admin on other rows so at most one admin credential exists per database (see DB partial unique index). */
async function demoteOtherAdminCredentials(
  client: PoolClient,
  databaseId: number,
  exceptCredentialId?: number
): Promise<void> {
  if (exceptCredentialId != null) {
    await client.query(
      `UPDATE database_connection_credential
       SET is_admin = FALSE
       WHERE database_id = $1
         AND is_admin = TRUE
         AND database_connection_credential_id <> $2`,
      [databaseId, exceptCredentialId]
    );
  } else {
    await client.query(
      `UPDATE database_connection_credential
       SET is_admin = FALSE
       WHERE database_id = $1 AND is_admin = TRUE`,
      [databaseId]
    );
  }
}

async function insertResourceRecord(
  client: PoolClient,
  userId: number,
  descriptionForLlm: string | null,
  commentForUser: string | null,
  isActive: boolean
): Promise<number> {
  const ins = await client.query(
    `INSERT INTO resource (creator, modifier, description_for_llm, comment_for_user, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING resource_id`,
    [userId, userId, descriptionForLlm, commentForUser, isActive]
  );
  return ins.rows[0].resource_id as number;
}

async function deleteTableResource(client: PoolClient, tableId: number): Promise<void> {
  const cols = await client.query(`SELECT column_id FROM resource_column WHERE table_id = $1`, [
    tableId,
  ]);
  const columnIds = cols.rows.map((r) => r.column_id as number);

  // Remove rows from tables whose FKs to `resource` are ON DELETE NO ACTION.
  const resourceIds = [tableId, ...columnIds];
  await client.query(`DELETE FROM sql_query_resource_usage WHERE resource_id = ANY($1::bigint[])`, [
    resourceIds,
  ]);
  await client.query(`DELETE FROM access_right WHERE resource_id = ANY($1::bigint[])`, [resourceIds]);

  // Delete resource rows from the leaves up; resource_column/resource_table FKs should cascade.
  if (columnIds.length > 0) {
    await client.query(`DELETE FROM resource WHERE resource_id = ANY($1::bigint[])`, [columnIds]);
  }
  await client.query(`DELETE FROM resource WHERE resource_id = $1`, [tableId]);
}

async function deleteSchemaResource(client: PoolClient, schemaId: number): Promise<void> {
  const tables = await client.query(`SELECT table_id FROM resource_table WHERE schema_id = $1`, [
    schemaId,
  ]);
  for (const row of tables.rows) {
    await deleteTableResource(client, row.table_id as number);
  }
  await client.query(`DELETE FROM resource WHERE resource_id = $1`, [schemaId]);
}

function normalizeTrimmedString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t === '' ? null : t;
}

function normalizeRequiredTrimmedString(raw: unknown): string | null {
  const v = normalizeTrimmedString(raw);
  return v ? v : null;
}

function normalizePort(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

function normalizeBoolean(raw: unknown, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null) return defaultValue;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return raw !== 0;
  }
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  }
  return Boolean(raw);
}

function normalizeConfirmReplaceAdmin(body: Record<string, unknown>): boolean {
  return normalizeBoolean(body.confirm_replace_admin, false);
}

async function selectPrimaryCredentialIdForDatabase(
  client: PoolClient,
  databaseId: number
): Promise<number | null> {
  const r = await client.query(
    `SELECT database_connection_credential_id
     FROM database_connection_credential
     WHERE database_id = $1
     ORDER BY is_active DESC, database_connection_credential_id DESC
     LIMIT 1`,
    [databaseId]
  );
  return r.rows.length > 0 ? (r.rows[0].database_connection_credential_id as number) : null;
}

/** True if some other row (same database) is already admin; exceptCredentialId excludes that row (use null for “any admin”). */
async function existsOtherAdminCredential(
  client: PoolClient,
  databaseId: number,
  exceptCredentialId: number | null
): Promise<boolean> {
  const r =
    exceptCredentialId == null
      ? await client.query(
          `SELECT 1 FROM database_connection_credential
           WHERE database_id = $1 AND is_admin = TRUE
           LIMIT 1`,
          [databaseId]
        )
      : await client.query(
          `SELECT 1 FROM database_connection_credential
           WHERE database_id = $1 AND is_admin = TRUE
             AND database_connection_credential_id <> $2
           LIMIT 1`,
          [databaseId, exceptCredentialId]
        );
  return r.rows.length > 0;
}

/** True if some other credential (same database) already has this username (checked pre-encryption by decrypting stored values). */
async function existsOtherCredentialWithUsername(
  client: PoolClient,
  databaseId: number,
  usernamePlaintext: string,
  exceptCredentialId: number | null
): Promise<boolean> {
  const r =
    exceptCredentialId == null
      ? await client.query(
          `SELECT database_connection_credential_id, encrypted_username
           FROM database_connection_credential
           WHERE database_id = $1`,
          [databaseId]
        )
      : await client.query(
          `SELECT database_connection_credential_id, encrypted_username
           FROM database_connection_credential
           WHERE database_id = $1
             AND database_connection_credential_id <> $2`,
          [databaseId, exceptCredentialId]
        );

  for (const row of r.rows as Array<{ encrypted_username: string | null }>) {
    const existing = decrypt(row.encrypted_username) ?? '';
    if (existing === usernamePlaintext) return true;
  }
  return false;
}

function decryptCredentialFields(row: Record<string, unknown>): Record<string, unknown> {
  const result = { ...row };
  if (typeof result.host_name === 'string') {
    result.host_name = decrypt(result.host_name);
  }
  if (typeof result.username === 'string') {
    result.username = decrypt(result.username);
  }
  return result;
}

const DATABASE_SELECT = `
  SELECT
    rd.database_id,
    rd.name AS database_name,
    r.description_for_LLM AS description_for_llm,
    r.comment_for_user AS comment_for_user,
    r.is_active AS is_active_database,
    cred.encrypted_host_name AS host_name,
    cred.port,
    cred.encrypted_username AS username,
    cred.dbms_version_id,
    d.dbms_code,
    d.name AS dbms_name,
    v.version AS dbms_version,
    v.description AS dbms_version_description,
    cred.is_active AS is_active_credential,
    cred.is_admin AS is_admin_credential
  FROM resource_database rd
  JOIN resource r ON r.resource_id = rd.database_id
  LEFT JOIN LATERAL (
    SELECT dcc.*
    FROM database_connection_credential dcc
    WHERE dcc.database_id = rd.database_id
    ORDER BY dcc.is_active DESC, dcc.database_connection_credential_id DESC
    LIMIT 1
  ) cred ON TRUE
  LEFT JOIN dbms_version v ON v.dbms_version_id = cred.dbms_version_id
  LEFT JOIN dbms d ON d.dbms_code = v.dbms_code
  ORDER BY rd.name
`;

const DATABASE_SELECT_BY_ID = `
  SELECT
    rd.database_id,
    rd.name AS database_name,
    r.description_for_LLM AS description_for_llm,
    r.comment_for_user AS comment_for_user,
    r.is_active AS is_active_database,
    r.created_at_time AS resource_created_at_time,
    r.modified_at_time AS resource_modified_at_time,
    cred.encrypted_host_name AS host_name,
    cred.port,
    cred.encrypted_username AS username,
    cred.dbms_version_id,
    cred.created_at_time AS credential_created_at_time,
    cred.modified_at_time AS credential_modified_at_time,
    d.dbms_code,
    d.name AS dbms_name,
    v.version AS dbms_version,
    v.description AS dbms_version_description,
    cred.is_active AS is_active_credential,
    cred.is_admin AS is_admin_credential
  FROM resource_database rd
  JOIN resource r ON r.resource_id = rd.database_id
  LEFT JOIN LATERAL (
    SELECT dcc.*
    FROM database_connection_credential dcc
    WHERE dcc.database_id = rd.database_id
    ORDER BY dcc.is_active DESC, dcc.database_connection_credential_id DESC
    LIMIT 1
  ) cred ON TRUE
  LEFT JOIN dbms_version v ON v.dbms_version_id = cred.dbms_version_id
  LEFT JOIN dbms d ON d.dbms_code = v.dbms_code
  WHERE rd.database_id = $1
`;

/** Detail page: resource + resource_database only (no connection credential columns). */
const DATABASE_DETAIL_RESOURCE = `
  SELECT
    rd.database_id,
    rd.name AS database_name,
    r.description_for_LLM AS description_for_llm,
    r.comment_for_user AS comment_for_user,
    r.is_active AS is_active_database,
    r.created_at_time AS resource_created_at_time,
    r.modified_at_time AS resource_modified_at_time
  FROM resource_database rd
  JOIN resource r ON r.resource_id = rd.database_id
  WHERE rd.database_id = $1
`;

/** All connection credential rows for a database (admin detail; no password). */
const DATABASE_DETAIL_CREDENTIALS = `
  SELECT
    dcc.database_connection_credential_id,
    dcc.encrypted_host_name AS host_name,
    dcc.port,
    dcc.encrypted_username AS username,
    dcc.dbms_version_id,
    dcc.is_active,
    dcc.is_admin,
    dcc.created_at_time,
    dcc.modified_at_time,
    d.dbms_code,
    d.name AS dbms_name,
    v.version AS dbms_version,
    v.description AS dbms_version_description
  FROM database_connection_credential dcc
  LEFT JOIN dbms_version v ON v.dbms_version_id = dcc.dbms_version_id
  LEFT JOIN dbms d ON d.dbms_code = v.dbms_code
  WHERE dcc.database_id = $1
  ORDER BY dcc.is_active DESC, dcc.database_connection_credential_id DESC
`;

databasesRouter.get('/api/admin/databases', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(DATABASE_SELECT);
    res.json(result.rows.map(decryptCredentialFields));
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

databasesRouter.post('/api/admin/databases', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const databaseName = normalizeRequiredTrimmedString(body.database_name);
    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);

    const dbmsVersionIdRaw = body.dbms_version_id;
    const dbmsVersionId =
      typeof dbmsVersionIdRaw === 'number'
        ? dbmsVersionIdRaw
        : Number.isInteger(Number(dbmsVersionIdRaw))
          ? Number(dbmsVersionIdRaw)
          : null;

    const hostName = normalizeRequiredTrimmedString(body.host_name);
    const port = normalizePort(body.port);
    const username = normalizeRequiredTrimmedString(body.username);
    const encryptedPassword = normalizeRequiredTrimmedString(body.encrypted_password);
    const isActive = normalizeBoolean(body.is_active, true);
    const isAdmin = normalizeBoolean(body.is_admin, false);

    if (
      !databaseName ||
      !dbmsVersionId ||
      !hostName ||
      port === null ||
      !username ||
      !encryptedPassword
    ) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    await client.query(`CALL p_register_database_resource($1, $2, $3, $4, $5)`, [
      userId,
      userId,
      databaseName,
      descriptionForLlm,
      commentForUser,
    ]);

    const created = await client.query(
      `SELECT database_id
       FROM resource_database
       WHERE name = $1
       LIMIT 1`,
      [databaseName]
    );

    if (created.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }

    const databaseId = created.rows[0].database_id as number;

    if (!(await lockResourceDatabaseRow(client, databaseId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }

    if (isAdmin) {
      await demoteOtherAdminCredentials(client, databaseId);
    }

    if (await existsOtherCredentialWithUsername(client, databaseId, username, null)) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.DATABASE_CREDENTIAL_USERNAME_DUPLICATE);
    }

    await client.query(
      `INSERT INTO database_connection_credential (
         database_id,
         dbms_version_id,
         encrypted_host_name,
         port,
         encrypted_username,
         encrypted_password,
         is_active,
         is_admin
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [databaseId, dbmsVersionId, encrypt(hostName), port, encrypt(username), encrypt(encryptedPassword), isActive, isAdmin]
    );

    if (!isActive) {
      await client.query(`UPDATE resource SET is_active = FALSE WHERE resource_id = $1`, [
        databaseId,
      ]);
    }

    await client.query('COMMIT');

    const updated = await db.query(DATABASE_SELECT_BY_ID, [databaseId]);
    res.status(201).json(decryptCredentialFields(updated.rows[0]));
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);

    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as any).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (pgCode === '23503') return sendApiError(res, 400, ErrorCodes.PERMISSION_DENIED);

    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.put('/api/admin/databases/:id', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const databaseName = normalizeTrimmedString(body.database_name);
    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);
    const dbmsVersionIdRaw = body.dbms_version_id;
    const dbmsVersionId =
      typeof dbmsVersionIdRaw === 'number'
        ? dbmsVersionIdRaw
        : Number.isInteger(Number(dbmsVersionIdRaw))
          ? Number(dbmsVersionIdRaw)
          : null;
    const hostName = normalizeRequiredTrimmedString(body.host_name);
    const port = normalizePort(body.port);
    const username = normalizeRequiredTrimmedString(body.username);
    const encryptedPassword = normalizeTrimmedString(body.encrypted_password); // empty => null => keep existing
    const isActive = normalizeBoolean(body.is_active, true);
    const isAdmin = normalizeBoolean(body.is_admin, false);
    const confirmReplaceAdmin = normalizeConfirmReplaceAdmin(body as Record<string, unknown>);

    if (
      !databaseName ||
      !dbmsVersionId ||
      !hostName ||
      port === null ||
      !username
    ) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    const updatedDb = await client.query(
      `UPDATE resource_database
       SET name = $1
       WHERE database_id = $2
       RETURNING database_id`,
      [databaseName, databaseId]
    );

    if (updatedDb.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE resource
       SET description_for_LLM = $1,
           comment_for_user = $2,
           is_active = $3
       WHERE resource_id = $4`,
      [descriptionForLlm, commentForUser, isActive, databaseId]
    );

    if (isAdmin) {
      const primaryCredentialId = await selectPrimaryCredentialIdForDatabase(client, databaseId);
      if (primaryCredentialId == null) {
        await client.query('ROLLBACK');
        return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
      }
      if (
        !confirmReplaceAdmin &&
        (await existsOtherAdminCredential(client, databaseId, primaryCredentialId))
      ) {
        await client.query('ROLLBACK');
        return sendApiError(
          res,
          409,
          ErrorCodes.ADMIN_CREDENTIAL_REPLACE_CONFIRMATION_REQUIRED
        );
      }
      await demoteOtherAdminCredentials(client, databaseId, primaryCredentialId);
    }

    const primaryCredentialIdForUsernameCheck = await selectPrimaryCredentialIdForDatabase(
      client,
      databaseId
    );
    if (primaryCredentialIdForUsernameCheck == null) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }
    if (
      await existsOtherCredentialWithUsername(
        client,
        databaseId,
        username,
        primaryCredentialIdForUsernameCheck
      )
    ) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.DATABASE_CREDENTIAL_USERNAME_DUPLICATE);
    }

    const targetCred = await client.query(
      `WITH target AS (
         SELECT database_connection_credential_id
         FROM database_connection_credential
         WHERE database_id = $1
         ORDER BY is_active DESC, database_connection_credential_id DESC
         LIMIT 1
       )
       UPDATE database_connection_credential dcc
       SET
         dbms_version_id = $2,
         encrypted_host_name = $3,
         port = $4,
         encrypted_username = $5,
         encrypted_password = COALESCE($6::text, dcc.encrypted_password),
         is_active = $7,
         is_admin = $8
       FROM target
       WHERE dcc.database_connection_credential_id = target.database_connection_credential_id
       RETURNING dcc.database_connection_credential_id`,
      [databaseId, dbmsVersionId, encrypt(hostName), port, encrypt(username), encryptedPassword ? encrypt(encryptedPassword) : null, isActive, isAdmin]
    );

    if (targetCred.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query('COMMIT');

    const updated = await db.query(DATABASE_SELECT_BY_ID, [databaseId]);
    res.json(decryptCredentialFields(updated.rows[0]));
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);

    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as any).code : '';
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23503') return sendApiError(res, 400, ErrorCodes.PERMISSION_DENIED);


    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.delete('/api/admin/databases/:id', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const exists = await assertDatabaseExists(databaseId);
    if (!exists) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);

    // Gather every resource_id that belongs to this database (database, schemas,
    // tables, and columns) so we can remove rows from tables whose FKs to
    // `resource` are defined as ON DELETE NO ACTION.
    const idsRes = await client.query(
      `SELECT rd.database_id AS resource_id
         FROM resource_database rd
        WHERE rd.database_id = $1
       UNION ALL
       SELECT rs.schema_id
         FROM resource_schema rs
        WHERE rs.database_id = $1
       UNION ALL
       SELECT rt.table_id
         FROM resource_table rt
        WHERE rt.schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
       UNION ALL
       SELECT rc.column_id
         FROM resource_column rc
        WHERE rc.table_id IN (
          SELECT table_id
            FROM resource_table
           WHERE schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
        )`,
      [databaseId]
    );
    const resourceIds = idsRes.rows.map((r) => r.resource_id as number);

    if (resourceIds.length > 0) {
      await client.query(
        `DELETE FROM sql_query_resource_usage WHERE resource_id = ANY($1::bigint[])`,
        [resourceIds]
      );
      await client.query(
        `DELETE FROM access_right WHERE resource_id = ANY($1::bigint[])`,
        [resourceIds]
      );
    }

    await client.query(
      `DELETE FROM database_connection_credential WHERE database_id = $1`,
      [databaseId]
    );

    // Delete resource rows from the leaves up; the FKs on resource_column /
    // resource_table / resource_schema / resource_database to resource cascade.
    await client.query(
      `DELETE FROM resource
        WHERE resource_id IN (
          SELECT rc.column_id
            FROM resource_column rc
           WHERE rc.table_id IN (
             SELECT table_id
               FROM resource_table
              WHERE schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
           )
        )`,
      [databaseId]
    );
    await client.query(
      `DELETE FROM resource
        WHERE resource_id IN (
          SELECT rt.table_id
            FROM resource_table rt
           WHERE rt.schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
        )`,
      [databaseId]
    );
    await client.query(
      `DELETE FROM resource
        WHERE resource_id IN (
          SELECT rs.schema_id FROM resource_schema rs WHERE rs.database_id = $1
        )`,
      [databaseId]
    );
    await client.query(`DELETE FROM resource WHERE resource_id = $1`, [databaseId]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/databases/:id/deactivate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    const updRes = await client.query(
      `UPDATE resource
       SET is_active = FALSE
       WHERE resource_id = $1
       RETURNING resource_id`,
      [databaseId]
    );

    if (updRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE database_connection_credential
       SET is_active = FALSE
       WHERE database_id = $1
         AND COALESCE(is_admin, FALSE) = FALSE`,
      [databaseId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/databases/:id/activate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    const updRes = await client.query(
      `UPDATE resource
       SET is_active = TRUE
       WHERE resource_id = $1
       RETURNING resource_id`,
      [databaseId]
    );

    if (updRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE database_connection_credential
       SET is_active = TRUE
       WHERE database_id = $1
         AND COALESCE(is_admin, FALSE) = FALSE`,
      [databaseId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.get('/api/admin/databases/:id/detail', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const resourceRes = await db.query(DATABASE_DETAIL_RESOURCE, [databaseId]);
    if (resourceRes.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    const credRes = await db.query(DATABASE_DETAIL_CREDENTIALS, [databaseId]);
    const credentials = credRes.rows.map((row) => ({
      database_connection_credential_id: row.database_connection_credential_id as number,
      host_name: decrypt(row.host_name as string | null),
      port: row.port as number | null,
      username: decrypt(row.username as string | null),
      dbms_version_id: row.dbms_version_id as number | null,
      is_active: Boolean(row.is_active),
      is_admin: Boolean(row.is_admin),
      created_at_time: row.created_at_time ?? null,
      modified_at_time: row.modified_at_time ?? null,
      dbms_code: row.dbms_code as string | null,
      dbms_name: row.dbms_name as string | null,
      dbms_version: row.dbms_version as string | null,
      dbms_version_description: row.dbms_version_description as string | null,
    }));

    res.json({
      ...resourceRes.rows[0],
      credentials,
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

/**
 * Clear all `description_for_llm` and `comment_for_user` values for the database resource itself
 * and all nested schema/table/column resources belonging to the database.
 */
databasesRouter.post('/api/admin/databases/:id/clear-comments', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const exists = await assertDatabaseExists(databaseId);
    if (!exists) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);

    const upd = await client.query(
      `WITH ids AS (
         SELECT $1::bigint AS resource_id
         UNION ALL
         SELECT rs.schema_id
           FROM resource_schema rs
          WHERE rs.database_id = $1
         UNION ALL
         SELECT rt.table_id
           FROM resource_table rt
          WHERE rt.schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
         UNION ALL
         SELECT rc.column_id
           FROM resource_column rc
          WHERE rc.table_id IN (
                 SELECT table_id
                   FROM resource_table
                  WHERE schema_id IN (SELECT schema_id FROM resource_schema WHERE database_id = $1)
               )
       )
       UPDATE resource r
          SET description_for_llm = NULL,
              comment_for_user = NULL
        WHERE r.resource_id IN (SELECT resource_id FROM ids)`,
      [databaseId]
    );

    await client.query('COMMIT');
    res.json({ success: true, updated: upd.rowCount ?? 0 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

/** Update resource_database + resource only (no connection credentials). */
databasesRouter.put('/api/admin/databases/:id/resource', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const databaseName = normalizeRequiredTrimmedString(body.database_name);
    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);
    const isActive = normalizeBoolean(body.is_active, true);

    if (!databaseName) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await beginAdminSession(client, userId);

    const updatedDb = await client.query(
      `UPDATE resource_database
       SET name = $1
       WHERE database_id = $2
       RETURNING database_id`,
      [databaseName, databaseId]
    );

    if (updatedDb.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE resource
       SET description_for_LLM = $1,
           comment_for_user = $2,
           is_active = $3
       WHERE resource_id = $4`,
      [descriptionForLlm, commentForUser, isActive, databaseId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/databases/:id/resource/deactivate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);
    const updRes = await client.query(
      `UPDATE resource
       SET is_active = FALSE
       WHERE resource_id = $1
       RETURNING resource_id`,
      [databaseId]
    );
    if (updRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE database_connection_credential
       SET is_active = FALSE
       WHERE database_id = $1
         AND COALESCE(is_admin, FALSE) = FALSE`,
      [databaseId]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/databases/:id/resource/activate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);
    const updRes = await client.query(
      `UPDATE resource
       SET is_active = TRUE
       WHERE resource_id = $1
       RETURNING resource_id`,
      [databaseId]
    );
    if (updRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query(
      `UPDATE database_connection_credential
       SET is_active = TRUE
       WHERE database_id = $1
         AND COALESCE(is_admin, FALSE) = FALSE`,
      [databaseId]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/databases/:id/credentials', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    if (!(await assertDatabaseExists(databaseId))) {
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    const body = req.body ?? {};
    const dbmsVersionIdRaw = body.dbms_version_id;
    const dbmsVersionId =
      typeof dbmsVersionIdRaw === 'number'
        ? dbmsVersionIdRaw
        : Number.isInteger(Number(dbmsVersionIdRaw))
          ? Number(dbmsVersionIdRaw)
          : null;
    const hostName = normalizeRequiredTrimmedString(body.host_name);
    const port = normalizePort(body.port);
    const username = normalizeRequiredTrimmedString(body.username);
    const encryptedPassword = normalizeRequiredTrimmedString(body.encrypted_password);
    const isActive = normalizeBoolean(body.is_active, true);
    const isAdmin = normalizeBoolean(body.is_admin, false);
    const confirmReplaceAdmin = normalizeConfirmReplaceAdmin(body as Record<string, unknown>);

    if (!dbmsVersionId || !hostName || port === null || !username || !encryptedPassword) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await beginAdminSession(client, userId);

    if (!(await lockResourceDatabaseRow(client, databaseId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    if (isAdmin) {
      if (
        !confirmReplaceAdmin &&
        (await existsOtherAdminCredential(client, databaseId, null))
      ) {
        await client.query('ROLLBACK');
        return sendApiError(
          res,
          409,
          ErrorCodes.ADMIN_CREDENTIAL_REPLACE_CONFIRMATION_REQUIRED
        );
      }
      await demoteOtherAdminCredentials(client, databaseId);
    }

    if (await existsOtherCredentialWithUsername(client, databaseId, username, null)) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.DATABASE_CREDENTIAL_USERNAME_DUPLICATE);
    }

    await client.query(
      `INSERT INTO database_connection_credential (
         database_id,
         dbms_version_id,
         encrypted_host_name,
         port,
         encrypted_username,
         encrypted_password,
         is_active,
         is_admin
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [databaseId, dbmsVersionId, encrypt(hostName), port, encrypt(username), encrypt(encryptedPassword), isActive, isAdmin]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);

    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as any).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (pgCode === '23503') return sendApiError(res, 400, ErrorCodes.PERMISSION_DENIED);

    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.put('/api/admin/databases/:id/credentials/:credentialId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    const credentialId = parsePositiveIntParam(req.params.credentialId);
    if (!databaseId || !credentialId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const dbmsVersionIdRaw = body.dbms_version_id;
    const dbmsVersionId =
      typeof dbmsVersionIdRaw === 'number'
        ? dbmsVersionIdRaw
        : Number.isInteger(Number(dbmsVersionIdRaw))
          ? Number(dbmsVersionIdRaw)
          : null;
    const hostName = normalizeRequiredTrimmedString(body.host_name);
    const port = normalizePort(body.port);
    const username = normalizeRequiredTrimmedString(body.username);
    const encryptedPassword = normalizeTrimmedString(body.encrypted_password);
    const isActive = normalizeBoolean(body.is_active, true);
    const isAdmin = normalizeBoolean(body.is_admin, false);
    const confirmReplaceAdmin = normalizeConfirmReplaceAdmin(body as Record<string, unknown>);

    if (!dbmsVersionId || !hostName || port === null || !username) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await beginAdminSession(client, userId);

    if (!(await lockResourceDatabaseRow(client, databaseId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    if (isAdmin) {
      if (
        !confirmReplaceAdmin &&
        (await existsOtherAdminCredential(client, databaseId, credentialId))
      ) {
        await client.query('ROLLBACK');
        return sendApiError(
          res,
          409,
          ErrorCodes.ADMIN_CREDENTIAL_REPLACE_CONFIRMATION_REQUIRED
        );
      }
      await demoteOtherAdminCredentials(client, databaseId, credentialId);
    }

    if (await existsOtherCredentialWithUsername(client, databaseId, username, credentialId)) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.DATABASE_CREDENTIAL_USERNAME_DUPLICATE);
    }

    const upd = await client.query(
      `UPDATE database_connection_credential dcc
       SET
         dbms_version_id = $3,
         encrypted_host_name = $4,
         port = $5,
         encrypted_username = $6,
         encrypted_password = COALESCE($7::text, dcc.encrypted_password),
         is_active = $8,
         is_admin = $9
       WHERE dcc.database_connection_credential_id = $1
         AND dcc.database_id = $2
       RETURNING dcc.database_connection_credential_id`,
      [
        credentialId,
        databaseId,
        dbmsVersionId,
        encrypt(hostName),
        port,
        encrypt(username),
        encryptedPassword ? encrypt(encryptedPassword) : null,
        isActive,
        isAdmin,
      ]
    );

    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23503') return sendApiError(res, 400, ErrorCodes.PERMISSION_DENIED);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.delete('/api/admin/databases/:id/credentials/:credentialId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    const credentialId = parsePositiveIntParam(req.params.credentialId);
    if (!databaseId || !credentialId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);

    const del = await client.query(
      `DELETE FROM database_connection_credential
       WHERE database_connection_credential_id = $1
         AND database_id = $2
       RETURNING database_connection_credential_id`,
      [credentialId, databaseId]
    );

    if (del.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode =
      err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post(
  '/api/admin/databases/:id/credentials/:credentialId/deactivate',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const databaseId = parseDatabaseId(req);
      const credentialId = parsePositiveIntParam(req.params.credentialId);
      if (!databaseId || !credentialId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

      const client = await db.connect();
      try {
        await beginAdminSession(client, userId);
        const r = await client.query(
          `UPDATE database_connection_credential
           SET is_active = FALSE
           WHERE database_connection_credential_id = $1
             AND database_id = $2
           RETURNING database_connection_credential_id`,
          [credentialId, databaseId]
        );
        if (r.rows.length === 0) {
          await client.query('ROLLBACK');
          return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
        }
        await client.query('COMMIT');
        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
    }
  }
);

databasesRouter.post(
  '/api/admin/databases/:id/credentials/:credentialId/activate',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const databaseId = parseDatabaseId(req);
      const credentialId = parsePositiveIntParam(req.params.credentialId);
      if (!databaseId || !credentialId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

      const client = await db.connect();
      try {
        await beginAdminSession(client, userId);
        const r = await client.query(
          `UPDATE database_connection_credential
           SET is_active = TRUE
           WHERE database_connection_credential_id = $1
             AND database_id = $2
           RETURNING database_connection_credential_id`,
          [credentialId, databaseId]
        );
        if (r.rows.length === 0) {
          await client.query('ROLLBACK');
          return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
        }
        await client.query('COMMIT');
        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
    }
  }
);

databasesRouter.get('/api/admin/databases/:id/resources', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const exists = await assertDatabaseExists(databaseId);
    if (!exists) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    const columnTypesPromise = fetchColumnDataTypesFromExternalDb(databaseId);

    const schemasRes = await db.query(
      `SELECT rs.schema_id,
              rs.name AS schema_name,
              r.description_for_llm,
              r.comment_for_user,
              r.is_active,
              r.created_at_time,
              r.modified_at_time
       FROM resource_schema rs
       JOIN resource r ON r.resource_id = rs.schema_id
       WHERE rs.database_id = $1
       ORDER BY rs.name`,
      [databaseId]
    );

    const schemaIds = schemasRes.rows.map((row) => row.schema_id as number);
    let tablesRes = { rows: [] as Record<string, unknown>[] };
    if (schemaIds.length > 0) {
      tablesRes = await db.query(
        `SELECT rt.table_id,
                rt.schema_id,
                rt.name AS table_name,
                rt.table_type_id,
                tt.name AS table_type_name,
                r.description_for_llm,
                r.comment_for_user,
                r.is_active,
                r.created_at_time,
                r.modified_at_time
         FROM resource_table rt
         JOIN resource r ON r.resource_id = rt.table_id
         LEFT JOIN table_type tt ON tt.table_type_id = rt.table_type_id
         WHERE rt.schema_id = ANY($1::bigint[])
         ORDER BY rt.schema_id, rt.name`,
        [schemaIds]
      );
    }

    const tableIds = tablesRes.rows.map((row) => row.table_id as number);
    let columnsRes = { rows: [] as Record<string, unknown>[] };
    if (tableIds.length > 0) {
      columnsRes = await db.query(
        `SELECT rc.column_id,
                rc.table_id,
                rc.name AS column_name,
                r.description_for_llm,
                r.comment_for_user,
                r.is_active,
                r.created_at_time,
                r.modified_at_time
         FROM resource_column rc
         JOIN resource r ON r.resource_id = rc.column_id
         WHERE rc.table_id = ANY($1::bigint[])
         ORDER BY rc.table_id, rc.name`,
        [tableIds]
      );
    }

    const columnTypes = await columnTypesPromise;

    const columnsByTable = new Map<number, unknown[]>();
    for (const col of columnsRes.rows) {
      const tid = col.table_id as number;
      const list = columnsByTable.get(tid) ?? [];
      list.push({
        column_id: col.column_id,
        name: col.column_name,
        description_for_llm: col.description_for_llm,
        comment_for_user: col.comment_for_user,
        is_active: col.is_active,
        created_at_time: col.created_at_time,
        modified_at_time: col.modified_at_time,
      });
      columnsByTable.set(tid, list);
    }

    const tablesBySchema = new Map<number, unknown[]>();
    const viewsBySchema = new Map<number, unknown[]>();
    const materializedViewsBySchema = new Map<number, unknown[]>();
    for (const t of tablesRes.rows) {
      const sid = t.schema_id as number;
      const tid = t.table_id as number;
      const typeName = t.table_type_name as string | null;
      const section = tableTypeToResourceSection(typeName);
      const targetMap =
        section === 'views'
          ? viewsBySchema
          : section === 'materialized_views'
            ? materializedViewsBySchema
            : tablesBySchema;
      const list = targetMap.get(sid) ?? [];
      const base = {
        name: t.table_name,
        description_for_llm: t.description_for_llm,
        comment_for_user: t.comment_for_user,
        is_active: t.is_active,
        created_at_time: t.created_at_time,
        modified_at_time: t.modified_at_time,
        table_type_id: t.table_type_id,
        table_type_name: typeName,
        columns: columnsByTable.get(tid) ?? [],
      };
      if (section === 'views' || section === 'materialized_views') {
        const viewColumns: Array<{
          column_id: number;
          name: string;
          data_type: string | null;
          description_for_llm: null;
          comment_for_user: null;
          is_active: boolean;
        }> = [];
        const schemaNameForView = schemasRes.rows.find((r) => Number(r.schema_id) === sid)?.schema_name as
          | string
          | undefined;
        if (schemaNameForView) {
          const prefix = `${schemaNameForView}\0${t.table_name as string}\0`;
          for (const [k, dataType] of columnTypes) {
            if (!k.startsWith(prefix)) continue;
            const colName = k.slice(prefix.length);
            if (colName.includes('\0')) continue;
            viewColumns.push({
              column_id: 0,
              name: colName,
              data_type: dataType,
              description_for_llm: null,
              comment_for_user: null,
              is_active: true,
            });
          }
          viewColumns.sort((a, b) => a.name.localeCompare(b.name));
        }
        list.push({
          view_id: tid,
          ...base,
          columns:
            (base.columns as unknown[]).length > 0 ? base.columns : viewColumns,
        });
      } else {
        list.push({
          table_id: tid,
          ...base,
        });
      }
      targetMap.set(sid, list);
    }

    const schemas = schemasRes.rows.map((s) => ({
      schema_id: s.schema_id,
      name: s.schema_name,
      description_for_llm: s.description_for_llm,
      comment_for_user: s.comment_for_user,
      is_active: s.is_active,
      created_at_time: s.created_at_time,
      modified_at_time: s.modified_at_time,
      tables: tablesBySchema.get(s.schema_id as number) ?? [],
      views: viewsBySchema.get(s.schema_id as number) ?? [],
      materialized_views: materializedViewsBySchema.get(s.schema_id as number) ?? [],
    }));

    for (const sch of schemas) {
      const schemaName = sch.name as string;
      for (const tbl of sch.tables as Array<{ name: string; columns: Array<{ name: string }> }>) {
        for (const col of tbl.columns) {
          const withType = col as unknown as { data_type: string | null };
          withType.data_type = columnTypes.get(`${schemaName}\0${tbl.name}\0${col.name}`) ?? null;
        }
      }
      for (const vw of sch.views as Array<{ name: string; columns: Array<{ name: string }> }>) {
        for (const col of vw.columns) {
          const withType = col as unknown as { data_type: string | null };
          const fromMap = columnTypes.get(`${schemaName}\0${vw.name}\0${col.name}`);
          withType.data_type = fromMap ?? withType.data_type ?? null;
        }
      }
      for (const mv of sch.materialized_views as Array<{ name: string; columns: Array<{ name: string }> }>) {
        for (const col of mv.columns) {
          const withType = col as unknown as { data_type: string | null };
          const fromMap = columnTypes.get(`${schemaName}\0${mv.name}\0${col.name}`);
          withType.data_type = fromMap ?? withType.data_type ?? null;
        }
      }
    }

    res.json({ database_id: databaseId, schemas });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

databasesRouter.post('/api/admin/databases/:id/schemas', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const databaseId = parseDatabaseId(req);
    if (!databaseId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const exists = await assertDatabaseExists(databaseId);
    if (!exists) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (!isValidResourceHierarchyName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);
    const isActive = normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);
    const resourceId = await insertResourceRecord(
      client,
      userId,
      descriptionForLlm,
      commentForUser,
      isActive
    );
    await client.query(
      `INSERT INTO resource_schema (schema_id, database_id, name)
       VALUES ($1, $2, $3)`,
      [resourceId, databaseId, nameRaw]
    );
    await client.query('COMMIT');
    res.status(201).json({
      schema_id: resourceId,
      name: nameRaw,
      description_for_llm: descriptionForLlm,
      comment_for_user: commentForUser,
      is_active: isActive,
      tables: [],
      views: [],
      materialized_views: [],
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.put('/api/admin/resource-schemas/:schemaId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const schemaId = parsePositiveIntParam(req.params.schemaId);
    if (!schemaId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (nameRaw && !isValidResourceHierarchyName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm =
      'description_for_llm' in body ? normalizeTrimmedString(body.description_for_llm) : undefined;
    const commentForUser =
      'comment_for_user' in body ? normalizeTrimmedString(body.comment_for_user) : undefined;
    const isActive =
      body.is_active === undefined ? undefined : normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);

    const existsSchema = await client.query(
      `SELECT 1 FROM resource_schema WHERE schema_id = $1`,
      [schemaId]
    );
    if (existsSchema.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    if (nameRaw) {
      const updName = await client.query(
        `UPDATE resource_schema SET name = $1 WHERE schema_id = $2 RETURNING schema_id`,
        [nameRaw, schemaId]
      );
      if (updName.rows.length === 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
      }
    }

    const setParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (descriptionForLlm !== undefined) {
      setParts.push(`description_for_llm = $${i++}`);
      params.push(descriptionForLlm);
    }
    if (commentForUser !== undefined) {
      setParts.push(`comment_for_user = $${i++}`);
      params.push(commentForUser);
    }
    if (isActive !== undefined) {
      setParts.push(`is_active = $${i++}`);
      params.push(isActive);
    }

    if (setParts.length > 0) {
      params.push(schemaId);
      await client.query(
        `UPDATE resource SET ${setParts.join(', ')} WHERE resource_id = $${i}`,
        params
      );
    }

    await client.query('COMMIT');

    const row = await db.query(
      `SELECT rs.schema_id,
              rs.name AS schema_name,
              r.description_for_llm,
              r.comment_for_user,
              r.is_active
       FROM resource_schema rs
       JOIN resource r ON r.resource_id = rs.schema_id
       WHERE rs.schema_id = $1`,
      [schemaId]
    );
    if (row.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    const s = row.rows[0];
    res.json({
      schema_id: s.schema_id,
      name: s.schema_name,
      description_for_llm: s.description_for_llm,
      comment_for_user: s.comment_for_user,
      is_active: s.is_active,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.delete('/api/admin/resource-schemas/:schemaId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const schemaId = parsePositiveIntParam(req.params.schemaId);
    if (!schemaId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const check = await client.query(`SELECT 1 FROM resource_schema WHERE schema_id = $1`, [
      schemaId,
    ]);
    if (check.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);
    await deleteSchemaResource(client, schemaId);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/resource-schemas/:schemaId/tables', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const schemaId = parsePositiveIntParam(req.params.schemaId);
    if (!schemaId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const sch = await db.query(`SELECT 1 FROM resource_schema WHERE schema_id = $1`, [schemaId]);
    if (sch.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (!isValidResourceHierarchyName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);
    const isActive = normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);
    const resourceId = await insertResourceRecord(
      client,
      userId,
      descriptionForLlm,
      commentForUser,
      isActive
    );
    await client.query(
      `INSERT INTO resource_table (table_id, schema_id, name)
       VALUES ($1, $2, $3)`,
      [resourceId, schemaId, nameRaw]
    );
    await client.query('COMMIT');
    res.status(201).json({
      table_id: resourceId,
      name: nameRaw,
      description_for_llm: descriptionForLlm,
      comment_for_user: commentForUser,
      is_active: isActive,
      columns: [],
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.put('/api/admin/resource-tables/:tableId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableId = parsePositiveIntParam(req.params.tableId);
    if (!tableId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (nameRaw && !isValidResourceHierarchyName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm =
      'description_for_llm' in body ? normalizeTrimmedString(body.description_for_llm) : undefined;
    const commentForUser =
      'comment_for_user' in body ? normalizeTrimmedString(body.comment_for_user) : undefined;
    const isActive =
      body.is_active === undefined ? undefined : normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);

    const existsTable = await client.query(`SELECT 1 FROM resource_table WHERE table_id = $1`, [
      tableId,
    ]);
    if (existsTable.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    if (nameRaw) {
      const updName = await client.query(
        `UPDATE resource_table SET name = $1 WHERE table_id = $2 RETURNING table_id`,
        [nameRaw, tableId]
      );
      if (updName.rows.length === 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
      }
    }

    const setParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (descriptionForLlm !== undefined) {
      setParts.push(`description_for_llm = $${i++}`);
      params.push(descriptionForLlm);
    }
    if (commentForUser !== undefined) {
      setParts.push(`comment_for_user = $${i++}`);
      params.push(commentForUser);
    }
    if (isActive !== undefined) {
      setParts.push(`is_active = $${i++}`);
      params.push(isActive);
    }

    if (setParts.length > 0) {
      params.push(tableId);
      await client.query(
        `UPDATE resource SET ${setParts.join(', ')} WHERE resource_id = $${i}`,
        params
      );
    }

    await client.query('COMMIT');

    const row = await db.query(
      `SELECT rt.table_id,
              rt.name AS table_name,
              r.description_for_llm,
              r.comment_for_user,
              r.is_active
       FROM resource_table rt
       JOIN resource r ON r.resource_id = rt.table_id
       WHERE rt.table_id = $1`,
      [tableId]
    );
    if (row.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    const t = row.rows[0];
    res.json({
      table_id: t.table_id,
      name: t.table_name,
      description_for_llm: t.description_for_llm,
      comment_for_user: t.comment_for_user,
      is_active: t.is_active,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.delete('/api/admin/resource-tables/:tableId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableId = parsePositiveIntParam(req.params.tableId);
    if (!tableId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const check = await client.query(`SELECT 1 FROM resource_table WHERE table_id = $1`, [tableId]);
    if (check.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);
    await deleteTableResource(client, tableId);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.post('/api/admin/resource-tables/:tableId/columns', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableId = parsePositiveIntParam(req.params.tableId);
    if (!tableId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const tbl = await db.query(`SELECT 1 FROM resource_table WHERE table_id = $1`, [tableId]);
    if (tbl.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (!isValidResourceColumnName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm = normalizeTrimmedString(body.description_for_llm);
    const commentForUser = normalizeTrimmedString(body.comment_for_user);
    const isActive = normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);
    const resourceId = await insertResourceRecord(
      client,
      userId,
      descriptionForLlm,
      commentForUser,
      isActive
    );
    await client.query(
      `INSERT INTO resource_column (column_id, table_id, name)
       VALUES ($1, $2, $3)`,
      [resourceId, tableId, nameRaw]
    );
    await client.query('COMMIT');
    res.status(201).json({
      column_id: resourceId,
      name: nameRaw,
      description_for_llm: descriptionForLlm,
      comment_for_user: commentForUser,
      is_active: isActive,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.put('/api/admin/resource-columns/:columnId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const columnId = parsePositiveIntParam(req.params.columnId);
    if (!columnId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const body = req.body ?? {};
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
    if (nameRaw && !isValidResourceColumnName(nameRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const descriptionForLlm =
      'description_for_llm' in body ? normalizeTrimmedString(body.description_for_llm) : undefined;
    const commentForUser =
      'comment_for_user' in body ? normalizeTrimmedString(body.comment_for_user) : undefined;
    const isActive =
      body.is_active === undefined ? undefined : normalizeBoolean(body.is_active, true);

    await beginAdminSession(client, userId);

    const existsCol = await client.query(`SELECT 1 FROM resource_column WHERE column_id = $1`, [
      columnId,
    ]);
    if (existsCol.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    }

    if (nameRaw) {
      const updName = await client.query(
        `UPDATE resource_column SET name = $1 WHERE column_id = $2 RETURNING column_id`,
        [nameRaw, columnId]
      );
      if (updName.rows.length === 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
      }
    }

    const setParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (descriptionForLlm !== undefined) {
      setParts.push(`description_for_llm = $${i++}`);
      params.push(descriptionForLlm);
    }
    if (commentForUser !== undefined) {
      setParts.push(`comment_for_user = $${i++}`);
      params.push(commentForUser);
    }
    if (isActive !== undefined) {
      setParts.push(`is_active = $${i++}`);
      params.push(isActive);
    }

    if (setParts.length > 0) {
      params.push(columnId);
      await client.query(
        `UPDATE resource SET ${setParts.join(', ')} WHERE resource_id = $${i}`,
        params
      );
    }

    await client.query('COMMIT');

    const row = await db.query(
      `SELECT rc.column_id,
              rc.name AS column_name,
              r.description_for_llm,
              r.comment_for_user,
              r.is_active
       FROM resource_column rc
       JOIN resource r ON r.resource_id = rc.column_id
       WHERE rc.column_id = $1`,
      [columnId]
    );
    if (row.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);
    const c = row.rows[0];
    res.json({
      column_id: c.column_id,
      name: c.column_name,
      description_for_llm: c.description_for_llm,
      comment_for_user: c.comment_for_user,
      is_active: c.is_active,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const pgCode = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

databasesRouter.delete('/api/admin/resource-columns/:columnId', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const columnId = parsePositiveIntParam(req.params.columnId);
    if (!columnId) return sendApiError(res, 400, ErrorCodes.DATABASE_ERROR);

    const check = await client.query(`SELECT 1 FROM resource_column WHERE column_id = $1`, [columnId]);
    if (check.rows.length === 0) return sendApiError(res, 404, ErrorCodes.DATABASE_ERROR);

    await beginAdminSession(client, userId);
    await client.query(`DELETE FROM resource WHERE resource_id = $1`, [columnId]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  } finally {
    client.release();
  }
});

