import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const modalitiesRouter = Router();

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

modalitiesRouter.get('/api/modalities', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT modality_code, modality_name FROM modality_active ORDER BY modality_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modalitiesRouter.get('/api/llm-modality-all', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT sm.llm_supported_modality_id, lm.llm_id, lm.model_name AS llm_name, lm.is_active AS is_active_llm, sm.modality_code, m.name AS modality_name, sm.is_input FROM llm lm LEFT JOIN llm_supported_modality sm USING(llm_id) LEFT JOIN modality m USING(modality_code) WHERE sm.llm_supported_modality_id IS NOT NULL ORDER BY lm.model_name, sm.llm_supported_modality_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modalitiesRouter.get('/api/llm-modality/:id', async (req: Request, res: Response) => {
  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
    }

    const result = await db.query(
      `SELECT sm.llm_supported_modality_id, lm.llm_id, lm.model_name AS llm_name, lm.is_active AS is_active_llm, sm.modality_code, m.name AS modality_name, sm.is_input FROM llm lm LEFT JOIN llm_supported_modality sm USING(llm_id) LEFT JOIN modality m USING(modality_code) WHERE lm.llm_id = $1`,
      [llmId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

modalitiesRouter.post('/api/llm-supported-modalities', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const { llm_id, modality_code, is_input } = req.body;

    // Validate required fields
    if (!llm_id || !modality_code || is_input === undefined) {
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

    // Call the SQL function to add the modality
    const result = await client.query(
      `SELECT f_add_llm_supported_modality($1, $2, $3) as success`,
      [llm_id, modality_code, is_input]
    );

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json({ message: 'Modality added successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

modalitiesRouter.delete(
  '/api/llm-supported-modalities/:id',
  async (req: Request, res: Response) => {
    const client = await db.connect();

    try {
      const llmModalityId = parseInt(paramString(req.params.id), 10);

      if (isNaN(llmModalityId)) {
        return sendApiError(res, 400, ErrorCodes.INVALID_LLM_MODALITY_ID);
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

      // Call the SQL function to delete the modality
      const result = await client.query('SELECT f_remove_llm_supported_modality($1) as success', [
        llmModalityId,
      ]);

      if (result.rows.length === 0 || !result.rows[0].success) {
        await client.query('ROLLBACK');
        return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_MODALITY);
      }

      // Commit transaction
      await client.query('COMMIT');

      res.status(200).json({ message: 'Modality deleted successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    } finally {
      client.release();
    }
  }
);
