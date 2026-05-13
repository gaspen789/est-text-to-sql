import { config as loadEnv } from 'dotenv';
import type { Pool, PoolClient } from 'pg';
import { db as appDb } from '../db/index.js';
import { getOrCreatePool } from '../services/pool-manager.js';
import { decrypt } from '../services/encryption.js';

loadEnv();

/**
 * When TRUE: write external comments into BOTH `resource.description_for_llm` and `resource.comment_for_user`.
 * When FALSE: write only to `resource.description_for_llm`.
 */
const SAVE_COMMENTS_TO_COMMENT_FOR_USER = false;

/**
 * When TRUE: do not replace non-empty app-side descriptions/comments (only fill missing).
 * When FALSE: if the external DB has a non-empty comment, it overrides the app-side value.
 * Note: if the external DB comment is empty/NULL, the app-side value is preserved either way.
 */
const PRESERVE_EXISTING_APP_COMMENTS = true;

type CliOptions = {
  dryRun: boolean;
  skipConnectionErrors: boolean;
};

type CandidateDatabase = {
  database_id: number;
  database_name: string;
  dbms_code: string;
  host_name: string;
  port: number;
  username: string;
  password: string;
  is_admin: boolean;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const skipConnectionErrors =
    args.includes('--skip-connection-errors') || args.includes('--skip-connection-failures');
  const wantsHelp = args.includes('--help') || args.includes('-h');

  if (wantsHelp) {
    console.log(
      [
        'Usage: tsx scripts/sync-db-resources.ts [--dry-run|-n] [--skip-connection-errors]',
        '',
        'Options:',
        '  --dry-run, -n   Do not write anything to the backend database.',
        '  --skip-connection-errors   Continue (and exit 0) if external DB connections fail.',
        '',
        'Env:',
        '  CRON_APP_USER_ID  App user id used for auditing (default: 1).',
      ].join('\n')
    );
    process.exit(0);
  }

  return { dryRun, skipConnectionErrors };
}

async function fetchCandidateDatabases(): Promise<CandidateDatabase[]> {
  const r = await appDb.query(
    `SELECT
       rd.database_id,
       rd.name                AS database_name,
       COALESCE(v.dbms_code, '') AS dbms_code,
       dcc.host_name,
       dcc.port,
       dcc.username,
       dcc.password,
       dcc.is_admin           AS is_admin
     FROM resource_database rd
     JOIN resource r
       ON r.resource_id = rd.database_id
      AND r.is_active = TRUE
     LEFT JOIN LATERAL (
       SELECT encrypted_host_name AS host_name,
              port,
              encrypted_username  AS username,
              encrypted_password  AS password,
              is_admin,
              dbms_version_id
       FROM database_connection_credential
       WHERE database_id = rd.database_id
         AND is_active = TRUE
         AND is_admin = TRUE
       ORDER BY database_connection_credential_id DESC
       LIMIT 1
     ) dcc ON TRUE
     LEFT JOIN dbms_version v ON v.dbms_version_id = dcc.dbms_version_id
     ORDER BY rd.name`
  );

  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    database_id: row.database_id as number,
    database_name: row.database_name as string,
    dbms_code: String(row.dbms_code ?? ''),
    host_name: decrypt(row.host_name as string | null) ?? '',
    port: row.port === null || row.port === undefined ? 0 : Number(row.port),
    username: decrypt(row.username as string | null) ?? '',
    password: decrypt(row.password as string | null) ?? '',
    is_admin: Boolean(row.is_admin),
  }));
}

function hasAdminCredential(c: CandidateDatabase): boolean {
  return (
    c.is_admin === true &&
    Boolean(c.host_name) &&
    Number.isFinite(c.port) &&
    c.port > 0 &&
    Boolean(c.username) &&
    Boolean(c.password)
  );
}

type IntrospectedRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  info_table_type: string;
};

type IntrospectionResult = {
  schemas: string[];
  tableColumns: IntrospectedRow[];
};

type ExternalComments = {
  database_comment: string | null;
  schema_comment_by_name: Map<string, string>;
  table_comment_by_key: Map<string, string>; // `${schema}\0${table}`
  column_comment_by_key: Map<string, string>; // `${schema}\0${table}\0${column}`
};

function normalizeExternalComment(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // Ensure stable Unicode representation before saving into app DB.
  // (Also strip NUL which can cause unexpected DB/client issues.)
  const t = String(raw).normalize('NFC').replaceAll('\u0000', '').trim();
  return t === '' ? null : t;
}

