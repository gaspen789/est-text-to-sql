import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';

export const authRouter = Router();

// Password-reset tokens (dev/demo storage).
// TODO: Replace this in-memory map with a DB-backed table, e.g.
//   CREATE TABLE password_reset_token (
//     token_hash       char(64) PRIMARY KEY,      -- sha256 hex of the plaintext token
//     app_user_id      bigint NOT NULL REFERENCES app_user(app_user_id) ON DELETE CASCADE,
//     expires_at_time  timestamp with time zone NOT NULL,
//     used_at_time     timestamp with time zone NULL,
//     created_at_time  timestamp with time zone NOT NULL DEFAULT now()
//   );
//   CREATE INDEX idx_password_reset_token_app_user ON password_reset_token(app_user_id);
// Until then we keep the hash -> { appUserId, expiresAt, usedAt } mapping in memory.
type ResetEntry = { appUserId: number; expiresAt: number; usedAt: number | null };
const passwordResetTokens = new Map<string, ResetEntry>();

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function pruneExpiredResetTokens(now: number): void {
  for (const [hash, entry] of passwordResetTokens) {
    if (entry.expiresAt <= now || (entry.usedAt !== null && entry.usedAt + RESET_TOKEN_TTL_MS <= now)) {
      passwordResetTokens.delete(hash);
    }
  }
}

/** Normalize the stored 3-char `preferred_llm_language` (e.g. 'et ', 'en ') to 'et' or 'en'. */
function normalizePreferredLanguage(raw: unknown): 'et' | 'en' {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s === 'en' ? 'en' : 'et';
}

function buildResetEmail(
  lang: 'et' | 'en',
  recipientEmail: string,
  resetLink: string
): { subject: string; body: string } {
  if (lang === 'en') {
    return {
      subject: 'Password reset request',
      body: [
        `Hello,`,
        ``,
        `We received a request to reset the password for the account linked to ${recipientEmail}.`,
        `If you made this request, click the link below to set a new password:`,
        ``,
        `  ${resetLink}`,
        ``,
        `This link will expire in 30 minutes.`,
        `If you did not request a password reset, you can safely ignore this email — your password will stay the same.`,
      ].join('\n'),
    };
  }
  return {
    subject: 'Parooli lähtestamise soov',
    body: [
      `Tere,`,
      ``,
      `Saime taotluse lähtestada parool kontole, mis on seotud e-posti aadressiga ${recipientEmail}.`,
      `Kui see taotlus tuli sinult, kliki alloleval lingil ja määra uus parool:`,
      ``,
      `  ${resetLink}`,
      ``,
      `Link aegub 30 minuti pärast.`,
      `Kui sa ei soovinud parooli lähtestada, võid selle kirja ignoreerida — sinu parool jääb samaks.`,
    ].join('\n'),
  };
}

/**
 * Send the password-reset email.
 *
 * Dev/demo mode: we don't have an SMTP/email provider wired up yet, so we log the
 * full message (including the clickable reset link) to the backend console.
 *
 * TODO: Replace this with a real email transport (e.g. nodemailer + SMTP, Resend, or
 * SendGrid) once credentials are available.
 */
function deliverResetEmail(
  lang: 'et' | 'en',
  recipientEmail: string,
  resetLink: string
): void {
  const { subject, body } = buildResetEmail(lang, recipientEmail, resetLink);
  console.log(
    [
      '',
      '========== PASSWORD RESET EMAIL (dev mode) ==========',
      `To:      ${recipientEmail}`,
      `Subject: ${subject}`,
      '',
      body,
      '=====================================================',
      '',
    ].join('\n')
  );
}

/**
 * Prototype: user notices to administrators are not persisted or emailed — only logged
 * on the backend console for operators.
 */
function logAdminReportNotice(appUserId: number, messageBody: string): void {
  console.log(
    [
      '',
      '========== USER NOTICE TO ADMINISTRATORS (prototype: console only, not email) ==========',
      `app_user_id: ${appUserId}`,
      '',
      messageBody,
      '========================================================================================',
      '',
    ].join('\n')
  );
}

