import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const classifiersRouter = Router();

function getUserIdFromHeader(req: Request): number | null {
  const userId = req.headers['x-user-id'];
  if (
    !userId ||
    typeof userId !== 'string' ||
    !Number.isInteger(Number(userId)) ||
    Number(userId) <= 0
  ) {
    return null;
  }
  return Number(userId);
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

function paramCode(req: Request): string {
  const raw = req.params.code;
  return typeof raw === 'string' ? raw.trim() : '';
}

function normalizeDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t === '' ? null : t;
}

function bodyName(body: any): string {
  if (typeof body?.name === 'string') return body.name.trim();
  return '';
}

function bodyCode(body: any): string {
  const raw = typeof body?.code === 'string' ? body.code : '';
  return raw.trim().toUpperCase();
}

function optionalBodyCode(body: any): string | null {
  if (typeof body?.code !== 'string') return null;
  const t = body.code.trim().toUpperCase();
  return t === '' ? null : t;
}

function paramPositiveIntParam(req: Request, paramName: string): number | null {
  const raw = req.params[paramName];
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** --- Languages (3-letter code) --- */

classifiersRouter.get('/api/admin/classifiers/languages', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT language_code, name AS language_name, description, is_active
       FROM language
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/languages', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw =
      typeof body.language_code === 'string'
        ? body.language_code.trim().toUpperCase()
        : bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{3}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO language (language_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING language_code, name AS language_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/languages/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{3}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE language
       SET language_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE language_code = $5::char(3)
       RETURNING language_code, name AS language_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/languages/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req);
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM language WHERE language_code = $1::char(3) RETURNING language_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/languages/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req);
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE language SET is_active = TRUE WHERE language_code = $1::char(3) RETURNING language_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/languages/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req);
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE language SET is_active = FALSE WHERE language_code = $1::char(3) RETURNING language_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- User roles (3-letter code) --- */

