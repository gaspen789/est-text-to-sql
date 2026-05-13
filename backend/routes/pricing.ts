import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const pricingRouter = Router();

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

const PRICE_SELECT =
  'SELECT llm_id, llm_price_id, llm_name, is_active_llm, llm_price_per_unit, llm_unit_size, llm_min_unit_size, llm_max_unit_size, currency, modality_name, is_input, is_batch, price_valid_from, price_valid_until FROM llm_price_detailed';

/** After a DB type change, `llm_price_per_unit` may arrive as string (numeric), number (float), etc. */
function normalizePriceRow<T extends Record<string, unknown>>(row: T): T {
  const raw = row.llm_price_per_unit;
  if (raw == null) return row;
  if (typeof raw === 'number' && Number.isFinite(raw)) return row;
  if (typeof raw === 'string') {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return { ...row, llm_price_per_unit: n };
  }
  if (typeof raw === 'bigint') {
    return { ...row, llm_price_per_unit: Number(raw) };
  }
  return row;
}

function normalizePriceRows(rows: Record<string, unknown>[]) {
  return rows.map((r) => normalizePriceRow(r));
}

/** Accept number or string from JSON for inserts/updates. */
function parseBodyPricePerUnit(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hasOwn(obj: unknown, key: string): boolean {
  return !!obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function parseBodyIntOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    return n;
  }
  return null;
}

const DEFAULT_MAX_UNIT_SIZE = Number.MAX_SAFE_INTEGER;