function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}\0${tableName}`;
}

function columnKey(schemaName: string, tableName: string, columnName: string): string {
  return `${schemaName}\0${tableName}\0${columnName}`;
}

/** Maps information_schema.tables.table_type to `table_type.name` (lowercase) used in the app DB. */
function infoSchemaTableTypeToClassifierName(infoType: string): string {
  const u = infoType.trim().toUpperCase();
  if (u === 'BASE TABLE') return 'base table';
  if (u === 'VIEW') return 'view';
  if (u === 'MATERIALIZED VIEW') return 'materialized view';
  return infoType.trim().toLowerCase();
}

async function loadActiveTableTypeLookup(): Promise<Map<string, number>> {
  const r = await appDb.query(
    `SELECT table_type_id, name FROM table_type WHERE is_active = TRUE`
  );
  const m = new Map<string, number>();
  for (const row of r.rows as Array<{ table_type_id: number; name: string }>) {
    m.set(row.name.trim().toLowerCase(), row.table_type_id);
  }
  return m;
}

function resolveTableTypeId(
  lookup: Map<string, number>,
  infoTableType: string
): number | null {
  const key = infoSchemaTableTypeToClassifierName(infoTableType);
  return lookup.get(key) ?? null;
}

async function introspectSchemasPostgres(pool: Pool): Promise<string[]> {
  const r = await pool.query(
    `SELECT schema_name
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
       AND schema_name NOT LIKE 'pg\_%' ESCAPE '\'
     ORDER BY schema_name`
  );
  return (r.rows as Array<{ schema_name: string }>).map((x) => x.schema_name);
}

async function introspectSchemasTablesColumnsPostgres(pool: Pool): Promise<IntrospectedRow[]> {
  const r = await pool.query(
    `SELECT
       c.table_schema AS schema_name,
       c.table_name   AS table_name,
       c.column_name  AS column_name,
       t.table_type   AS info_table_type
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
     WHERE t.table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
       AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND c.table_schema NOT LIKE 'pg\_%' ESCAPE '\'
     ORDER BY c.table_schema, c.table_name, c.ordinal_position`
  );
  return r.rows as IntrospectedRow[];
}

/** `information_schema` / node-pg may return identifiers as string or number; normalize for storage. */
function normalizeColumnName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/**
 * Must match `chk_resource_column_name` on the **app** DB.
 * Validate on the app DB — do not rely on the remote cluster’s locale.
 */
async function columnNamePassesAppResourceCheck(client: PoolClient, name: string): Promise<boolean> {
  const r = await client.query(
    `SELECT ($1::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:][:space:]]+$') AS ok`,
    [name]
  );
  return Boolean(r.rows[0]?.ok);
}

async function columnNamePassesAppResourceCheckPool(name: string): Promise<boolean> {
  const r = await appDb.query(
    `SELECT ($1::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:][:space:]]+$') AS ok`,
    [name]
  );
  return Boolean(r.rows[0]?.ok);
}

async function introspectAllPostgres(pool: Pool): Promise<IntrospectionResult> {
  const [schemas, tableColumns] = await Promise.all([
    introspectSchemasPostgres(pool),
    introspectSchemasTablesColumnsPostgres(pool),
  ]);
  return { schemas, tableColumns };
}

// --- MySQL / MariaDB external access (mysql2/promise) ---
type MysqlPool = {
  query: (sql: string, params?: unknown[]) => Promise<[unknown[], unknown]>;
  end: () => Promise<void>;
};

const mysqlPoolCache = new Map<string, MysqlPool>();

async function getOrCreateMysqlPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<MysqlPool> {
  const key = `${config.host}:${config.port}:${config.database}:${config.user}`;
  const existing = mysqlPoolCache.get(key);
  if (existing) return existing;

  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: 5,
    connectTimeout: 5_000,
    charset: 'utf8mb4',
  }) as unknown as MysqlPool;

  mysqlPoolCache.set(key, pool);
  return pool;
}

