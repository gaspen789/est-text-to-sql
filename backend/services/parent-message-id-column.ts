import type { Pool, PoolClient } from 'pg';
import { db } from '../db/index.js';

let cached: boolean | null = null;

/**
 * Returns whether the current schema's `message` table has `parent_message_id`.
 * Cached for the process lifetime.
 */
export async function hasParentMessageIdColumn(executor: Pool | PoolClient = db): Promise<boolean> {
  if (cached != null) return cached;

  const result = await executor.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'message'
       AND column_name = 'parent_message_id'
     LIMIT 1`
  );

  cached = result.rows.length > 0;
  return cached;
}

/** Test / hot-reload helper */
export function resetParentMessageIdColumnCache(): void {
  cached = null;
}
