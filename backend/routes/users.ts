import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const usersRouter = Router();

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  // Basic sanity check; DB may also enforce stricter constraints.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.length > 320) return null;
  return email;
}

function normalizePassword(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length < 15) return null;
  return s;
}

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

function parseTargetUserId(req: Request): number | null {
  const raw = req.params.id;
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

usersRouter.get('/api/admin/roles', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT user_role_code, name AS user_role_name
       FROM user_role
       WHERE is_active = TRUE
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

usersRouter.get('/api/admin/groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT user_group_code, name AS user_group_name
       FROM user_group
       WHERE is_active = TRUE
       ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

usersRouter.get('/api/admin/users', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const result = await db.query(
      `SELECT
          au.app_user_id,
          au.email,
          au.preferred_llm_language,
          au.llm_custom_global_instruction,
          au.is_active,
          au.created_at_time,
          au.modified_at_time,
          COALESCE((
            SELECT STRING_AGG(ur.user_role_code, ', ' ORDER BY ur.user_role_code)
            FROM app_user_role_assignment aura
            JOIN user_role ur USING(user_role_code)
            WHERE aura.app_user_id = au.app_user_id
              AND ur.is_active = TRUE
          ), '') AS user_role_codes,
          COALESCE((
            SELECT STRING_AGG(ur.name, ', ' ORDER BY ur.name)
            FROM app_user_role_assignment aura
            JOIN user_role ur USING(user_role_code)
            WHERE aura.app_user_id = au.app_user_id
              AND ur.is_active = TRUE
          ), '') AS user_role_names,
          COALESCE((
            SELECT STRING_AGG(ug.user_group_code, ', ' ORDER BY ug.user_group_code)
            FROM app_user_group_member augm
            JOIN user_group ug USING(user_group_code)
            WHERE augm.app_user_id = au.app_user_id
              AND ug.is_active = TRUE
          ), '') AS user_group_codes,
          COALESCE((
            SELECT STRING_AGG(ug.name, ', ' ORDER BY ug.name)
            FROM app_user_group_member augm
            JOIN user_group ug USING(user_group_code)
            WHERE augm.app_user_id = au.app_user_id
              AND ug.is_active = TRUE
          ), '') AS user_group_names
       FROM app_user au
       ORDER BY au.email`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

usersRouter.post('/api/admin/users', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const email = normalizeEmail(body.email);
    const preferred = typeof body.preferred_llm_language === 'string' ? body.preferred_llm_language.trim() : '';
    const rawInstruction = body.llm_custom_global_instruction;
    const isActive = body.is_active === false ? false : true;
    const password = normalizePassword(body.password);
    const roleCodesRaw = body.user_role_codes;
    const groupCodesRaw = body.user_group_codes;

    if (!email || !preferred) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    if (
      (roleCodesRaw !== undefined && (!Array.isArray(roleCodesRaw) || roleCodesRaw.some((c: unknown) => typeof c !== 'string'))) ||
      (groupCodesRaw !== undefined && (!Array.isArray(groupCodesRaw) || groupCodesRaw.some((c: unknown) => typeof c !== 'string')))
    ) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const roleCodes: string[] = Array.isArray(roleCodesRaw)
      ? [...new Set(roleCodesRaw.map((c: string) => c.trim()).filter(Boolean))]
      : [];
    const groupCodes: string[] = Array.isArray(groupCodesRaw)
      ? [...new Set(groupCodesRaw.map((c: string) => c.trim()).filter(Boolean))]
      : [];

    let instructionValue: string | null;
    if (rawInstruction === null || rawInstruction === undefined) {
      instructionValue = null;
    } else if (typeof rawInstruction === 'string') {
      const trimmed = rawInstruction.trim();
      instructionValue = trimmed === '' ? null : trimmed;
    } else {
      return sendApiError(res, 400, ErrorCodes.GLOBAL_INSTRUCTION_INVALID_TYPE);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const existing = await client.query(`SELECT 1 FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`, [
      email,
    ]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.USER_EMAIL_ALREADY_EXISTS);
    }

    const lang = await client.query(`SELECT 1 FROM language_active WHERE language_code = $1 LIMIT 1`, [
      preferred,
    ]);
    if (lang.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    if (roleCodes.length > 0) {
      const validRoles = await client.query(
        `SELECT user_role_code
         FROM user_role
         WHERE is_active = TRUE
           AND user_role_code = ANY($1::char(3)[])`,
        [roleCodes]
      );
      const validRoleSet = new Set(validRoles.rows.map((r) => String(r.user_role_code).trim()));
      const invalidRoles = roleCodes.filter((c) => !validRoleSet.has(c));
      if (invalidRoles.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_role_codes: invalidRoles });
      }
    }

    if (groupCodes.length > 0) {
      const validGroups = await client.query(
        `SELECT user_group_code
         FROM user_group
         WHERE is_active = TRUE
           AND user_group_code = ANY($1::char(5)[])`,
        [groupCodes]
      );
      const validGroupSet = new Set(validGroups.rows.map((r) => String(r.user_group_code).trim()));
      const invalidGroups = groupCodes.filter((c) => !validGroupSet.has(c));
      if (invalidGroups.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_group_codes: invalidGroups });
      }
    }

    const inserted = await client.query(
      `INSERT INTO app_user (email, preferred_llm_language, llm_custom_global_instruction, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING app_user_id`,
      [email, preferred, instructionValue, isActive]
    );

    const newUserId = Number(inserted.rows[0]?.app_user_id);
    if (!Number.isInteger(newUserId) || newUserId <= 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }

    if (roleCodes.length > 0) {
      await client.query(
        `INSERT INTO app_user_role_assignment (app_user_id, user_role_code)
         SELECT $1, x.code
         FROM UNNEST($2::char(3)[]) AS x(code)
         ON CONFLICT DO NOTHING`,
        [newUserId, roleCodes]
      );
    }
    if (groupCodes.length > 0) {
      await client.query(
        `INSERT INTO app_user_group_member (user_group_code, app_user_id)
         SELECT x.code, $1
         FROM UNNEST($2::char(5)[]) AS x(code)
         ON CONFLICT DO NOTHING`,
        [newUserId, groupCodes]
      );
    }

    if (password) {
      await client.query(
        `INSERT INTO account (app_user_id, password_hash)
         VALUES ($1, extensions.crypt($2::text, extensions.gen_salt('bf', 12)))
         ON CONFLICT (app_user_id)
         DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)`,
        [newUserId, password]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ app_user_id: newUserId, success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/activate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const updated = await client.query(
      `UPDATE app_user
       SET is_active = TRUE,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $1
       RETURNING app_user_id`,
      [targetUserId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/deactivate', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    // Prevent admins from deactivating their own account.
    if (targetUserId === userId) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.ADMIN_CANNOT_DEACTIVATE_SELF);
    }

    const targetAdminCheck = await client.query(
      `SELECT 1
       FROM app_user_role_assignment
       WHERE app_user_id = $1
         AND user_role_code = 'ADM'
       LIMIT 1`,
      [targetUserId]
    );
    const isTargetAdmin = targetAdminCheck.rows.length > 0;

    // Ensure at least one active administrator always remains.
    if (isTargetAdmin) {
      const activeAdminCountResult = await client.query(
        `SELECT COUNT(*)::int AS active_admin_count
         FROM app_user au
         JOIN app_user_role_assignment aura ON aura.app_user_id = au.app_user_id
         WHERE au.is_active = TRUE
           AND aura.user_role_code = 'ADM'`
      );
      const activeAdminCount = Number(activeAdminCountResult.rows[0]?.active_admin_count ?? 0);
      if (activeAdminCount <= 1) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.LAST_ACTIVE_ADMIN_REQUIRED);
      }
    }

    const updated = await client.query(
      `UPDATE app_user
       SET is_active = FALSE,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $1
       RETURNING app_user_id`,
      [targetUserId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/email', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    const email = normalizeEmail((req.body ?? {}).email);
    if (!email) return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const existing = await client.query(
      `SELECT app_user_id FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0 && Number(existing.rows[0]?.app_user_id) !== targetUserId) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.USER_EMAIL_ALREADY_EXISTS);
    }

    const updated = await client.query(
      `UPDATE app_user
       SET email = $1,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $2
       RETURNING app_user_id`,
      [email, targetUserId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.delete('/api/admin/users/:id', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    // Prevent admins from deleting their own account.
    if (targetUserId === userId) {
      return sendApiError(res, 400, ErrorCodes.ADMIN_CANNOT_DELETE_SELF);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    // Ensure at least one active administrator always remains (same rule as deactivation).
    const targetAdminCheck = await client.query(
      `SELECT 1
       FROM app_user_role_assignment
       WHERE app_user_id = $1
         AND user_role_code = 'ADM'
       LIMIT 1`,
      [targetUserId]
    );
    const isTargetAdmin = targetAdminCheck.rows.length > 0;
    if (isTargetAdmin) {
      const activeAdminCountResult = await client.query(
        `SELECT COUNT(*)::int AS active_admin_count
         FROM app_user au
         JOIN app_user_role_assignment aura ON aura.app_user_id = au.app_user_id
         WHERE au.is_active = TRUE
           AND aura.user_role_code = 'ADM'`
      );
      const activeAdminCount = Number(activeAdminCountResult.rows[0]?.active_admin_count ?? 0);
      if (activeAdminCount <= 1) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.LAST_ACTIVE_ADMIN_REQUIRED);
      }
    }

    // Re-assign creator/modifier references that block deletion (FK is NO ACTION).
    await client.query(`UPDATE resource SET creator = $1 WHERE creator = $2`, [userId, targetUserId]);
    await client.query(`UPDATE resource SET modifier = $1 WHERE modifier = $2`, [userId, targetUserId]);
    await client.query(`UPDATE llm SET creator = $1 WHERE creator = $2`, [userId, targetUserId]);
    await client.query(`UPDATE llm SET modifier = $1 WHERE modifier = $2`, [userId, targetUserId]);

    // Delete chats (and dependent data) owned by the user (FK is NO ACTION).
    await client.query(
      `DELETE FROM sql_query_resource_usage
       WHERE sql_query_id IN (
         SELECT sql_query_id
         FROM sql_query
         WHERE chat_id IN (SELECT chat_id FROM chat WHERE app_user_id = $1)
       )`,
      [targetUserId]
    );
    await client.query(
      `DELETE FROM sql_query
       WHERE chat_id IN (SELECT chat_id FROM chat WHERE app_user_id = $1)`,
      [targetUserId]
    );
    await client.query(
      `DELETE FROM message
       WHERE chat_id IN (SELECT chat_id FROM chat WHERE app_user_id = $1)`,
      [targetUserId]
    );
    await client.query(`DELETE FROM chat WHERE app_user_id = $1`, [targetUserId]);

    // Finally delete the user (account/roles/groups cascade).
    const deleted = await client.query(`DELETE FROM app_user WHERE app_user_id = $1 RETURNING app_user_id`, [
      targetUserId,
    ]);
    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/roles', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    const roleCodes = (req.body ?? {}).user_role_codes;
    if (!Array.isArray(roleCodes) || roleCodes.some((c) => typeof c !== 'string')) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }
    const normalized = [...new Set(roleCodes.map((c) => c.trim()).filter(Boolean))];

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const u = await client.query(`SELECT 1 FROM app_user WHERE app_user_id = $1`, [targetUserId]);
    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    if (normalized.length > 0) {
      const valid = await client.query(
        `SELECT user_role_code
         FROM user_role
         WHERE is_active = TRUE
           AND user_role_code = ANY($1::char(3)[])`,
        [normalized]
      );
      const validSet = new Set(valid.rows.map((r) => String(r.user_role_code).trim()));
      const invalid = normalized.filter((c) => !validSet.has(c));
      if (invalid.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_role_codes: invalid });
      }
    }

    await client.query(`DELETE FROM app_user_role_assignment WHERE app_user_id = $1`, [targetUserId]);
    if (normalized.length > 0) {
      await client.query(
        `INSERT INTO app_user_role_assignment (app_user_id, user_role_code)
         SELECT $1, x.code
         FROM UNNEST($2::char(3)[]) AS x(code)`,
        [targetUserId, normalized]
      );
    }

    await client.query(
      `UPDATE app_user
       SET modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $1`,
      [targetUserId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/groups', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    const groupCodes = (req.body ?? {}).user_group_codes;
    if (!Array.isArray(groupCodes) || groupCodes.some((c) => typeof c !== 'string')) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }
    const normalized = [...new Set(groupCodes.map((c) => c.trim()).filter(Boolean))];

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const u = await client.query(`SELECT 1 FROM app_user WHERE app_user_id = $1`, [targetUserId]);
    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    if (normalized.length > 0) {
      const valid = await client.query(
        `SELECT user_group_code
         FROM user_group
         WHERE is_active = TRUE
           AND user_group_code = ANY($1::char(5)[])`,
        [normalized]
      );
      const validSet = new Set(valid.rows.map((r) => String(r.user_group_code).trim()));
      const invalid = normalized.filter((c) => !validSet.has(c));
      if (invalid.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_group_codes: invalid });
      }
    }

    await client.query(`DELETE FROM app_user_group_member WHERE app_user_id = $1`, [targetUserId]);
    if (normalized.length > 0) {
      await client.query(
        `INSERT INTO app_user_group_member (user_group_code, app_user_id)
         SELECT x.code, $1
         FROM UNNEST($2::char(5)[]) AS x(code)`,
        [targetUserId, normalized]
      );
    }

    await client.query(
      `UPDATE app_user
       SET modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $1`,
      [targetUserId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.post('/api/admin/users/bulk-assign', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const body = req.body ?? {};
    const userIdsRaw = body.user_ids;
    const roleCodesRaw = body.user_role_codes;
    const groupCodesRaw = body.user_group_codes;
    const actionRaw = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'add';
    const action: 'add' | 'remove' = actionRaw === 'remove' ? 'remove' : 'add';

    if (!Array.isArray(userIdsRaw) || !Array.isArray(roleCodesRaw) || !Array.isArray(groupCodesRaw)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const userIds = [...new Set(userIdsRaw.filter((x) => Number.isInteger(x) && Number(x) > 0))];
    const roleCodes = [...new Set(roleCodesRaw.filter((c) => typeof c === 'string').map((c) => c.trim()).filter(Boolean))];
    const groupCodes = [...new Set(groupCodesRaw.filter((c) => typeof c === 'string').map((c) => c.trim()).filter(Boolean))];

    if (userIds.length === 0 || (roleCodes.length === 0 && groupCodes.length === 0)) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const existingUsers = await client.query(
      `SELECT app_user_id FROM app_user WHERE app_user_id = ANY($1::int[])`,
      [userIds]
    );
    const existingUserIds = new Set(existingUsers.rows.map((r) => Number(r.app_user_id)));
    const missingUserIds = userIds.filter((id) => !existingUserIds.has(id));
    if (missingUserIds.length > 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND, { missing_user_ids: missingUserIds });
    }

    if (roleCodes.length > 0) {
      const validRoles = await client.query(
        `SELECT user_role_code
         FROM user_role
         WHERE is_active = TRUE
           AND user_role_code = ANY($1::char(3)[])`,
        [roleCodes]
      );
      const validRoleSet = new Set(validRoles.rows.map((r) => String(r.user_role_code).trim()));
      const invalidRoles = roleCodes.filter((c) => !validRoleSet.has(c));
      if (invalidRoles.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_role_codes: invalidRoles });
      }
    }

    if (groupCodes.length > 0) {
      const validGroups = await client.query(
        `SELECT user_group_code
         FROM user_group
         WHERE is_active = TRUE
           AND user_group_code = ANY($1::char(5)[])`,
        [groupCodes]
      );
      const validGroupSet = new Set(validGroups.rows.map((r) => String(r.user_group_code).trim()));
      const invalidGroups = groupCodes.filter((c) => !validGroupSet.has(c));
      if (invalidGroups.length > 0) {
        await client.query('ROLLBACK');
        return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING, { invalid_group_codes: invalidGroups });
      }
    }

    if (action === 'add') {
      if (roleCodes.length > 0) {
        await client.query(
          `INSERT INTO app_user_role_assignment (app_user_id, user_role_code)
           SELECT u.id, r.code
           FROM UNNEST($1::int[]) AS u(id)
           CROSS JOIN UNNEST($2::char(3)[]) AS r(code)
           ON CONFLICT DO NOTHING`,
          [userIds, roleCodes]
        );
      }

      if (groupCodes.length > 0) {
        await client.query(
          `INSERT INTO app_user_group_member (user_group_code, app_user_id)
           SELECT g.code, u.id
           FROM UNNEST($1::char(5)[]) AS g(code)
           CROSS JOIN UNNEST($2::int[]) AS u(id)
           ON CONFLICT DO NOTHING`,
          [groupCodes, userIds]
        );
      }
    } else {
      if (roleCodes.length > 0) {
        await client.query(
          `DELETE FROM app_user_role_assignment
           WHERE app_user_id = ANY($1::int[])
             AND user_role_code = ANY($2::char(3)[])`,
          [userIds, roleCodes]
        );
      }
      if (groupCodes.length > 0) {
        await client.query(
          `DELETE FROM app_user_group_member
           WHERE app_user_id = ANY($1::int[])
             AND user_group_code = ANY($2::char(5)[])`,
          [userIds, groupCodes]
        );
      }
    }

    await client.query(
      `UPDATE app_user
       SET modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = ANY($1::int[])`,
      [userIds]
    );

    await client.query('COMMIT');
    res.json({ success: true, action });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/password', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    const rawPassword = (req.body ?? {}).new_password;
    if (typeof rawPassword !== 'string' || rawPassword.trim() === '') {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }
    const newPassword = rawPassword.trim();
    if (newPassword.length < 15) {
      return sendApiError(res, 400, ErrorCodes.NEW_PASSWORD_TOO_SHORT);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const u = await client.query(`SELECT 1 FROM app_user WHERE app_user_id = $1`, [targetUserId]);
    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query(
      `INSERT INTO account (app_user_id, password_hash)
       VALUES ($1, extensions.crypt($2::text, extensions.gen_salt('bf', 12)))
       ON CONFLICT (app_user_id)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)`,
      [targetUserId, newPassword]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});

usersRouter.put('/api/admin/users/:id/profile', async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const targetUserId = parseTargetUserId(req);
    if (!targetUserId) return sendApiError(res, 400, ErrorCodes.INVALID_USER_ID);

    const body = req.body ?? {};
    const preferred = body.preferred_llm_language;
    if (typeof preferred !== 'string' || preferred.trim() === '') {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const rawInstruction = body.llm_custom_global_instruction;
    let instructionValue: string | null;
    if (rawInstruction === null || rawInstruction === undefined) {
      instructionValue = null;
    } else if (typeof rawInstruction === 'string') {
      const trimmed = rawInstruction.trim();
      instructionValue = trimmed === '' ? null : trimmed;
    } else {
      return sendApiError(res, 400, ErrorCodes.GLOBAL_INSTRUCTION_INVALID_TYPE);
    }

    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['myapp.current_user_id', String(userId)]);

    const u = await client.query(`SELECT 1 FROM app_user WHERE app_user_id = $1`, [targetUserId]);
    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    const lang = await client.query(
      `SELECT 1 FROM language_active WHERE language_code = $1 LIMIT 1`,
      [preferred.trim()]
    );
    if (lang.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const updated = await client.query(
      `UPDATE app_user
       SET preferred_llm_language = $1,
           llm_custom_global_instruction = $2,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $3
       RETURNING app_user_id`,
      [preferred.trim(), instructionValue, targetUserId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const code =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
    if (code === '23514') {
      return sendApiError(res, 400, ErrorCodes.USER_INSTRUCTION_CONTENT_INVALID);
    }
    console.error(err);
    const mapped = mapPgErrorToCode(err);
    sendApiError(res, 500, mapped.code, mapped.params);
  } finally {
    client.release();
  }
});