async function mysqlQueryRows<T extends Record<string, any>>(
  pool: MysqlPool,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

async function introspectAllMysql(pool: MysqlPool): Promise<IntrospectionResult> {
  const schemas = await mysqlQueryRows<{ schema_name: string }>(
    pool,
    `SELECT schema_name
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
     ORDER BY schema_name`
  );

  const tableColumns = await mysqlQueryRows<IntrospectedRow>(
    pool,
    `SELECT
       c.table_schema AS schema_name,
       c.table_name   AS table_name,
       c.column_name  AS column_name,
       t.table_type   AS info_table_type
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
     WHERE t.table_type IN ('BASE TABLE', 'VIEW')
       AND c.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
     ORDER BY c.table_schema, c.table_name, c.ordinal_position`
  );

  return { schemas: schemas.map((s) => s.schema_name), tableColumns };
}

// --- Oracle external access (optional dependency: oracledb) ---
type OraclePool = {
  getConnection: () => Promise<{ execute: Function; close: () => Promise<void> }>;
  close: () => Promise<void>;
};

const oraclePoolCache = new Map<string, OraclePool>();

async function getOrCreateOraclePool(config: {
  host: string;
  port: number;
  serviceName: string; // treat Candidate.database_name as service name / connect identifier
  user: string;
  password: string;
}): Promise<OraclePool> {
  const key = `${config.host}:${config.port}:${config.serviceName}:${config.user}`;
  const existing = oraclePoolCache.get(key);
  if (existing) return existing;

  let oracledb: any;
  try {
    oracledb = (await import('oracledb')).default ?? (await import('oracledb'));
  } catch (err) {
    throw new Error(
      'Oracle support requires the optional dependency "oracledb" (and Oracle client libraries).'
    );
  }

  const connectString = `${config.host}:${config.port}/${config.serviceName}`;
  const pool = (await oracledb.createPool({
    user: config.user,
    password: config.password,
    connectString,
    poolMin: 0,
    poolMax: 5,
    poolIncrement: 1,
  })) as OraclePool;

  oraclePoolCache.set(key, pool);
  return pool;
}

async function oracleQueryRows<T extends Record<string, any>>(
  pool: OraclePool,
  sql: string,
  binds: Record<string, any> = {}
): Promise<T[]> {
  const conn = await pool.getConnection();
  try {
    const result = await (conn as any).execute(sql, binds, {
      outFormat: (await import('oracledb').catch(() => ({} as any))).OUT_FORMAT_OBJECT,
    });
    return (result?.rows ?? []) as T[];
  } finally {
    await conn.close();
  }
}

async function introspectAllOracle(pool: OraclePool): Promise<IntrospectionResult> {
  // Oracle "schemas" are users. We focus on objects visible in ALL_* views.
  const tableColumns = await oracleQueryRows<{
    schema_name: string;
    table_name: string;
    column_name: string;
    info_table_type: string;
  }>(
    pool,
    `
    SELECT
      c.owner AS schema_name,
      c.table_name AS table_name,
      c.column_name AS column_name,
      CASE
        WHEN EXISTS (SELECT 1 FROM all_views v WHERE v.owner = c.owner AND v.view_name = c.table_name) THEN 'VIEW'
        ELSE 'BASE TABLE'
      END AS info_table_type
    FROM all_tab_columns c
    WHERE c.hidden_column = 'NO'
      AND c.owner NOT IN ('SYS','SYSTEM')
    ORDER BY c.owner, c.table_name, c.column_id
    `
  );

  const schemas = [...new Set(tableColumns.map((r) => r.schema_name))].sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    schemas,
    tableColumns: tableColumns.map((r) => ({
      schema_name: r.schema_name,
      table_name: r.table_name,
      column_name: r.column_name,
      info_table_type: r.info_table_type,
    })),
  };
}

async function fetchCommentsPostgres(pool: Pool): Promise<ExternalComments> {
  const dbRes = await pool.query(
    `SELECT pg_catalog.shobj_description(
              (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()),
              'pg_database'
            ) AS comment`
  );
  const database_comment = normalizeExternalComment(dbRes.rows[0]?.comment);

  const schRows = await pool.query(
    `SELECT n.nspname AS schema_name, obj_description(n.oid, 'pg_namespace') AS comment
     FROM pg_catalog.pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     ORDER BY n.nspname`
  );
  const schema_comment_by_name = new Map<string, string>();
  for (const r of schRows.rows as Array<{ schema_name: string; comment: unknown }>) {
    const c = normalizeExternalComment(r.comment);
    if (c) schema_comment_by_name.set(r.schema_name, c);
  }

  const tblRows = await pool.query(
    `SELECT n.nspname AS schema_name, c.relname AS table_name, obj_description(c.oid, 'pg_class') AS comment
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v','m')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     ORDER BY n.nspname, c.relname`
  );
  const table_comment_by_key = new Map<string, string>();
  for (const r of tblRows.rows as Array<{ schema_name: string; table_name: string; comment: unknown }>) {
    const c = normalizeExternalComment(r.comment);
    if (c) table_comment_by_key.set(tableKey(r.schema_name, r.table_name), c);
  }

  const colRows = await pool.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            a.attname AS column_name,
            col_description(c.oid, a.attnum) AS comment
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v','m')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     ORDER BY n.nspname, c.relname, a.attnum`
  );
  const column_comment_by_key = new Map<string, string>();
  for (const r of colRows.rows as Array<{
    schema_name: string;
    table_name: string;
    column_name: string;
    comment: unknown;
  }>) {
    const c = normalizeExternalComment(r.comment);
    if (c) column_comment_by_key.set(columnKey(r.schema_name, r.table_name, r.column_name), c);
  }

  return { database_comment, schema_comment_by_name, table_comment_by_key, column_comment_by_key };
}

