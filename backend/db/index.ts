import { config } from 'dotenv';
import pg, { Pool } from 'pg';

pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(20, (value) => parseInt(value, 10));

config();

export const db = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '5432'),
});

export async function runQuery(db: Pool, text: string, params = []) {
  try {
    const result = await db.query(text, params);
    return result.rows;
  } catch (err: any) {
    throw new Error(err.message);
  }
}