function getAppBaseUrl(): string {
  const raw = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  return raw.replace(/\/+$/, '');
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

authRouter.get('/api/user/global-instruction', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const result = await db.query(
      `SELECT llm_custom_global_instruction, preferred_llm_language
       FROM app_user WHERE app_user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    const row = result.rows[0];
    res.json({
      llm_custom_global_instruction: row.llm_custom_global_instruction ?? null,
      preferred_llm_language: String(row.preferred_llm_language ?? '').trim(),
    });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/**
 * Lightweight session validity check for the frontend.
 * Used to force logout quickly when an admin deactivates an account.
 */
authRouter.get('/api/user/session-status', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const result = await db.query(`SELECT is_active FROM app_user WHERE app_user_id = $1`, [userId]);
    if (result.rows.length === 0) return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);

    const isActive = result.rows[0]?.is_active !== false;
    if (!isActive) return sendApiError(res, 403, ErrorCodes.ACCOUNT_DEACTIVATED);

    res.json({ active: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

authRouter.put('/api/user/global-instruction', async (req: Request, res: Response) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

  const body = req.body ?? {};
  if (!('llm_custom_global_instruction' in body)) {
    return sendApiError(res, 400, ErrorCodes.GLOBAL_INSTRUCTION_FIELD_REQUIRED);
  }
  const raw = body.llm_custom_global_instruction;
  let value: string | null;
  if (raw === null || raw === undefined) {
    value = null;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    value = t === '' ? null : t;
  } else {
    return sendApiError(res, 400, ErrorCodes.GLOBAL_INSTRUCTION_INVALID_TYPE);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      `UPDATE app_user
       SET llm_custom_global_instruction = $1,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $2
       RETURNING llm_custom_global_instruction`,
      [value, userId]
    );

    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({ llm_custom_global_instruction: u.rows[0].llm_custom_global_instruction ?? null });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code: string }).code
        : '';
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

authRouter.put('/api/user/preferred-llm-language', async (req: Request, res: Response) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

  const body = req.body ?? {};
  const preferred = body.preferred_llm_language;
  if (typeof preferred !== 'string' || preferred.trim() === '') {
    return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
  }
  const trimmed = preferred.trim();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const lang = await client.query(
      `SELECT 1 FROM language_active WHERE language_code = $1 LIMIT 1`,
      [trimmed]
    );
    if (lang.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    const updated = await client.query(
      `UPDATE app_user
       SET preferred_llm_language = $1,
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $2
       RETURNING preferred_llm_language`,
      [trimmed, userId]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendApiError(res, 404, ErrorCodes.USER_NOT_FOUND);
    }

    await client.query('COMMIT');
    res.json({
      preferred_llm_language: String(updated.rows[0].preferred_llm_language ?? '').trim(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    const mapped = mapPgErrorToCode(err);
    sendApiError(res, 500, mapped.code, mapped.params);
  } finally {
    client.release();
  }
});

authRouter.post('/api/user/change-password', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const { current_password, new_password } = req.body ?? {};
    if (
      typeof current_password !== 'string' ||
      typeof new_password !== 'string' ||
      !current_password ||
      !new_password
    ) {
      return sendApiError(res, 400, ErrorCodes.CHANGE_PASSWORD_FIELDS_REQUIRED);
    }
    if (new_password.length < 15) {
      return sendApiError(res, 400, ErrorCodes.NEW_PASSWORD_TOO_SHORT);
    }

    const result = await db.query(
      `UPDATE account
       SET password_hash = extensions.crypt($1::text, extensions.gen_salt('bf', 12)),
           modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)
       WHERE app_user_id = $2
         AND password_hash = extensions.crypt($3::text, password_hash)
       RETURNING app_user_id`,
      [new_password, userId, current_password]
    );

    if (result.rows.length === 0) {
      return sendApiError(res, 400, ErrorCodes.CURRENT_PASSWORD_WRONG_OR_USER_NOT_FOUND);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/**
 * Step 1 of password reset: the user enters their email on the login page.
 *
 * We always respond with `{ success: true }` regardless of whether the email
 * matches an active account. That way an attacker can't use this endpoint to
 * enumerate which emails are registered.
 *
 * If the email does match an active user, we generate a cryptographically random
 * token, store its SHA-256 hash with a 30-minute expiry, and "send" the email
 * (currently: log it to the backend console — see `deliverResetEmail`).
 */
authRouter.post('/api/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail) {
      return sendApiError(res, 400, ErrorCodes.LOGIN_CREDENTIALS_MISSING);
    }

    const now = Date.now();
    pruneExpiredResetTokens(now);

    const userRes = await db.query(
      `SELECT app_user_id, email, preferred_llm_language, is_active
       FROM app_user
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [normalizedEmail]
    );
    const row = userRes.rows[0];
    const appUserId = Number(row?.app_user_id);

    if (row && row.is_active !== false && Number.isInteger(appUserId) && appUserId > 0) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      passwordResetTokens.set(tokenHash, {
        appUserId,
        expiresAt: now + RESET_TOKEN_TTL_MS,
        usedAt: null,
      });

      const lang = normalizePreferredLanguage(row.preferred_llm_language);
      const recipient = typeof row.email === 'string' ? row.email : normalizedEmail;
      const resetLink = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      deliverResetEmail(lang, recipient, resetLink);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

/**
 * Step 2 of password reset: the reset page calls this on mount to check whether
 * the token from the URL is still valid (exists, not expired, not already used).
 * Returning a distinct error code lets the UI show a helpful message.
 */
authRouter.get('/api/reset-password/verify', (req: Request, res: Response) => {
  const tokenParam = req.query.token;
  const token = typeof tokenParam === 'string' ? tokenParam.trim() : '';
  if (!token) {
    return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_INVALID);
  }

  const now = Date.now();
  pruneExpiredResetTokens(now);

  const entry = passwordResetTokens.get(hashToken(token));
  if (!entry) {
    return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_INVALID);
  }
  if (entry.usedAt !== null) {
    return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_USED);
  }
  if (entry.expiresAt <= now) {
    return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_EXPIRED);
  }

  res.json({ valid: true });
});