async function fetchCommentsMysql(pool: MysqlPool, databaseName: string): Promise<ExternalComments> {
  // MySQL treats "database" as "schema". We map database comment from SCHEMATA.SCHEMA_COMMENT.
  const dbRows = await mysqlQueryRows<{ comment: unknown }>(
    pool,
    `SELECT schema_comment AS comment
     FROM information_schema.schemata
     WHERE schema_name = ?`,
    [databaseName]
  );
  const database_comment = normalizeExternalComment(dbRows[0]?.comment);

  const schRows = await mysqlQueryRows<{ schema_name: string; comment: unknown }>(
    pool,
    `SELECT schema_name, schema_comment AS comment
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
     ORDER BY schema_name`
  );
  const schema_comment_by_name = new Map<string, string>();
  for (const r of schRows) {
    const c = normalizeExternalComment(r.comment);
    if (c) schema_comment_by_name.set(r.schema_name, c);
  }

  const tblRows = await mysqlQueryRows<{ schema_name: string; table_name: string; comment: unknown }>(
    pool,
    `SELECT table_schema AS schema_name, table_name, table_comment AS comment
     FROM information_schema.tables
     WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
       AND table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY table_schema, table_name`
  );
  const table_comment_by_key = new Map<string, string>();
  for (const r of tblRows) {
    const c = normalizeExternalComment(r.comment);
    if (c) table_comment_by_key.set(tableKey(r.schema_name, r.table_name), c);
  }

  const colRows = await mysqlQueryRows<{
    schema_name: string;
    table_name: string;
    column_name: string;
    comment: unknown;
  }>(
    pool,
    `SELECT table_schema AS schema_name, table_name, column_name, column_comment AS comment
     FROM information_schema.columns
     WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
     ORDER BY table_schema, table_name, ordinal_position`
  );
  const column_comment_by_key = new Map<string, string>();
  for (const r of colRows) {
    const c = normalizeExternalComment(r.comment);
    if (c) column_comment_by_key.set(columnKey(r.schema_name, r.table_name, r.column_name), c);
  }

  return { database_comment, schema_comment_by_name, table_comment_by_key, column_comment_by_key };
}

async function fetchCommentsOracle(_pool: OraclePool): Promise<ExternalComments> {
  // Oracle has table/view and column comments (ALL_TAB_COMMENTS / ALL_COL_COMMENTS).
  // Database-level comments are not a standard concept; schema/user comments are also non-standard.
  const database_comment: string | null = null;
  const schema_comment_by_name = new Map<string, string>();

  // Note: ALL_TAB_COMMENTS includes comments for both TABLE and VIEW in TABLE_TYPE.
  const tbl = await oracleQueryRows<{ schema_name: string; table_name: string; comment: unknown }>(
    _pool,
    `
    SELECT owner AS schema_name, table_name, comments AS comment
    FROM all_tab_comments
    WHERE owner NOT IN ('SYS','SYSTEM')
      AND table_type IN ('TABLE','VIEW')
    ORDER BY owner, table_name
    `
  );
  const table_comment_by_key = new Map<string, string>();
  for (const r of tbl) {
    const c = normalizeExternalComment(r.comment);
    if (c) table_comment_by_key.set(tableKey(r.schema_name, r.table_name), c);
  }

  const cols = await oracleQueryRows<{
    schema_name: string;
    table_name: string;
    column_name: string;
    comment: unknown;
  }>(
    _pool,
    `
    SELECT owner AS schema_name, table_name, column_name, comments AS comment
    FROM all_col_comments
    WHERE owner NOT IN ('SYS','SYSTEM')
    ORDER BY owner, table_name, column_name
    `
  );
  const column_comment_by_key = new Map<string, string>();
  for (const r of cols) {
    const c = normalizeExternalComment(r.comment);
    if (c) column_comment_by_key.set(columnKey(r.schema_name, r.table_name, r.column_name), c);
  }

  return { database_comment, schema_comment_by_name, table_comment_by_key, column_comment_by_key };
}

