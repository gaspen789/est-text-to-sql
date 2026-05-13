import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { encrypt, decrypt } from '../services/encryption.js';

export const apisRouter = Router();

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

const API_SELECT =
  'SELECT llm_id, llm_api_id, llm_name, is_active_llm, encrypted_api_key AS api_key, encrypted_request_url AS request_url, token_limit_per_minute, request_limit_per_minute, request_limit_per_day FROM llm_api_detailed';

function decryptApiFields(row: Record<string, unknown>): Record<string, unknown> {
  const result = { ...row };
  if (typeof result.api_key === 'string') {
    result.api_key = decrypt(result.api_key);
  }
  if (typeof result.request_url === 'string') {
    result.request_url = decrypt(result.request_url);
  }
  return result;
}

apisRouter.get('/api/llm-api-all', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`${API_SELECT} WHERE llm_api_id IS NOT NULL ORDER BY llm_name, llm_api_id`);
    res.json(result.rows.map(decryptApiFields));
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

apisRouter.get('/api/llm-api/:id', async (req: Request, res: Response) => {
  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
    }

    const result = await db.query(`${API_SELECT} WHERE llm_id = $1`, [llmId]);
    res.json(result.rows.map(decryptApiFields));
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

apisRouter.post('/api/llm-api', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const {
      llm_id,
      api_key,
      request_url,
      is_active,
      token_limit_per_minute,
      request_limit_per_minute,
      request_limit_per_day,
    } = req.body;

    // Validate required fields
    if (!llm_id || !api_key) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const userId = req.headers['x-user-id'];
    if (
      !userId ||
      typeof userId !== 'string' ||
      !Number.isInteger(Number(userId)) ||
      Number(userId) <= 0
    ) {
      return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);
    }

    // Start transaction
    await client.query('BEGIN');

    // Set the local variable in the transaction
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    const result = await client.query(
      `SELECT f_add_llm_api($1, $2, $3, $4, $5, $6, $7) as api_id`,
      [
        llm_id,
        encrypt(api_key),
        encrypt(request_url),
        is_active !== undefined ? is_active : true,
        token_limit_per_minute || null,
        request_limit_per_minute || null,
        request_limit_per_day || null,
      ]
    );

    if (result.rows.length === 0 || !result.rows[0].api_id) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    }

    const newApiId = result.rows[0].api_id;

    // Fetch the created API entry to return it
    const createdResult = await client.query(`${API_SELECT} WHERE llm_api_id = $1`, [newApiId]);

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json(decryptApiFields(createdResult.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

apisRouter.put('/api/llm-api/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmApiId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmApiId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_API_ID);
    }

    const {
      llm_id,
      api_key,
      request_url,
      is_active,
      token_limit_per_minute,
      request_limit_per_minute,
      request_limit_per_day,
    } = req.body;

    // Validate required fields
    if (!llm_id || !api_key) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const userId = req.headers['x-user-id'];
    if (
      !userId ||
      typeof userId !== 'string' ||
      !Number.isInteger(Number(userId)) ||
      Number(userId) <= 0
    ) {
      return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);
    }

    // Start transaction
    await client.query('BEGIN');

    // Set the local variable in the transaction
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    const result = await client.query(
      `SELECT f_update_llm_api($1, $2, $3, $4, $5, $6, $7, $8) as success`,
      [
        llmApiId,
        llm_id,
        encrypt(api_key),
        encrypt(request_url),
        is_active !== undefined ? is_active : true,
        token_limit_per_minute || null,
        request_limit_per_minute || null,
        request_limit_per_day || null,
      ]
    );

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_API);
    }

    const updatedResult = await client.query(`${API_SELECT} WHERE llm_api_id = $1`, [llmApiId]);

    // Commit transaction
    await client.query('COMMIT');

    res.json(decryptApiFields(updatedResult.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

apisRouter.delete('/api/llm-api/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmApiId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmApiId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_API_ID);
    }

    const userId = req.headers['x-user-id'];
    if (
      !userId ||
      typeof userId !== 'string' ||
      !Number.isInteger(Number(userId)) ||
      Number(userId) <= 0
    ) {
      return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);
    }

    // Start transaction
    await client.query('BEGIN');

    // Set the local variable in the transaction
    await client.query('SELECT set_config($1, $2, true)', [
      'myapp.current_user_id',
      String(userId),
    ]);

    // Call the SQL function to delete the API data
    const result = await client.query('SELECT f_remove_llm_api($1) as success', [llmApiId]);

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_API);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(200).json({ success: true, message: 'API data deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});