/**
 * Step 3 of password reset: set the new password.
 *
 * Only the holder of a valid (non-expired, unused) token can change the password,
 * and the token can only be used once — this is what enforces "only the person
 * themselves can change their password".
 */
authRouter.post('/api/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, new_password } = req.body ?? {};
    const tokenStr = typeof token === 'string' ? token.trim() : '';
    const newPassword = typeof new_password === 'string' ? new_password : '';

    if (!tokenStr || !newPassword) {
      return sendApiError(res, 400, ErrorCodes.RESET_PASSWORD_FIELDS_REQUIRED);
    }
    if (newPassword.length < 15) {
      return sendApiError(res, 400, ErrorCodes.NEW_PASSWORD_TOO_SHORT);
    }

    const now = Date.now();
    pruneExpiredResetTokens(now);

    const tokenHash = hashToken(tokenStr);
    const entry = passwordResetTokens.get(tokenHash);
    if (!entry) {
      return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_INVALID);
    }
    if (entry.usedAt !== null) {
      return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_USED);
    }
    if (entry.expiresAt <= now) {
      return sendApiError(res, 400, ErrorCodes.RESET_TOKEN_EXPIRED);
    }

    await db.query(
      `INSERT INTO account (app_user_id, password_hash)
       VALUES ($1, extensions.crypt($2::text, extensions.gen_salt('bf', 12)))
       ON CONFLICT (app_user_id)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         modified_at_time = date_trunc('second', CURRENT_TIMESTAMP)`,
      [entry.appUserId, newPassword]
    );

    entry.usedAt = now;
    passwordResetTokens.set(tokenHash, entry);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

authRouter.post('/api/user/report-to-admins', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const { message_body } = req.body ?? {};
    const trimmed = typeof message_body === 'string' ? message_body.trim() : '';
    if (trimmed.length < 3) {
      return sendApiError(res, 400, ErrorCodes.REPORT_TOO_SHORT);
    }

    logAdminReportNotice(userId, trimmed);

    res.status(201).json({ success: true });
  } catch (err: unknown) {
    console.error(err);
    const mapped = mapPgErrorToCode(err);
    sendApiError(res, 500, mapped.code, mapped.params);
  }
});

authRouter.get('/api/user/roles', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    }

    const result = await db.query(
      `SELECT user_role_codes, user_role_names
       FROM app_user_active_with_roles
       WHERE app_user_id = $1`,
      [userId]
    );

    const row = result.rows[0];
    if (!row || !row.user_role_names) {
      return res.json([]);
    }

    const codes: string[] = row.user_role_codes
      ? String(row.user_role_codes).split(', ').filter(Boolean)
      : [];
    const names: string[] = String(row.user_role_names).split(', ').filter(Boolean);

    const payload = names.map((user_role_name, idx) => ({
      user_role_code: codes[idx] ?? '',
      user_role_name,
    }));

    res.json(payload);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

authRouter.get('/api/user/groups', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    }

    const result = await db.query(
      `SELECT ug.user_group_code, ug.name AS user_group_name
       FROM app_user_group_member augm
       JOIN user_group ug USING (user_group_code)
       WHERE augm.app_user_id = $1
         AND ug.is_active = TRUE
       ORDER BY ug.name`,
      [userId]
    );

    res.json(
      result.rows.map((row) => ({
        user_group_code: String(row.user_group_code).trim(),
        user_group_name: row.user_group_name as string,
      }))
    );
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

authRouter.post('/api/login', async (req: Request, res: Response) => {
  try {
    if (!req.body) {
      return sendApiError(res, 400, ErrorCodes.LOGIN_BODY_MISSING);
    }
    const { email, password } = req.body;

    if (!email || !password) {
      return sendApiError(res, 400, ErrorCodes.LOGIN_CREDENTIALS_MISSING);
    }

    const functionName = 'f_is_active_with_correct_password';
    const result = await db.query(`SELECT ${functionName}($1, $2)`, [email, password]);
    const userId = result.rows[0][functionName];

    if (userId === null) {
      return sendApiError(res, 401, ErrorCodes.LOGIN_INVALID_CREDENTIALS);
    }

    if (!userId || typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
      return sendApiError(res, 400, ErrorCodes.LOGIN_USER_ID_INVALID);
    }

    res.json({ success: userId });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});