function emptyComments(): ExternalComments {
  return {
    database_comment: null,
    schema_comment_by_name: new Map(),
    table_comment_by_key: new Map(),
    column_comment_by_key: new Map(),
  };
}

async function beginCronSession(client: PoolClient, appUserId: number): Promise<void> {
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', [
    'myapp.current_user_id',
    String(appUserId),
  ]);
}

async function createResource(client: PoolClient, appUserId: number): Promise<number> {
  const ins = await client.query(
    `INSERT INTO resource (creator, modifier, description_for_llm, comment_for_user, is_active)
     VALUES ($1, $1, NULL, NULL, TRUE)
     RETURNING resource_id`,
    [appUserId]
  );
  return ins.rows[0].resource_id as number;
}

async function applyExternalCommentToResource(
  client: PoolClient,
  resourceId: number,
  externalCommentRaw: unknown
): Promise<{ descriptionUpdated: number; commentForUserUpdated: number }> {
  const externalComment = normalizeExternalComment(externalCommentRaw);
  if (!externalComment) return { descriptionUpdated: 0, commentForUserUpdated: 0 };

  if (PRESERVE_EXISTING_APP_COMMENTS) {
    // Fill only if empty in app DB.
    const updDesc = await client.query(
      `UPDATE resource
       SET description_for_llm = $1
       WHERE resource_id = $2
         AND (description_for_llm IS NULL OR btrim(description_for_llm) = '')`,
      [externalComment, resourceId]
    );
    let descriptionUpdated = updDesc.rowCount ?? 0;

    let commentForUserUpdated = 0;
    if (SAVE_COMMENTS_TO_COMMENT_FOR_USER) {
      const updUser = await client.query(
        `UPDATE resource
         SET comment_for_user = $1
         WHERE resource_id = $2
           AND (comment_for_user IS NULL OR btrim(comment_for_user) = '')`,
        [externalComment, resourceId]
      );
      commentForUserUpdated = updUser.rowCount ?? 0;
    }
    return { descriptionUpdated, commentForUserUpdated };
  }

  // Override mode: if the external DB has a non-empty comment, it becomes the canonical value.
  if (SAVE_COMMENTS_TO_COMMENT_FOR_USER) {
    const upd = await client.query(
      `UPDATE resource
       SET description_for_llm = $1,
           comment_for_user = $1
       WHERE resource_id = $2`,
      [externalComment, resourceId]
    );
    const n = upd.rowCount ?? 0;
    return { descriptionUpdated: n, commentForUserUpdated: n };
  } else {
    const upd = await client.query(
      `UPDATE resource
       SET description_for_llm = $1
       WHERE resource_id = $2`,
      [externalComment, resourceId]
    );
    const n = upd.rowCount ?? 0;
    return { descriptionUpdated: n, commentForUserUpdated: 0 };
  }
}

async function upsertSchema(
  client: PoolClient,
  appUserId: number,
  databaseId: number,
  schemaName: string
): Promise<{ schemaId: number; created: boolean }> {
  const existing = await client.query(
    `SELECT schema_id
     FROM resource_schema
     WHERE database_id = $1 AND name = $2
     LIMIT 1`,
    [databaseId, schemaName]
  );
  if (existing.rows.length > 0) return { schemaId: existing.rows[0].schema_id as number, created: false };

  const resourceId = await createResource(client, appUserId);
  await client.query(
    `INSERT INTO resource_schema (schema_id, database_id, name)
     VALUES ($1, $2, $3)`,
    [resourceId, databaseId, schemaName]
  );
  return { schemaId: resourceId, created: true };
}