classifiersRouter.get('/api/admin/classifiers/roles', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT user_role_code, name AS user_role_name, description, is_active
       FROM user_role
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/roles', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw =
      typeof body.user_role_code === 'string' ? body.user_role_code.trim().toUpperCase() : bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{3}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO user_role (user_role_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING user_role_code, name AS user_role_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/roles/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{3}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE user_role
       SET user_role_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE user_role_code = $5::char(3)
       RETURNING user_role_code, name AS user_role_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/roles/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM user_role WHERE user_role_code = $1::char(3) RETURNING user_role_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/roles/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE user_role SET is_active = TRUE WHERE user_role_code = $1::char(3) RETURNING user_role_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/roles/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE user_role SET is_active = FALSE WHERE user_role_code = $1::char(3) RETURNING user_role_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- User groups (5-letter code) --- */

classifiersRouter.get('/api/admin/classifiers/groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT user_group_code, name AS user_group_name, description, is_active
       FROM user_group
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw =
      typeof body.user_group_code === 'string'
        ? body.user_group_code.trim().toUpperCase()
        : bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{5}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO user_group (user_group_code, name, description, is_active)
       VALUES ($1::char(5), $2, $3, $4)
       RETURNING user_group_code, name AS user_group_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/groups/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{5}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE user_group
       SET user_group_code = $1::char(5),
           name = $2,
           description = $3,
           is_active = $4
       WHERE user_group_code = $5::char(5)
       RETURNING user_group_code, name AS user_group_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/groups/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    // Special-case: allow deleting the ADMIN group by cleaning up dependent rows first.
    if (code === 'ADMIN') {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM access_right WHERE user_group_code = $1::char(5)`, [code]);
        await client.query(`DELETE FROM app_user_group_member WHERE user_group_code = $1::char(5)`, [code]);
        const del = await client.query(
          `DELETE FROM user_group WHERE user_group_code = $1::char(5) RETURNING user_group_code`,
          [code]
        );
        if (del.rows.length === 0) {
          await client.query('ROLLBACK');
          return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
        }
        await client.query('COMMIT');
        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return;
    }

    const del = await db.query(
      `DELETE FROM user_group WHERE user_group_code = $1::char(5) RETURNING user_group_code`,
      [code]
    );
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/groups/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE user_group SET is_active = TRUE WHERE user_group_code = $1::char(5) RETURNING user_group_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/groups/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);
    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE user_group SET is_active = FALSE WHERE user_group_code = $1::char(5) RETURNING user_group_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- LLM-related classifiers --- */

classifiersRouter.get('/api/admin/classifiers/countries', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT country_code, name AS country_name, description, is_active
       FROM country
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/countries', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{3}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO country (country_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING country_code, name AS country_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/countries/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{3}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE country
       SET country_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE country_code = $5::char(3)
       RETURNING country_code, name AS country_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/countries/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM country WHERE country_code = $1::char(3) RETURNING country_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/countries/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE country SET is_active = TRUE WHERE country_code = $1::char(3) RETURNING country_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/countries/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE country SET is_active = FALSE WHERE country_code = $1::char(3) RETURNING country_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/companies', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT c.company_code, c.name AS company_name, c.description, c.is_active, c.country_code, co.name AS country_name
       FROM company c
       LEFT JOIN country co USING(country_code)
       ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/companies', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = bodyCode(body);
    const name = bodyName(body);
    const countryCode =
      typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase() : '';
    if (!codeRaw || !name || !countryCode)
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO company (company_code, country_code, name, description, is_active)
       VALUES ($1::char(10), $2::char(3), $3, $4, $5)
       RETURNING company_code, name AS company_name, description, is_active, country_code`,
      [codeRaw, countryCode, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/companies/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req);
    if (!code) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = bodyName(body);
    const countryCode =
      typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase() : '';
    if (!name || !countryCode) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!nextCode) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE company
       SET company_code = $1::char(10),
           country_code = $2::char(3),
           name = $3,
           description = $4,
           is_active = $5
       WHERE company_code = $6::char(10)
       RETURNING company_code, name AS company_name, description, is_active, country_code`,
      [nextCode, countryCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/companies/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req);
    if (!code) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM company WHERE company_code = $1::char(10) RETURNING company_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/companies/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE company SET is_active = TRUE WHERE company_code = $1::char(10) RETURNING company_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/companies/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE company SET is_active = FALSE WHERE company_code = $1::char(10) RETURNING company_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/llm-groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT g.llm_group_id, g.name AS llm_group_name, g.description, g.is_active, g.company_code, c.name AS company_name
       FROM llm_group g
       LEFT JOIN company c USING(company_code)
       ORDER BY g.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/llm-groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const name = bodyName(body);
    const companyCode =
      typeof body.company_code === 'string' ? body.company_code.trim().toUpperCase() : '';
    if (!name || !companyCode) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO llm_group (company_code, name, description, is_active)
       VALUES ($1::char(10), $2, $3, $4)
       RETURNING llm_group_id, name AS llm_group_name, description, is_active, company_code`,
      [companyCode, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/llm-groups/:id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = bodyName(body);
    const companyCode =
      typeof body.company_code === 'string' ? body.company_code.trim().toUpperCase() : '';
    if (!name || !companyCode) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE llm_group
       SET company_code = $1::char(10), name = $2, description = $3, is_active = $4
       WHERE llm_group_id = $5
       RETURNING llm_group_id, name AS llm_group_name, description, is_active, company_code`,
      [companyCode, name, desc, isActive, id]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/llm-groups/:id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM llm_group WHERE llm_group_id = $1 RETURNING llm_group_id`, [id]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/llm-groups/:id/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE llm_group SET is_active = TRUE WHERE llm_group_id = $1 RETURNING llm_group_id`, [id]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/llm-groups/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(`UPDATE llm_group SET is_active = FALSE WHERE llm_group_id = $1 RETURNING llm_group_id`, [id]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

    const usedBy = await db.query(
      `SELECT llm_id, model_name AS llm_name, is_active AS is_active_llm
       FROM llm
       WHERE llm_group_id = $1
       ORDER BY model_name`,
      [id]
    );

    res.json({
      success: true,
      usage:
        usedBy.rows.length > 0
          ? {
              entity: 'llm_group',
              llm_group_id: id,
              llms: usedBy.rows,
            }
          : null,
    });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/modalities', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT modality_code, name AS modality_name, description, is_active
       FROM modality
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/modalities', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{1}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO modality (modality_code, name, description, is_active)
       VALUES ($1::char(1), $2, $3, $4)
       RETURNING modality_code, name AS modality_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/modalities/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{1}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{1}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE modality
       SET modality_code = $1::char(1),
           name = $2,
           description = $3,
           is_active = $4
       WHERE modality_code = $5::char(1)
       RETURNING modality_code, name AS modality_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/modalities/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{1}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM modality WHERE modality_code = $1::char(1) RETURNING modality_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/modalities/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{1}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE modality SET is_active = TRUE WHERE modality_code = $1::char(1) RETURNING modality_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/modalities/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{1}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE modality SET is_active = FALSE WHERE modality_code = $1::char(1) RETURNING modality_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/currencies', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT currency_code, name AS currency_name, description, is_active
       FROM currency
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/currencies', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{3}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO currency (currency_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING currency_code, name AS currency_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/currencies/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{3}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE currency
       SET currency_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE currency_code = $5::char(3)
       RETURNING currency_code, name AS currency_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/currencies/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM currency WHERE currency_code = $1::char(3) RETURNING currency_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/currencies/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE currency SET is_active = TRUE WHERE currency_code = $1::char(3) RETURNING currency_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/currencies/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE currency SET is_active = FALSE WHERE currency_code = $1::char(3) RETURNING currency_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/unit-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT unit_type_code, name AS unit_type_name, description, is_active
       FROM unit_type
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/unit-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = bodyCode(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z]{3}$/.test(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO unit_type (unit_type_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING unit_type_code, name AS unit_type_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/unit-types/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!/^[A-Z]{3}$/.test(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE unit_type
       SET unit_type_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE unit_type_code = $5::char(3)
       RETURNING unit_type_code, name AS unit_type_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/unit-types/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(`DELETE FROM unit_type WHERE unit_type_code = $1::char(3) RETURNING unit_type_code`, [code]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/unit-types/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE unit_type SET is_active = TRUE WHERE unit_type_code = $1::char(3) RETURNING unit_type_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/unit-types/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(`UPDATE unit_type SET is_active = FALSE WHERE unit_type_code = $1::char(3) RETURNING unit_type_code`, [code]);
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- Table types (relation kind: base table, view, materialized view, …) --- */

classifiersRouter.get('/api/admin/classifiers/table-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT table_type_id, name, description, is_active
       FROM table_type
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/table-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const dup = await db.query(
      `SELECT 1 FROM table_type WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
      [name]
    );
    if (dup.rows.length > 0) return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);

    const ins = await db.query(
      `INSERT INTO table_type (name, description, is_active)
       VALUES ($1, $2, $3)
       RETURNING table_type_id, name, description, is_active`,
      [name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/table-types/:id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableTypeId = paramPositiveIntParam(req, 'id');
    if (!tableTypeId) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const dup = await db.query(
      `SELECT 1 FROM table_type
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND table_type_id <> $2
       LIMIT 1`,
      [name, tableTypeId]
    );
    if (dup.rows.length > 0) return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);

    const upd = await db.query(
      `UPDATE table_type
       SET name = $1, description = $2, is_active = $3
       WHERE table_type_id = $4
       RETURNING table_type_id, name, description, is_active`,
      [name, desc, isActive, tableTypeId]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/table-types/:id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableTypeId = paramPositiveIntParam(req, 'id');
    if (!tableTypeId) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const del = await db.query(`DELETE FROM table_type WHERE table_type_id = $1 RETURNING table_type_id`, [
      tableTypeId,
    ]);
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/table-types/:id/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableTypeId = paramPositiveIntParam(req, 'id');
    if (!tableTypeId) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const upd = await db.query(
      `UPDATE table_type SET is_active = TRUE WHERE table_type_id = $1 RETURNING table_type_id`,
      [tableTypeId]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/table-types/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const tableTypeId = paramPositiveIntParam(req, 'id');
    if (!tableTypeId) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const upd = await db.query(
      `UPDATE table_type SET is_active = FALSE WHERE table_type_id = $1 RETURNING table_type_id`,
      [tableTypeId]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- Result types (up to 10 chars, may include spaces) --- */

function resultTypeCodeFromBody(body: any): string {
  const raw = typeof body?.result_type_code === 'string' ? body.result_type_code : bodyCode(body);
  return String(raw ?? '').trim().toUpperCase();
}

function isValidResultTypeCode(code: string): boolean {
  return /^(?=.*[A-Z0-9])[A-Z0-9 ]{1,10}$/.test(code);
}

classifiersRouter.get('/api/admin/classifiers/result-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT result_type_code, name AS result_type_name, description, is_active
       FROM result_type
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/result-types', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const codeRaw = resultTypeCodeFromBody(body);
    const name = bodyName(body);
    if (!codeRaw || !name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!isValidResultTypeCode(codeRaw)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    if (name.length > 30) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const ins = await db.query(
      `INSERT INTO result_type (result_type_code, name, description, is_active)
       VALUES ($1::char(10), $2, $3, $4)
       RETURNING result_type_code, name AS result_type_name, description, is_active`,
      [codeRaw, name, desc, isActive]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/result-types/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!isValidResultTypeCode(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const name = bodyName(body);
    if (!name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (name.length > 30) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    const nextCode = optionalBodyCode(body) ?? code;
    if (!isValidResultTypeCode(nextCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const desc = normalizeDescription(body.description);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    const upd = await db.query(
      `UPDATE result_type
       SET result_type_code = $1::char(10),
           name = $2,
           description = $3,
           is_active = $4
       WHERE result_type_code = $5::char(10)
       RETURNING result_type_code, name AS result_type_name, description, is_active`,
      [nextCode, name, desc, isActive, code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err) {
    console.error(err);
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete('/api/admin/classifiers/result-types/:code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!isValidResultTypeCode(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const del = await db.query(
      `DELETE FROM result_type WHERE result_type_code = $1::char(10) RETURNING result_type_code`,
      [code]
    );
    if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/result-types/:code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!isValidResultTypeCode(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(
      `UPDATE result_type SET is_active = TRUE WHERE result_type_code = $1::char(10) RETURNING result_type_code`,
      [code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/result-types/:code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const code = paramCode(req).toUpperCase();
    if (!isValidResultTypeCode(code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const upd = await db.query(
      `UPDATE result_type SET is_active = FALSE WHERE result_type_code = $1::char(10) RETURNING result_type_code`,
      [code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/** --- DBMS + DBMS_version (combined editor) --- */

function dbmsCodeFromBody(body: any): string {
  const raw = typeof body?.dbms_code === 'string' ? body.dbms_code : '';
  return raw.trim().toUpperCase();
}

function dbmsNameFromBody(body: any): string {
  const raw = typeof body?.dbms_name === 'string' ? body.dbms_name : '';
  return raw.trim();
}

function dbmsVersionFromBody(body: any): string {
  const raw = typeof body?.version === 'string' ? body.version : '';
  return raw.trim();
}

classifiersRouter.get('/api/admin/classifiers/dbms', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT dbms_code, name AS dbms_name, description AS dbms_description, is_active AS dbms_is_active
       FROM dbms
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/dbms', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const dbms_code = dbmsCodeFromBody(body);
    const dbms_name = dbmsNameFromBody(body);
    const dbms_description = normalizeDescription(body.dbms_description);
    const dbms_is_active = body.dbms_is_active === undefined ? true : Boolean(body.dbms_is_active);

    if (!dbms_code || !dbms_name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const ins = await db.query(
      `INSERT INTO dbms (dbms_code, name, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING dbms_code, name AS dbms_name, description AS dbms_description, is_active AS dbms_is_active`,
      [dbms_code, dbms_name, dbms_description, dbms_is_active]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put('/api/admin/classifiers/dbms/:dbms_code', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
    const dbms_code = rawDbmsCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const body = req.body ?? {};
    const nextDbmsCode = dbmsCodeFromBody(body) || dbms_code;
    if (!/^[A-Z0-9]{3}$/.test(nextDbmsCode)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const dbms_name = dbmsNameFromBody(body);
    const dbms_description = normalizeDescription(body.dbms_description);
    const dbms_is_active = body.dbms_is_active === undefined ? true : Boolean(body.dbms_is_active);
    if (!dbms_name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const upd = await db.query(
      `UPDATE dbms
       SET dbms_code = $1::char(3),
           name = $2,
           description = $3,
           is_active = $4
       WHERE dbms_code = $5::char(3)
       RETURNING dbms_code, name AS dbms_name, description AS dbms_description, is_active AS dbms_is_active`,
      [nextDbmsCode, dbms_name, dbms_description, dbms_is_active, dbms_code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json(upd.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/dbms-versions', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT
         d.dbms_code,
         d.name AS dbms_name,
         d.description AS dbms_description,
         d.is_active AS dbms_is_active,
         v.dbms_version_id,
         v.version,
         v.description AS dbms_version_description,
         v.is_active AS dbms_version_is_active
       FROM dbms d
       JOIN dbms_version v ON v.dbms_code = d.dbms_code
       ORDER BY d.name, v.version`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.get('/api/admin/classifiers/dbms-versions/active', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT
         d.dbms_code,
         d.name AS dbms_name,
         d.description AS dbms_description,
         d.is_active AS dbms_is_active,
         v.dbms_version_id,
         v.version,
         v.description AS dbms_version_description,
         v.is_active AS dbms_version_is_active
       FROM dbms d
       JOIN dbms_version v ON v.dbms_code = d.dbms_code
       WHERE d.is_active = TRUE
         AND v.is_active = TRUE
       ORDER BY d.name, v.version`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/dbms-versions', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const dbms_code = dbmsCodeFromBody(body);
    const dbms_name = dbmsNameFromBody(body);
    const version = dbmsVersionFromBody(body);

    const dbms_description = normalizeDescription(body.dbms_description);
    const dbms_is_active = body.dbms_is_active === undefined ? true : Boolean(body.dbms_is_active);

    const dbms_version_description = normalizeDescription(body.dbms_version_description);
    const dbms_version_is_active =
      body.dbms_version_is_active === undefined ? true : Boolean(body.dbms_version_is_active);

    if (!dbms_code || !version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    if (version.length > 50) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/[0-9A-Za-z]/.test(version)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    if (dbms_name) {
      // Backwards-compatible: combined editor can still update DBMS fields.
      await db.query(
        `INSERT INTO dbms (dbms_code, name, description, is_active)
         VALUES ($1::char(3), $2, $3, $4)
         ON CONFLICT (dbms_code) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             is_active = EXCLUDED.is_active`,
        [dbms_code, dbms_name, dbms_description, dbms_is_active]
      );
    } else {
      // New separated flow: DBMS must already exist when adding a version.
      const exists = await db.query(`SELECT 1 FROM dbms WHERE dbms_code = $1::char(3) LIMIT 1`, [dbms_code]);
      if (exists.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    }

    const ins = await db.query(
      `INSERT INTO dbms_version (dbms_code, version, description, is_active)
       VALUES ($1::char(3), $2, $3, $4)
       RETURNING dbms_version_id, version, description, is_active`,
      [dbms_code, version, dbms_version_description, dbms_version_is_active]
    );

    const result = await db.query(
      `SELECT
         d.dbms_code,
         d.name AS dbms_name,
         d.description AS dbms_description,
         d.is_active AS dbms_is_active,
         v.dbms_version_id,
         v.version,
         v.description AS dbms_version_description,
         v.is_active AS dbms_version_is_active
       FROM dbms d
       JOIN dbms_version v ON v.dbms_code = d.dbms_code
       WHERE d.dbms_code = $1::char(3) AND v.version = $2
       LIMIT 1`,
      [dbms_code, version]
    );

    res.status(201).json({ ...result.rows[0], ...ins.rows[0] });
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.put(
  '/api/admin/classifiers/dbms-versions/:dbms_code/:version',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      const version = typeof req.params.version === 'string' ? req.params.version.trim() : '';

      if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
      if (!version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
      if (!/[0-9A-Za-z]/.test(version)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

      const body = req.body ?? {};
      const dbms_name = dbmsNameFromBody(body);
      const dbms_description = normalizeDescription(body.dbms_description);
      const dbms_is_active = body.dbms_is_active === undefined ? true : Boolean(body.dbms_is_active);

      const dbms_version_description = normalizeDescription(body.dbms_version_description);
      const dbms_version_is_active =
        body.dbms_version_is_active === undefined ? true : Boolean(body.dbms_version_is_active);

      if (!dbms_name) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
      if (version.length > 50) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

      const updated = await db.query(
        `UPDATE dbms
         SET name = $1, description = $2, is_active = $3
         WHERE dbms_code = $4::char(3)
         RETURNING dbms_code`
        ,
        [dbms_name, dbms_description, dbms_is_active, dbms_code]
      );

      if (updated.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

      const updatedVersion = await db.query(
        `UPDATE dbms_version
         SET description = $1, is_active = $2
         WHERE dbms_code = $3::char(3) AND version = $4
         RETURNING dbms_version_id`,
        [dbms_version_description, dbms_version_is_active, dbms_code, version]
      );

      if (updatedVersion.rows.length === 0)
        return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

      const result = await db.query(
        `SELECT
           d.dbms_code,
           d.name AS dbms_name,
           d.description AS dbms_description,
           d.is_active AS dbms_is_active,
           v.dbms_version_id,
           v.version,
           v.description AS dbms_version_description,
           v.is_active AS dbms_version_is_active
         FROM dbms d
         JOIN dbms_version v ON v.dbms_code = d.dbms_code
         WHERE d.dbms_code = $1::char(3) AND v.version = $2
         LIMIT 1`,
        [dbms_code, version]
      );

      res.json(result.rows[0]);
    } catch (err: unknown) {
      console.error(err);
      const pgCode =
        typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
      if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

classifiersRouter.put('/api/admin/classifiers/dbms-versions/by-id/:dbms_version_id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const rawId = typeof req.params.dbms_version_id === 'string' ? req.params.dbms_version_id : '';
    const dbms_version_id = Number(rawId);
    if (!Number.isInteger(dbms_version_id) || dbms_version_id <= 0)
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    const body = req.body ?? {};
    const dbms_code = dbmsCodeFromBody(body);
    if (dbms_code && !/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
    const version = dbmsVersionFromBody(body);
    if (!version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (version.length > 50) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    if (!/[0-9A-Za-z]/.test(version)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const dbms_version_description = normalizeDescription(body.dbms_version_description);
    const dbms_version_is_active =
      body.dbms_version_is_active === undefined ? true : Boolean(body.dbms_version_is_active);

    const upd = await db.query(
      `UPDATE dbms_version
       SET dbms_code = COALESCE($1::char(3), dbms_code),
           version = $2,
           description = $3,
           is_active = $4
       WHERE dbms_version_id = $5
       RETURNING dbms_code, version`,
      [dbms_code || null, version, dbms_version_description, dbms_version_is_active, dbms_version_id]
    );

    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

    const { dbms_code: updatedDbmsCode } = upd.rows[0] as { dbms_code: string; version: string };
    const result = await db.query(
      `SELECT
         d.dbms_code,
         d.name AS dbms_name,
         d.description AS dbms_description,
         d.is_active AS dbms_is_active,
         v.dbms_version_id,
         v.version,
         v.description AS dbms_version_description,
         v.is_active AS dbms_version_is_active
       FROM dbms d
       JOIN dbms_version v ON v.dbms_code = d.dbms_code
       WHERE v.dbms_version_id = $1
       LIMIT 1`,
      [dbms_version_id]
    );

    res.json(result.rows[0]);
  } catch (err: unknown) {
    const pgCode =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (pgCode === '23505') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_DUPLICATE);
    if (pgCode === '23514') return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.delete(
  '/api/admin/classifiers/dbms-versions/:dbms_code/:version',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      const version = typeof req.params.version === 'string' ? req.params.version.trim() : '';

      if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
      if (!version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

      const del = await db.query(
        `DELETE FROM dbms_version
         WHERE dbms_code = $1::char(3) AND version = $2
         RETURNING dbms_version_id`,
        [dbms_code, version]
      );

      if (del.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
      res.json({ success: true });
    } catch (err: unknown) {
      const pgCode =
        typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
      if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

classifiersRouter.post(
  '/api/admin/classifiers/dbms-versions/:dbms_code/:version/activate',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      const version = typeof req.params.version === 'string' ? req.params.version.trim() : '';

      if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
      if (!version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

      const upd = await db.query(
        `UPDATE dbms_version
         SET is_active = TRUE
         WHERE dbms_code = $1::char(3) AND version = $2
         RETURNING dbms_version_id`,
        [dbms_code, version]
      );
      if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

classifiersRouter.post(
  '/api/admin/classifiers/dbms-versions/:dbms_code/:version/deactivate',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      const version = typeof req.params.version === 'string' ? req.params.version.trim() : '';

      if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);
      if (!version) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

      const upd = await db.query(
        `UPDATE dbms_version
         SET is_active = FALSE
         WHERE dbms_code = $1::char(3) AND version = $2
         RETURNING dbms_version_id`,
        [dbms_code, version]
      );
      if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

classifiersRouter.post('/api/admin/classifiers/dbms/:dbms_code/deactivate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
    const dbms_code = rawDbmsCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(
      `UPDATE dbms
       SET is_active = FALSE
       WHERE dbms_code = $1::char(3)
       RETURNING dbms_code`,
      [dbms_code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

    await db.query(`UPDATE dbms_version SET is_active = FALSE WHERE dbms_code = $1::char(3)`, [dbms_code]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

classifiersRouter.post('/api/admin/classifiers/dbms/:dbms_code/activate', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
    const dbms_code = rawDbmsCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

    const upd = await db.query(
      `UPDATE dbms
       SET is_active = TRUE
       WHERE dbms_code = $1::char(3)
       RETURNING dbms_code`,
      [dbms_code]
    );
    if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});
classifiersRouter.post(
  '/api/admin/classifiers/dbms-versions/:dbms_code/deactivate-dbms',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(dbms_code)) return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

      const upd = await db.query(
        `UPDATE dbms
         SET is_active = FALSE
         WHERE dbms_code = $1::char(3)
         RETURNING dbms_code`,
        [dbms_code]
      );

      if (upd.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);

      await db.query(`UPDATE dbms_version SET is_active = FALSE WHERE dbms_code = $1::char(3)`, [dbms_code]);
      res.json({ success: true });
    } catch (err: unknown) {
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

// Hard-delete a DBMS (and all its versions). Use with care.
classifiersRouter.delete(
  '/api/admin/classifiers/dbms/:dbms_code',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
      if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

      const rawDbmsCode = typeof req.params.dbms_code === 'string' ? req.params.dbms_code : '';
      const dbms_code = rawDbmsCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(dbms_code))
        return sendApiError(res, 400, ErrorCodes.CLASSIFIER_CODE_INVALID);

      await db.query('BEGIN');

      // Delete child versions first.
      await db.query(`DELETE FROM dbms_version WHERE dbms_code = $1::char(3)`, [dbms_code]);
      const del = await db.query(`DELETE FROM dbms WHERE dbms_code = $1::char(3) RETURNING dbms_code`, [
        dbms_code,
      ]);

      if (del.rows.length === 0) {
        await db.query('ROLLBACK');
        return sendApiError(res, 404, ErrorCodes.CLASSIFIER_NOT_FOUND);
      }

      await db.query('COMMIT');
      res.json({ success: true });
    } catch (err: unknown) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* ignore */
      }

      const pgCode =
        typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
      if (pgCode === '23503') return sendApiError(res, 409, ErrorCodes.CLASSIFIER_IN_USE);

      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);