pricingRouter.get('/api/valuutad', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT currency_code, currency_name FROM currency_active ORDER BY currency_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

pricingRouter.get('/api/unit-types', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT unit_type_code, name AS unit_type_name FROM unit_type WHERE is_active = TRUE ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

pricingRouter.get('/api/llm-price-all', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `${PRICE_SELECT} WHERE llm_price_id IS NOT NULL ORDER BY llm_name, llm_price_id`
    );
    res.json(normalizePriceRows(result.rows));
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

pricingRouter.get('/api/llm-price/:id', async (req: Request, res: Response) => {
  try {
    const llmId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
    }

    const result = await db.query(`${PRICE_SELECT} WHERE llm_id = $1`, [llmId]);
    res.json(normalizePriceRows(result.rows));
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

pricingRouter.post('/api/llm-price', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const {
      llm_id,
      llm_supported_modality_id,
      currency_code,
      unit_type_code,
      price_per_unit: rawPrice,
      unit_size,
      min_unit_size,
      max_unit_size,
      is_batch,
      valid_from_time,
      valid_until_time,
    } = req.body;

    const price_per_unit = parseBodyPricePerUnit(rawPrice);

    // Treat "range mode" as "some actual min/max value was provided".
    // The frontend may include `min_unit_size: null` / `max_unit_size: null` in fixed-size mode;
    // we must not interpret that as a range request.
    const wantsUnitRange =
      (min_unit_size != null && String(min_unit_size).trim() !== '') ||
      (max_unit_size != null && String(max_unit_size).trim() !== '');
    const parsedMinUnitSize = parseBodyIntOrNull(min_unit_size);
    const parsedMaxUnitSize = parseBodyIntOrNull(max_unit_size);

    if (wantsUnitRange && parsedMinUnitSize == null) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const normalizedMinUnitSize = wantsUnitRange ? parsedMinUnitSize : null;
    const normalizedMaxUnitSize =
      wantsUnitRange && parsedMaxUnitSize == null ? DEFAULT_MAX_UNIT_SIZE : wantsUnitRange ? parsedMaxUnitSize : null;

    if (
      wantsUnitRange &&
      normalizedMinUnitSize != null &&
      normalizedMaxUnitSize != null &&
      normalizedMaxUnitSize < normalizedMinUnitSize
    ) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    // Validate required fields
    if (!llm_id || !llm_supported_modality_id || !currency_code || price_per_unit == null) {
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

    const hasFromTime = valid_from_time && valid_from_time.toString().trim() !== '';
    const hasUntilTime = valid_until_time && valid_until_time.toString().trim() !== '';

    // Application-level duplicate guard (the DB unique constraint was removed).
    // We treat missing validity times as the same defaults that the insert functions rely on:
    // - valid_from_time defaults to transaction timestamp (rounded to seconds)
    // - valid_until_time defaults to infinity
    const normalizedFromTime = hasFromTime
      ? valid_from_time
      : await client
          .query(`SELECT date_trunc('second', transaction_timestamp())::timestamptz AS ts`)
          .then((r) => r.rows[0]?.ts);
    const normalizedUntilTime = hasUntilTime ? valid_until_time : 'infinity';

    const dupCheck = await client.query(
      `
      SELECT lp.llm_price_id
      FROM public.llm_price lp
      INNER JOIN public.llm_price_modality lpm ON lpm.llm_price_id = lp.llm_price_id
      WHERE lp.llm_id = $1
        AND lpm.llm_supported_modality_id = $2
        AND lp.currency_code = $3
        AND lp.unit_type_code = $4
        AND lp.price_per_unit = $5
        AND lp.unit_size IS NOT DISTINCT FROM $6
        AND lp.min_unit_size IS NOT DISTINCT FROM $7
        AND lp.max_unit_size IS NOT DISTINCT FROM $8
        AND lp.is_batch = $9
        AND lp.valid_from_time = date_trunc('second', $10::timestamptz)
        AND lp.valid_until_time = date_trunc('second', $11::timestamptz)
      LIMIT 1
      `,
      [
        llm_id,
        llm_supported_modality_id,
        currency_code || 'USD',
        unit_type_code || 'TOK',
        price_per_unit,
        unit_size || null,
        normalizedMinUnitSize,
        normalizedMaxUnitSize,
        is_batch !== undefined ? is_batch : false,
        normalizedFromTime,
        normalizedUntilTime,
      ]
    );

    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.LLM_PRICE_DUPLICATE, {
        llm_price_id: dupCheck.rows[0].llm_price_id,
      });
    }

    let result;

    if (hasFromTime && hasUntilTime) {
      result = await client.query(
        `SELECT f_add_llm_price_time_exists($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as llm_price_id`,
        [
          llm_id,
          llm_supported_modality_id,
          currency_code || 'USD',
          unit_type_code || 'TOK',
          price_per_unit,
          unit_size || null,
          normalizedMinUnitSize,
          normalizedMaxUnitSize,
          is_batch !== undefined ? is_batch : false,
          valid_from_time,
          valid_until_time,
        ]
      );
    } else if (!hasFromTime && !hasUntilTime) {
      result = await client.query(
        `SELECT f_add_llm_price_time_missing($1, $2, $3, $4, $5, $6, $7, $8, $9) as llm_price_id`,
        [
          llm_id,
          llm_supported_modality_id,
          currency_code || 'USD',
          unit_type_code || 'TOK',
          price_per_unit,
          unit_size || null,
          normalizedMinUnitSize,
          normalizedMaxUnitSize,
          is_batch !== undefined ? is_batch : false,
        ]
      );
    } else if (hasFromTime && !hasUntilTime) {
      result = await client.query(
        `SELECT f_add_llm_price_start_time_exists($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as llm_price_id`,
        [
          llm_id,
          llm_supported_modality_id,
          currency_code || 'USD',
          unit_type_code || 'TOK',
          price_per_unit,
          unit_size || null,
          normalizedMinUnitSize,
          normalizedMaxUnitSize,
          is_batch !== undefined ? is_batch : false,
          valid_from_time,
        ]
      );
    } else {
      result = await client.query(
        `SELECT f_add_llm_price_end_time_exists($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as llm_price_id`,
        [
          llm_id,
          llm_supported_modality_id,
          currency_code || 'USD',
          unit_type_code || 'TOK',
          price_per_unit,
          unit_size || null,
          normalizedMinUnitSize,
          normalizedMaxUnitSize,
          is_batch !== undefined ? is_batch : false,
          valid_until_time,
        ]
      );
    }

    if (result.rows.length === 0 || !result.rows[0].llm_price_id) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    }

    const newPriceId = result.rows[0].llm_price_id;

    // Fetch the created price entry to return it
    const createdResult = await client.query(`${PRICE_SELECT} WHERE llm_price_id = $1`, [
      newPriceId,
    ]);

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json(normalizePriceRow(createdResult.rows[0] as Record<string, unknown>));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

pricingRouter.put('/api/llm-price/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmPriceId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmPriceId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_PRICE_ID);
    }

    const {
      llm_id,
      llm_supported_modality_id,
      currency_code,
      unit_type_code,
      price_per_unit: rawPrice,
      unit_size,
      min_unit_size,
      max_unit_size,
      is_batch,
      valid_from_time,
      valid_until_time,
    } = req.body;

    const price_per_unit = parseBodyPricePerUnit(rawPrice);

    // Treat "range mode" as "some actual min/max value was provided".
    // The frontend may include `min_unit_size: null` / `max_unit_size: null` in fixed-size mode;
    // we must not interpret that as a range request.
    const wantsUnitRange =
      (min_unit_size != null && String(min_unit_size).trim() !== '') ||
      (max_unit_size != null && String(max_unit_size).trim() !== '');
    const parsedMinUnitSize = parseBodyIntOrNull(min_unit_size);
    const parsedMaxUnitSize = parseBodyIntOrNull(max_unit_size);

    if (wantsUnitRange && parsedMinUnitSize == null) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const normalizedMinUnitSize = wantsUnitRange ? parsedMinUnitSize : null;
    const normalizedMaxUnitSize =
      wantsUnitRange && parsedMaxUnitSize == null ? DEFAULT_MAX_UNIT_SIZE : wantsUnitRange ? parsedMaxUnitSize : null;

    if (
      wantsUnitRange &&
      normalizedMinUnitSize != null &&
      normalizedMaxUnitSize != null &&
      normalizedMaxUnitSize < normalizedMinUnitSize
    ) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    // Validate required fields
    if (!llm_id || !llm_supported_modality_id || !currency_code || price_per_unit == null) {
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

    // Duplicate guard on update as well (exclude the row being updated).
    const hasFromTime = valid_from_time && valid_from_time.toString().trim() !== '';
    const hasUntilTime = valid_until_time && valid_until_time.toString().trim() !== '';
    const normalizedFromTime = hasFromTime
      ? valid_from_time
      : await client
          .query(`SELECT date_trunc('second', transaction_timestamp())::timestamptz AS ts`)
          .then((r) => r.rows[0]?.ts);
    const normalizedUntilTime = hasUntilTime ? valid_until_time : 'infinity';

    const dupCheck = await client.query(
      `
      SELECT lp.llm_price_id
      FROM public.llm_price lp
      INNER JOIN public.llm_price_modality lpm ON lpm.llm_price_id = lp.llm_price_id
      WHERE lp.llm_price_id <> $1
        AND lp.llm_id = $2
        AND lpm.llm_supported_modality_id = $3
        AND lp.currency_code = $4
        AND lp.unit_type_code = $5
        AND lp.price_per_unit = $6
        AND lp.unit_size IS NOT DISTINCT FROM $7
        AND lp.min_unit_size IS NOT DISTINCT FROM $8
        AND lp.max_unit_size IS NOT DISTINCT FROM $9
        AND lp.is_batch = $10
        AND lp.valid_from_time = date_trunc('second', $11::timestamptz)
        AND lp.valid_until_time = date_trunc('second', $12::timestamptz)
      LIMIT 1
      `,
      [
        llmPriceId,
        llm_id,
        llm_supported_modality_id,
        currency_code || 'USD',
        unit_type_code || 'TOK',
        price_per_unit,
        unit_size || null,
        normalizedMinUnitSize,
        normalizedMaxUnitSize,
        is_batch !== undefined ? is_batch : false,
        normalizedFromTime,
        normalizedUntilTime,
      ]
    );

    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 409, ErrorCodes.LLM_PRICE_DUPLICATE, {
        llm_price_id: dupCheck.rows[0].llm_price_id,
      });
    }

    const result = await client.query(
      `SELECT f_update_llm_price($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as success`,
      [
        llmPriceId,
        llm_id,
        llm_supported_modality_id,
        currency_code || 'USD',
        unit_type_code || 'TOK',
        price_per_unit,
        unit_size || null,
        normalizedMinUnitSize,
        normalizedMaxUnitSize,
        is_batch !== undefined ? is_batch : false,
        valid_from_time || null,
        valid_until_time || null,
      ]
    );

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_PRICE);
    }

    // Fetch the updated price entry to return it
    const updatedResult = await client.query(`${PRICE_SELECT} WHERE llm_price_id = $1`, [
      llmPriceId,
    ]);

    // Commit transaction
    await client.query('COMMIT');

    res.status(200).json(normalizePriceRow(updatedResult.rows[0] as Record<string, unknown>));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

pricingRouter.delete('/api/llm-price/:id', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const llmPriceId = parseInt(paramString(req.params.id), 10);

    if (isNaN(llmPriceId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_LLM_PRICE_ID);
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

    // Call the SQL function to delete the price
    const result = await client.query('SELECT f_remove_llm_price($1) as success', [llmPriceId]);

    if (result.rows.length === 0 || !result.rows[0].success) {
      await client.query('ROLLBACK');
      return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED_PRICE);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(200).json({ success: true, message: 'Price deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});
