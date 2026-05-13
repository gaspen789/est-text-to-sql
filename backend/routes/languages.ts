import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const languagesRouter = Router();

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

languagesRouter.get('/api/keeled', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT language_code, language_name FROM language_active ORDER BY language_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

languagesRouter.get('/api/llm-supported-language-all', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT llm_id, llm_name, is_active_llm, language_code, language_name FROM llm_supported_language_detailed ORDER BY llm_name, language_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

languagesRouter.get('/api/llm-supported-language/:id', async (req: Request, res: Response) => {
  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
    }

    const result = await db.query(
      'SELECT llm_id, llm_name, is_active_llm, language_code, language_name FROM llm_supported_language_detailed WHERE llm_id = $1',
      [llmId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

languagesRouter.post('/api/llm-supported-language', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const { language_code, llm_id } = req.body;

    // Validate required fields
    if (!language_code || !llm_id) {
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

    // Call the SQL function to add the language
    const result = await client.query(`SELECT f_add_llm_supported_language($1, $2) as success`, [
      language_code,
      llm_id,
    ]);

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json({ message: 'Language added successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

languagesRouter.delete('/api/llm-supported-language', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmId = parseInt(req.query.llm_id as string);
    const languageCode = req.query.language_code as string;

    if (isNaN(llmId) || !languageCode) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_OR_LANGUAGE_CODE);
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

    const result = await client.query('SELECT f_remove_llm_supported_language($1, $2) as success', [
      llmId,
      languageCode,
    ]);

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_LANGUAGE);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(200).json({ message: 'Language deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});
