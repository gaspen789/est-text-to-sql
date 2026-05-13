import type { Pool, PoolClient } from 'pg';
import { db } from '../db/index.js';

export type MessageBodyColumn = 'encrypted_content' | 'content';

let cached: MessageBodyColumn | null = null;

function assertMessageBodyColumn(name: string): asserts name is MessageBodyColumn {
  if (name !== 'encrypted_content' && name !== 'content') {
    throw new Error(`Invalid message body column name: ${name}`);
  }
}

/**
 * Resolves whether the `message` table stores body text in `encrypted_content` or legacy `content`.
 * Prefer `encrypted_content` when both exist. Result is cached for the process lifetime.
 */
export async function getMessageBodyColumn(executor: Pool | PoolClient = db): Promise<MessageBodyColumn> {
  if (cached) return cached;

  const result = await executor.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'message'
       AND column_name IN ('encrypted_content', 'content')
     ORDER BY CASE column_name WHEN 'encrypted_content' THEN 0 ELSE 1 END
     LIMIT 1`
  );

  const col = result.rows[0]?.column_name;
  if (!col) {
    throw new Error(
      'Message table must have column "encrypted_content" or "content" (neither found in current_schema).'
    );
  }
  assertMessageBodyColumn(col);
  cached = col;
  return cached;
}

/** Test / hot-reload helper */
export function resetMessageBodyColumnCache(): void {
  cached = null;
}
