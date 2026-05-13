import { Router, Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { db } from '../db/index.js';
import { mapLlmDeleteForeignKeyError, mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { decrypt } from '../services/encryption.js';
export const modelsRouter = Router();

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function normalizeOtherParameterKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  return s === '' ? null : s;
}

const MODEL_SELECT =
  'SELECT llm_id, llm_group_id, llm_name, llm_group_name, model_company_name, model_company_country, llm_version, llm_context_length, llm_max_output_tokens, llm_other_parameters, llm_release_date, is_local_llm, is_active_llm, llm_created_at, llm_creator_email, llm_last_modified_at, llm_last_modifier_email FROM llm_detailed';

function normalizeLlmVersion(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Matches DB `d_positive_int` / nullable `max_output_tokens`: null when unset or invalid. */
function normalizeMaxOutputTokens(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function normalizeContextLength(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

async function countActiveLlms(client: PoolClient): Promise<number> {
  const r = await client.query<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM public.llm WHERE is_active = TRUE`
  );
  const raw = r.rows[0]?.c;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function llmHasUsableActiveApiKey(client: PoolClient, llmId: number): Promise<boolean> {
  const r = await client.query<{ encrypted_api_key: string | null }>(
    `SELECT encrypted_api_key
     FROM llm_api
     WHERE llm_id = $1 AND is_active = TRUE
     ORDER BY llm_api_id DESC`,
    [llmId]
  );
  for (const row of r.rows) {
    const key = decrypt(row.encrypted_api_key ?? null);
    if (key != null && String(key).trim() !== '') return true;
  }
  return false;
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

/** When `f_remove_llm` returns null, explain why (admin gate, missing row, or still active). */
async function resolveLlmDeleteNotAllowedCode(llmId: number, userId: number): Promise<string> {
  if (!(await isAdminUser(userId))) {
    return ErrorCodes.PERMISSION_DENIED;
  }
  const row = await db.query<{ is_active: boolean }>(
    `SELECT is_active FROM public.llm WHERE llm_id = $1`,
    [llmId]
  );
  if (row.rows.length === 0) {
    return ErrorCodes.LLM_DELETE_NOT_FOUND;
  }
  if (row.rows[0].is_active) {
    return ErrorCodes.LLM_DELETE_STILL_ACTIVE;
  }
  return ErrorCodes.LLM_DELETE_NOT_ALLOWED;
}

modelsRouter.get('/api/llms', async (req: Request, res: Response) => {
  try {
    const result = await db.query(MODEL_SELECT);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.get('/api/llms/active', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT llm_id, llm_group_id, llm_name, llm_group_name, model_company_name, model_company_country, llm_version, llm_context_length, llm_max_output_tokens, llm_other_parameters, llm_release_date, is_local_llm, is_active_llm, llm_created_at, llm_creator_email, llm_last_modified_at, llm_last_modifier_email FROM active_llm_detailed'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.get('/api/llms/inactive', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT llm_id, llm_group_id, llm_name, llm_group_name, model_company_name, model_company_country, llm_version, llm_context_length, llm_max_output_tokens, llm_other_parameters, llm_release_date, is_local_llm, is_active_llm, llm_created_at, llm_creator_email, llm_last_modified_at, llm_last_modifier_email FROM nonactive_llm_detailed'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.get('/api/llm-names', async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT llm_id, llm_name FROM llm_detailed ORDER BY llm_name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.get('/api/llm-names/active', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT llm_id, llm_name FROM active_llm_detailed ORDER BY llm_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.get('/api/llm-groups', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT llm_group_id, llm_group_name, llm_group_company FROM llm_group_active
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/**
 * Returns distinct "other parameter" keys that already exist in the database.
 * Keys are always normalized to lowercase.
 */
modelsRouter.get('/api/llms/other-parameter-keys', async (_req: Request, res: Response) => {
  try {
    const result = await db.query<{ key: string }>(`
      SELECT DISTINCT lower(k.key) AS key
      FROM (
        SELECT jsonb_object_keys(llm_other_parameters) AS key
        FROM llm_detailed
        WHERE llm_other_parameters IS NOT NULL
      ) AS k
      WHERE k.key IS NOT NULL AND btrim(k.key) <> ''
      ORDER BY lower(k.key)
    `);
    res.json(result.rows.map((r) => r.key));
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modelsRouter.post('/api/llms', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const {
      model_name,
      llm_group_id,
      version,
      context_length,
      max_output_tokens,
      other_parameters,
      release_date,
      is_local,
      is_active,
    } = req.body;

    const contextLen = normalizeContextLength(context_length);
    const maxOut = normalizeMaxOutputTokens(max_output_tokens);
    const versionNorm = normalizeLlmVersion(version);

    // Validate required fields (context_length must be a positive integer per `d_positive_int`)
    if (!model_name || !llm_group_id || contextLen === null) {
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

    // Convert other_parameters array to object if it's an array
    let otherParamsObject = {};
    if (Array.isArray(other_parameters)) {
      otherParamsObject = other_parameters.reduce((acc: Record<string, any>, param: any) => {
        const k = normalizeOtherParameterKey(param?.key);
        if (k) {
          acc[k] = param?.value;
        }
        return acc;
      }, {});
    } else if (other_parameters && typeof other_parameters === 'object') {
      const next: Record<string, any> = {};
      for (const [rawKey, rawVal] of Object.entries(other_parameters)) {
        const k = normalizeOtherParameterKey(rawKey);
        if (!k) continue;
        next[k] = rawVal;
      }
      otherParamsObject = next;
    }

    // Call the SQL function to create the llm
    const result = await client.query(
      `SELECT f_add_llm($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) as llm_id`,
      [
        model_name,
        llm_group_id,
        versionNorm,
        contextLen,
        maxOut,
        JSON.stringify(otherParamsObject),
        release_date || null,
        is_local !== undefined ? is_local : false,
        is_active !== undefined ? is_active : true,
      ]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    }

    const newLLMId = result.rows[0].llm_id;

    // Fetch the created llm to return it
    const createdResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [newLLMId]);

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json(createdResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.put('/api/llms/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
    }

    const {
      model_name,
      llm_group_id,
      version,
      context_length,
      max_output_tokens,
      other_parameters,
      release_date,
      is_local,
      is_active,
    } = req.body;

    const contextLen = normalizeContextLength(context_length);
    const maxOut = normalizeMaxOutputTokens(max_output_tokens);
    const versionNorm = normalizeLlmVersion(version);

    // Validate required fields (context_length must be a positive integer per `d_positive_int`)
    if (!model_name || !llm_group_id || contextLen === null) {
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

    // Convert other_parameters array to object if it's an array
    let otherParamsObject = {};
    if (Array.isArray(other_parameters)) {
      otherParamsObject = other_parameters.reduce((acc: Record<string, any>, param: any) => {
        const k = normalizeOtherParameterKey(param?.key);
        if (k) {
          acc[k] = param?.value;
        }
        return acc;
      }, {});
    } else if (other_parameters && typeof other_parameters === 'object') {
      const next: Record<string, any> = {};
      for (const [rawKey, rawVal] of Object.entries(other_parameters)) {
        const k = normalizeOtherParameterKey(rawKey);
        if (!k) continue;
        next[k] = rawVal;
      }
      otherParamsObject = next;
    }

    if (is_active === true && !(await llmHasUsableActiveApiKey(client, llmId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.LLM_ACTIVATE_REQUIRES_API);
    }

    // Call the SQL function to update the llm
    await client.query(`SELECT f_update_llm($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`, [
      llmId,
      llm_group_id,
      model_name,
      versionNorm,
      contextLen,
      maxOut,
      JSON.stringify(otherParamsObject),
      release_date || null,
      is_local,
      is_active,
    ]);

    // Commit transaction
    await client.query('COMMIT');

    // Fetch the updated llm to return it
    const updatedResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [llmId]);

    res.json(updatedResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.delete('/api/llms/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
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

    // Call the SQL function to delete the llm
    const result = await client.query(`SELECT f_remove_llm($1) as result`, [llmId]);

    // Check if deletion was successful
    const deletionResult = result.rows[0]?.result;
    if (deletionResult === null) {
      await client.query('ROLLBACK');
      const code = await resolveLlmDeleteNotAllowedCode(llmId, Number(userId));
      const status =
        code === ErrorCodes.LLM_DELETE_NOT_FOUND
          ? 404
          : code === ErrorCodes.PERMISSION_DENIED
            ? 403
            : code === ErrorCodes.LLM_DELETE_STILL_ACTIVE
              ? 400
              : 403;
      return sendApiError(res, status, code);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.json({ success: true, message: 'Llm deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const fk = mapLlmDeleteForeignKeyError(err);
    if (fk) {
      return sendApiError(res, 409, fk.code, fk.params);
    }
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.put('/api/llms/:id/activate', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
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

    if (!(await llmHasUsableActiveApiKey(client, llmId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.LLM_ACTIVATE_REQUIRES_API);
    }

    // Call the SQL function to activate the llm
    await client.query(`SELECT f_activate_llm($1)`, [llmId]);

    // Commit transaction
    await client.query('COMMIT');

    // Fetch the updated llm to return it
    const updatedResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [llmId]);

    res.json(updatedResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.put('/api/llms/:id/deactivate', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
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

    // Call the SQL function to deactivate the llm
    await client.query(`SELECT f_deactivate_llm($1)`, [llmId]);

    const noActiveLlmsRemain = (await countActiveLlms(client)) === 0;

    // Commit transaction
    await client.query('COMMIT');

    // Fetch the updated llm to return it
    const updatedResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [llmId]);

    res.json({ ...updatedResult.rows[0], no_active_llms_remain: noActiveLlmsRemain });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.post('/api/llms/:id/activate', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
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

    if (!(await llmHasUsableActiveApiKey(client, llmId))) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.LLM_ACTIVATE_REQUIRES_API);
    }

    // Call the SQL function to activate the llm
    await client.query(`SELECT f_activate_llm($1)`, [llmId]);

    // Commit transaction
    await client.query('COMMIT');

    // Fetch the updated llm to return it
    const updatedResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [llmId]);

    res.json(updatedResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modelsRouter.post('/api/llms/:id/deactivate', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
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

    // Call the SQL function to deactivate the llm
    await client.query(`SELECT f_deactivate_llm($1)`, [llmId]);

    const noActiveLlmsRemain = (await countActiveLlms(client)) === 0;

    // Commit transaction
    await client.query('COMMIT');

    // Fetch the updated llm to return it
    const updatedResult = await client.query(`${MODEL_SELECT} WHERE llm_id = $1`, [llmId]);

    res.json({ ...updatedResult.rows[0], no_active_llms_remain: noActiveLlmsRemain });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});
