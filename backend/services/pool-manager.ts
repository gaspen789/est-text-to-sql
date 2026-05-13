import pg, { type Pool } from 'pg';

export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// Module-level cache — lives for the lifetime of the process, shared across requests.
// Key = host:port:database:user (password intentionally excluded).
const poolCache = new Map<string, Pool>();

export function getOrCreatePool(config: ConnectionConfig): Pool {
  const key = `${config.host}:${config.port}:${config.database}:${config.user}`;
  const existing = poolCache.get(key);
  if (existing) return existing;

  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Ensure consistent comment decoding regardless of server defaults.
    options: '-c client_encoding=UTF8',
  });

  poolCache.set(key, pool);
  return pool;
}
