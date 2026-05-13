import pg, { type Pool as PgPool } from 'pg';
import type { PoolConnection } from 'mysql2/promise';
import type { Pool as OraclePool, Connection as OracleConnection } from 'oracledb';
import type { FieldDef, ResultSetHeader, RowDataPacket } from 'mysql2';
import type { ConnectionConfig as PgConnectionConfig } from './pool-manager.js';
import { getOrCreatePool as getOrCreatePgPool } from './pool-manager.js';
import { validateQuery } from './query-validator.js';

export type ExternalDbmsCode = 'PGS' | 'MYQ' | 'ORA';

export type QueryResult = {
  columns: string[];
  rows: unknown[];
  rowCount: number;
};

export interface ExternalDbClient {
  query: (sql: string) => Promise<QueryResult>;
  release: () => Promise<void> | void;
  beginReadOnly?: () => Promise<void>;
  commit?: () => Promise<void>;
  rollback?: () => Promise<void>;
}

export interface ExternalDbPool {
  dbms: ExternalDbmsCode;
  connect: () => Promise<ExternalDbClient>;
}

export type ExternalConnectionConfig = PgConnectionConfig & {
  /** Used only by Oracle; for PGS/MYQ it can be omitted. */
  serviceName?: string;
  dbms: ExternalDbmsCode;
};

// --- MySQL / MariaDB pool cache (mysql2/promise) ---
type MysqlPool = {
  getConnection: () => Promise<PoolConnection>;
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

// --- Oracle pool cache (optional dependency: oracledb) ---
const oraclePoolCache = new Map<string, OraclePool>();

async function getOrCreateOraclePool(config: {
  host: string;
  port: number;
  serviceName: string;
  user: string;
  password: string;
}): Promise<OraclePool> {
  const key = `${config.host}:${config.port}:${config.serviceName}:${config.user}`;
  const existing = oraclePoolCache.get(key);
  if (existing) return existing;

  let oracledb: any;
  try {
    oracledb = (await import('oracledb')).default ?? (await import('oracledb'));
  } catch (_err) {
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

function mysqlRowsToQueryResult(rows: RowDataPacket[] | RowDataPacket[][] | ResultSetHeader, fields?: FieldDef[]): QueryResult {
  const arrayRows = Array.isArray(rows) ? (Array.isArray(rows[0]) ? (rows[0] as any[]) : (rows as any[])) : [];
  const columns = fields ? fields.map((f) => f.name) : arrayRows.length > 0 ? Object.keys(arrayRows[0] as any) : [];
  return { columns, rows: arrayRows, rowCount: arrayRows.length };
}

async function oracleExecToQueryResult(conn: OracleConnection, sql: string): Promise<QueryResult> {
  const oracledb: any = (await import('oracledb')).default ?? (await import('oracledb'));
  const result = await (conn as any).execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const rows = (result?.rows ?? []) as unknown[];
  const columns = rows.length > 0 && typeof rows[0] === 'object' && rows[0] != null ? Object.keys(rows[0] as any) : [];
  return { columns, rows, rowCount: rows.length };
}

function hasLimitLike(sql: string): boolean {
  // Keep this conservative: avoid adding caps if user already did.
  return (
    /\bLIMIT\b/i.test(sql) ||
    /\bFETCH\s+FIRST\b/i.test(sql) ||
    /\bROWNUM\b/i.test(sql) ||
    /\bOFFSET\b/i.test(sql)
  );
}

export function applyRowLimit(dbms: ExternalDbmsCode, sql: string, maxRows: number): string {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (hasLimitLike(trimmed)) return trimmed;

  if (dbms === 'ORA') {
    // Oracle: wrap with ROWNUM to avoid relying on 12c+ FETCH FIRST.
    return `SELECT * FROM (\n${trimmed}\n) WHERE ROWNUM <= ${maxRows}`;
  }

  // PostgreSQL / MySQL: LIMIT works.
  return `${trimmed} LIMIT ${maxRows}`;
}

export function assertQueryAllowed(sql: string): void {
  const validation = validateQuery(sql);
  if (!validation.valid) {
    throw new Error(`Query rejected: ${validation.reason ?? 'Query rejected.'}`);
  }
}

export async function createExternalPool(config: ExternalConnectionConfig): Promise<ExternalDbPool> {
  if (config.dbms === 'PGS') {
    const pgPool = getOrCreatePgPool(config);
    return {
      dbms: 'PGS',
      connect: async () => {
        const client = await pgPool.connect();
        return {
          query: async (sql: string) => {
            const res = await client.query(sql);
            return { columns: res.fields.map((f) => f.name), rows: res.rows, rowCount: res.rows.length };
          },
          release: () => client.release(),
          beginReadOnly: async () => {
            await client.query('BEGIN TRANSACTION READ ONLY');
            await client.query('SET LOCAL statement_timeout = 10000');
          },
          commit: async () => {
            await client.query('COMMIT');
          },
          rollback: async () => {
            await client.query('ROLLBACK');
          },
        };
      },
    };
  }

  if (config.dbms === 'MYQ') {
    const mysqlPool = await getOrCreateMysqlPool(config);
    return {
      dbms: 'MYQ',
      connect: async () => {
        const conn = await mysqlPool.getConnection();
        return {
          query: async (sql: string) => {
            const [rows, fields] = await (conn as any).query(sql);
            return mysqlRowsToQueryResult(rows, fields);
          },
          release: () => conn.release(),
          beginReadOnly: async () => {
            // MySQL "read only" transaction support varies; validation + grants are primary protection.
            await (conn as any).query('START TRANSACTION READ ONLY');
          },
          commit: async () => {
            await (conn as any).query('COMMIT');
          },
          rollback: async () => {
            await (conn as any).query('ROLLBACK');
          },
        };
      },
    };
  }

  // ORA
  const serviceName = config.serviceName ?? config.database;
  const oraPool = await getOrCreateOraclePool({
    host: config.host,
    port: config.port,
    serviceName,
    user: config.user,
    password: config.password,
  });
  return {
    dbms: 'ORA',
    connect: async () => {
      const conn = await (oraPool as any).getConnection();
      return {
        query: async (sql: string) => oracleExecToQueryResult(conn, sql),
        release: async () => {
          await (conn as any).close();
        },
        beginReadOnly: async () => {
          // Best-effort. If privileges disallow setting this, we still rely on query validation + DB grants.
          await (conn as any).execute('SET TRANSACTION READ ONLY').catch(() => {});
        },
        commit: async () => {
          await (conn as any).commit?.();
        },
        rollback: async () => {
          await (conn as any).rollback?.();
        },
      };
    },
  };
}