async function upsertTable(
  client: PoolClient,
  appUserId: number,
  schemaId: number,
  tableName: string,
  tableTypeId: number | null
): Promise<{ tableId: number; created: boolean }> {
  const existing = await client.query(
    `SELECT table_id, table_type_id
     FROM resource_table
     WHERE schema_id = $1 AND name = $2
     LIMIT 1`,
    [schemaId, tableName]
  );
  if (existing.rows.length > 0) {
    const tableId = existing.rows[0].table_id as number;
    const currentType = existing.rows[0].table_type_id as number | null;
    if (tableTypeId != null && currentType !== tableTypeId) {
      await client.query(`UPDATE resource_table SET table_type_id = $1 WHERE table_id = $2`, [
        tableTypeId,
        tableId,
      ]);
    }
    return { tableId, created: false };
  }

  const resourceId = await createResource(client, appUserId);
  await client.query(
    `INSERT INTO resource_table (table_id, schema_id, name, table_type_id)
     VALUES ($1, $2, $3, $4)`,
    [resourceId, schemaId, tableName, tableTypeId]
  );
  return { tableId: resourceId, created: true };
}

async function upsertColumn(
  client: PoolClient,
  appUserId: number,
  tableId: number,
  columnNameRaw: unknown,
  logContext: { schema: string; table: string }
): Promise<{ columnId: number; created: boolean } | null> {
  const columnName = normalizeColumnName(columnNameRaw);
  if (columnName == null) return null;

  if (!(await columnNamePassesAppResourceCheck(client, columnName))) {
    const codes = [...columnName].map((ch) => ch.codePointAt(0));
    console.warn(
      `Skipping column (fails chk_resource_column_name on app DB): ${logContext.schema}.${logContext.table}.${JSON.stringify(columnName)} codePoints=${codes.join(',')}`
    );
    return null;
  }

  const existing = await client.query(
    `SELECT column_id
     FROM resource_column
     WHERE table_id = $1 AND name = $2
     LIMIT 1`,
    [tableId, columnName]
  );
  if (existing.rows.length > 0) {
    return { columnId: existing.rows[0].column_id as number, created: false };
  }

  const resourceId = await createResource(client, appUserId);
  await client.query(
    `INSERT INTO resource_column (column_id, table_id, name)
     VALUES ($1, $2, $3)`,
    [resourceId, tableId, columnName]
  );
  return { columnId: resourceId, created: true };
}

async function syncResourcesForDatabase(
  appUserId: number,
  databaseId: number,
  introspectedSchemas: string[],
  rows: IntrospectedRow[],
  typeLookup: Map<string, number>,
  comments: ExternalComments,
  options: CliOptions
): Promise<{
  schemas: number;
  tables: number;
  columns: number;
  updated_description_for_llm: number;
  updated_comment_for_user: number;
}> {
  if (options.dryRun) {
    const desiredSchemas = new Set<string>();
    const desiredTables = new Set<string>(); // `${schemaName}.${tableName}`
    const desiredColumns = new Set<string>(); // `${schemaName}.${tableName}.${columnName}`

    for (const s of introspectedSchemas) desiredSchemas.add(s);
    for (const r of rows) {
      desiredSchemas.add(r.schema_name);
      desiredTables.add(`${r.schema_name}.${r.table_name}`);
      const cn = normalizeColumnName(r.column_name);
      if (cn != null && (await columnNamePassesAppResourceCheckPool(cn))) {
        desiredColumns.add(`${r.schema_name}.${r.table_name}.${cn}`);
      }
    }

    const existingSchemasRes = await appDb.query(
      `SELECT rs.schema_id, rs.name
       FROM resource_schema rs
       WHERE rs.database_id = $1`,
      [databaseId]
    );
    const existingSchemasByName = new Map<string, number>();
    for (const s of existingSchemasRes.rows as Array<{ schema_id: number; name: string }>) {
      existingSchemasByName.set(s.name, s.schema_id);
    }

    const existingTablesRes = await appDb.query(
      `SELECT rt.name AS table_name, rs.name AS schema_name
       FROM resource_table rt
       JOIN resource_schema rs ON rs.schema_id = rt.schema_id
       WHERE rs.database_id = $1`,
      [databaseId]
    );
    const existingTables = new Set<string>();
    for (const t of existingTablesRes.rows as Array<{ schema_name: string; table_name: string }>) {
      existingTables.add(`${t.schema_name}.${t.table_name}`);
    }

    const existingColumnsRes = await appDb.query(
      `SELECT rc.name AS column_name, rt.name AS table_name, rs.name AS schema_name
       FROM resource_column rc
       JOIN resource_table rt ON rt.table_id = rc.table_id
       JOIN resource_schema rs ON rs.schema_id = rt.schema_id
       WHERE rs.database_id = $1`,
      [databaseId]
    );
    const existingColumns = new Set<string>();
    for (const c of existingColumnsRes.rows as Array<{
      schema_name: string;
      table_name: string;
      column_name: string;
    }>) {
      existingColumns.add(`${c.schema_name}.${c.table_name}.${c.column_name}`);
    }

    let missingSchemas = 0;
    for (const s of desiredSchemas) if (!existingSchemasByName.has(s)) missingSchemas += 1;

    let missingTables = 0;
    for (const t of desiredTables) if (!existingTables.has(t)) missingTables += 1;

    let missingColumns = 0;
    for (const c of desiredColumns) if (!existingColumns.has(c)) missingColumns += 1;

    return {
      schemas: missingSchemas,
      tables: missingTables,
      columns: missingColumns,
      updated_description_for_llm: 0,
      updated_comment_for_user: 0,
    };
  }

  const client = await appDb.connect();
  try {
    await beginCronSession(client, appUserId);

    const schemaIdByName = new Map<string, number>();
    const tableIdByKey = new Map<string, number>(); // `${schemaId}:${tableName}`

    let createdSchemas = 0;
    let createdTables = 0;
    let createdColumns = 0;
    let updatedDescription = 0;
    let updatedUserComment = 0;

    // Database-level comment applies to the database resource row itself.
    {
      const u = await applyExternalCommentToResource(client, databaseId, comments.database_comment);
      updatedDescription += u.descriptionUpdated;
      updatedUserComment += u.commentForUserUpdated;
    }

    for (const schemaName of introspectedSchemas) {
      if (schemaIdByName.has(schemaName)) continue;
      const up = await upsertSchema(client, appUserId, databaseId, schemaName);
      schemaIdByName.set(schemaName, up.schemaId);
      if (up.created) createdSchemas += 1;
      {
        const u = await applyExternalCommentToResource(
          client,
          up.schemaId,
          comments.schema_comment_by_name.get(schemaName) ?? null
        );
        updatedDescription += u.descriptionUpdated;
        updatedUserComment += u.commentForUserUpdated;
      }
    }

    for (const row of rows) {
      const schemaName = row.schema_name;
      const tableName = row.table_name;
      const tableTypeId = resolveTableTypeId(typeLookup, row.info_table_type);

      let schemaId = schemaIdByName.get(schemaName);
      if (!schemaId) {
        const upSch = await upsertSchema(client, appUserId, databaseId, schemaName);
        schemaId = upSch.schemaId;
        schemaIdByName.set(schemaName, schemaId);
        if (upSch.created) createdSchemas += 1;
        {
          const u = await applyExternalCommentToResource(
            client,
            schemaId,
            comments.schema_comment_by_name.get(schemaName) ?? null
          );
          updatedDescription += u.descriptionUpdated;
          updatedUserComment += u.commentForUserUpdated;
        }
      }

      const tableIdKey = `${schemaId}:${tableName}`;
      let tableId = tableIdByKey.get(tableIdKey);
      if (!tableId) {
        const upTbl = await upsertTable(client, appUserId, schemaId, tableName, tableTypeId);
        tableId = upTbl.tableId;
        tableIdByKey.set(tableIdKey, tableId);
        if (upTbl.created) createdTables += 1;
      }

      {
        const u = await applyExternalCommentToResource(
          client,
          tableId,
          comments.table_comment_by_key.get(tableKey(schemaName, tableName)) ?? null
        );
        updatedDescription += u.descriptionUpdated;
        updatedUserComment += u.commentForUserUpdated;
      }

      const columnName = normalizeColumnName(row.column_name);
      if (columnName == null) continue;

      const upCol = await upsertColumn(client, appUserId, tableId, columnName, {
        schema: schemaName,
        table: tableName,
      });
      if (upCol != null) {
        if (upCol.created) createdColumns += 1;
        {
          const u = await applyExternalCommentToResource(
            client,
            upCol.columnId,
            comments.column_comment_by_key.get(columnKey(schemaName, tableName, columnName)) ?? null
          );
          updatedDescription += u.descriptionUpdated;
          updatedUserComment += u.commentForUserUpdated;
        }
      }
    }

    await client.query('COMMIT');
    return {
      schemas: createdSchemas,
      tables: createdTables,
      columns: createdColumns,
      updated_description_for_llm: updatedDescription,
      updated_comment_for_user: updatedUserComment,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv);
  const appUserId = envInt('CRON_APP_USER_ID', 1);

  const candidates = await fetchCandidateDatabases();
  if (candidates.length === 0) {
    throw new Error('No active databases with active credentials found in resource_database.');
  }

  const withAdmin = candidates.filter(hasAdminCredential);
  const withoutAdmin = candidates.filter((c) => !hasAdminCredential(c));
  for (const c of withoutAdmin) {
    console.warn(
      `Skipping database "${c.database_name}" (database_id=${c.database_id}): no active is_admin credential found.`
    );
  }

  if (withAdmin.length === 0) {
    const msg = 'No databases have an active database_connection_credential with is_admin=true.';
    if (options.skipConnectionErrors) {
      console.warn(`${msg} Skipping due to --skip-connection-errors.`);
      return;
    }
    throw new Error(msg);
  }

  const typeLookup = await loadActiveTableTypeLookup();
  if (typeLookup.size === 0) {
    console.warn(
      'No active rows in table_type; resource_table.table_type_id will stay NULL until classifiers exist (e.g. base table, view, materialized view).'
    );
  }

  let total = { schemas: 0, tables: 0, columns: 0 };

  for (const chosen of withAdmin) {
    console.log(
      `Processing database: ${chosen.database_name} [${chosen.dbms_code || 'UNKNOWN'}] (${chosen.host_name}:${chosen.port} as ${chosen.username})`
    );

    let introspection: IntrospectionResult;
    let comments: ExternalComments = emptyComments();
    try {
      if (chosen.dbms_code === 'PGS') {
        const externalPool = getOrCreatePool({
          host: chosen.host_name,
          port: chosen.port,
          database: chosen.database_name,
          user: chosen.username,
          password: chosen.password,
        });
        introspection = await introspectAllPostgres(externalPool);
        comments = await fetchCommentsPostgres(externalPool);
      } else if (chosen.dbms_code === 'MYQ') {
        const mysqlPool = await getOrCreateMysqlPool({
          host: chosen.host_name,
          port: chosen.port,
          database: chosen.database_name,
          user: chosen.username,
          password: chosen.password,
        });
        introspection = await introspectAllMysql(mysqlPool);
        comments = await fetchCommentsMysql(mysqlPool, chosen.database_name);
      } else if (chosen.dbms_code === 'ORA') {
        const oraPool = await getOrCreateOraclePool({
          host: chosen.host_name,
          port: chosen.port,
          serviceName: chosen.database_name,
          user: chosen.username,
          password: chosen.password,
        });
        introspection = await introspectAllOracle(oraPool);
        comments = await fetchCommentsOracle(oraPool);
      } else if (chosen.dbms_code === 'SLT') {
        // SQLite does not support server-side metadata in this setup (no host/port-based connection).
        throw new Error('SQLite external introspection is not supported by this sync script.');
      } else {
        throw new Error(`Unsupported DBMS code "${chosen.dbms_code || 'UNKNOWN'}" for external introspection.`);
      }

      const viewLike = introspection.tableColumns.filter(
        (r) => r.info_table_type === 'VIEW' || r.info_table_type === 'MATERIALIZED VIEW'
      ).length;
      console.log(
        `Introspected ${introspection.schemas.length} schemas, ${introspection.tableColumns.length} column rows (${viewLike} in views/materialized views) from "${chosen.database_name}".`
      );

      console.log(
        `External comments pulled for "${chosen.database_name}": ` +
          `db=${comments.database_comment ? 'yes' : 'no'}, ` +
          `schemas=${comments.schema_comment_by_name.size}, ` +
          `tables=${comments.table_comment_by_key.size}, ` +
          `columns=${comments.column_comment_by_key.size}`
      );
    } catch (err) {
      if (options.skipConnectionErrors) {
        console.warn(
          `Failed to introspect external database "${chosen.database_name}"; skipping due to --skip-connection-errors.`,
          err
        );
        continue;
      }
      throw err;
    }

    const result = await syncResourcesForDatabase(
      appUserId,
      chosen.database_id,
      introspection.schemas,
      introspection.tableColumns,
      typeLookup,
      comments,
      options
    );
    total = {
      schemas: total.schemas + result.schemas,
      tables: total.tables + result.tables,
      columns: total.columns + result.columns,
    };

    if (options.dryRun) {
      console.log(`Dry run for "${chosen.database_name}" complete. Would create:`, result);
    } else {
      console.log(`Sync for "${chosen.database_name}" complete. Created:`, result);
    }
  }

  if (options.dryRun) {
    console.log('Dry run complete (all databases). Totals:', total);
  } else {
    console.log('Sync complete (all databases). Totals:', total);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
