import { randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { CHAT_TITLE_MAX_LEN } from '../services/chat-title.js';
import { decrypt, encrypt } from '../services/encryption.js';
import { getMessageBodyColumn } from '../services/message-body-column.js';
import { hasParentMessageIdColumn } from '../services/parent-message-id-column.js';

export const chatsRouter = Router();

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

/** Express may type route params as `string | string[]`; normalize to a single string. */
function paramString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

chatsRouter.get('/api/chats', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const result = await db.query(
      `SELECT
         c.chat_id,
         c.chat_title AS title,
         COALESCE(fm.first_message_time, c.modified_at_time) AS start_time
       FROM Chat c
       LEFT JOIN (
         SELECT chat_id, MIN(sent_time) AS first_message_time
         FROM Message
         GROUP BY chat_id
       ) fm ON fm.chat_id = c.chat_id
       LEFT JOIN (
         SELECT chat_id, MAX(sent_time) AS last_message_time
         FROM Message
         GROUP BY chat_id
       ) m ON m.chat_id = c.chat_id
       WHERE c.app_user_id = $1 AND c.is_hidden = FALSE
       ORDER BY COALESCE(m.last_message_time, fm.first_message_time, c.modified_at_time) DESC, c.chat_id DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.get('/api/chats/latest-with-messages', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const result = await db.query(
      `SELECT c.chat_id, MAX(m.sent_time) AS latest_message_time
       FROM Chat c
       JOIN Message m ON m.chat_id = c.chat_id
       WHERE c.app_user_id = $1
         AND c.is_hidden = FALSE
       GROUP BY c.chat_id
       ORDER BY latest_message_time DESC, c.chat_id DESC
       LIMIT 1`,
      [userId]
    );

    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.post('/api/chats', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    // `chat_title` is NOT NULL and UNIQUE (app_user_id, chat_title). Use a random hex buffer,
    // then rename to `Chat {id}` in the same transaction so the client always gets a row.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const provisional = randomBytes(15).toString('hex').slice(0, CHAT_TITLE_MAX_LEN);
      const ins = await client.query<{ chat_id: number; start_time: string }>(
        `INSERT INTO Chat (app_user_id, chat_title)
         VALUES ($1, $2)
         RETURNING chat_id, modified_at_time AS start_time`,
        [userId, provisional]
      );
      const row = ins.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
      }
      const defaultTitle = `Chat ${row.chat_id}`.slice(0, CHAT_TITLE_MAX_LEN);
      await client.query(`UPDATE Chat SET chat_title = $1 WHERE chat_id = $2 AND app_user_id = $3`, [
        defaultTitle,
        row.chat_id,
        userId,
      ]);
      await client.query('COMMIT');
      res.status(201).json({
        chat_id: row.chat_id,
        title: defaultTitle,
        start_time: row.start_time,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.get('/api/chats/:chat_id/messages', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const chatId = parseInt(paramString(req.params.chat_id), 10);
    if (isNaN(chatId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);
    }

    const messageBodyCol = await getMessageBodyColumn();
    const result = await db.query(
      `SELECT
         m.message_id,
         m.${messageBodyCol} AS cipher_body,
         m.sent_time,
         m.is_sent_by_user,
         m.is_flagged_by_user,
         m.used_llm_id,
         lm.model_name AS used_llm_name,
         CASE
           WHEN m.is_sent_by_user = FALSE
             AND LAG(m.is_sent_by_user) OVER (ORDER BY m.sent_time ASC, m.message_id ASC) = TRUE
             AND LAG(m.sent_time) OVER (ORDER BY m.sent_time ASC, m.message_id ASC) IS NOT NULL
           THEN
             (EXTRACT(EPOCH FROM (
               m.sent_time - LAG(m.sent_time) OVER (ORDER BY m.sent_time ASC, m.message_id ASC)
             )) * 1000)::int
           ELSE NULL
         END AS answering_time_ms
       FROM Message m
       JOIN Chat c ON c.chat_id = m.chat_id
       LEFT JOIN LLM lm ON lm.llm_id = m.used_llm_id
       WHERE c.chat_id = $1
         AND c.app_user_id = $2
       ORDER BY m.sent_time ASC, m.message_id ASC`,
      [chatId, userId]
    );

    res.json(
      result.rows.map((r: { cipher_body: string } & Record<string, unknown>) => ({
        message_id: r.message_id,
        sent_time: r.sent_time,
        is_sent_by_user: r.is_sent_by_user,
        is_flagged_by_user: r.is_flagged_by_user,
        used_llm_id: r.used_llm_id,
        used_llm_name: r.used_llm_name,
        answering_time_ms: typeof r.answering_time_ms === 'number' ? r.answering_time_ms : null,
        encrypted_content: decrypt(r.cipher_body) ?? String(r.cipher_body ?? ''),
      }))
    );
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.put('/api/chats/:chat_id/title', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const chatId = parseInt(paramString(req.params.chat_id), 10);
    if (isNaN(chatId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);
    }

    const { title } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return sendApiError(res, 400, ErrorCodes.CHAT_TITLE_REQUIRED);
    }

    const result = await db.query(
      `UPDATE Chat
       SET chat_title = $1
       WHERE chat_id = $2
         AND app_user_id = $3
         AND is_hidden = FALSE
       RETURNING chat_id, chat_title AS title`,
      [title.trim(), chatId, userId]
    );

    if (result.rows.length === 0) {
      return sendApiError(res, 404, ErrorCodes.CHAT_NOT_FOUND);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.delete('/api/chats/:chat_id', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const chatId = parseInt(paramString(req.params.chat_id), 10);
    if (isNaN(chatId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);
    }

    const result = await db.query(
      `UPDATE Chat
       SET is_hidden = TRUE
       WHERE chat_id = $1
         AND app_user_id = $2
         AND is_hidden = FALSE
       RETURNING chat_id`,
      [chatId, userId]
    );

    if (result.rows.length === 0) {
      return sendApiError(res, 404, ErrorCodes.CHAT_NOT_FOUND);
    }

    res.json({ success: true, chat_id: result.rows[0].chat_id });
  } catch (err) {
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  }
});

chatsRouter.put(
  '/api/chats/:chat_id/messages/:message_id/flag',
  async (req: Request, res: Response) => {
    try {
      const userId = getUserIdFromHeader(req);
      if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

      const chatId = parseInt(paramString(req.params.chat_id), 10);
      const messageId = parseInt(paramString(req.params.message_id), 10);
      if (isNaN(chatId) || isNaN(messageId)) {
        return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_OR_MESSAGE_ID);
      }

      const result = await db.query(
        `UPDATE Message m
         SET is_flagged_by_user = NOT m.is_flagged_by_user
         FROM Chat c
         WHERE m.message_id = $1
           AND m.chat_id = $2
           AND c.chat_id = m.chat_id
           AND c.app_user_id = $3
           AND m.is_sent_by_user = FALSE
         RETURNING m.message_id, m.is_flagged_by_user`,
        [messageId, chatId, userId]
      );

      if (result.rows.length === 0) {
        return sendApiError(res, 404, ErrorCodes.MESSAGE_NOT_FOUND);
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      const { code, params } = mapPgErrorToCode(err);
      sendApiError(res, 500, code, params);
    }
  }
);

chatsRouter.post('/api/chats/:chat_id/messages', async (req: Request, res: Response) => {
  const client = await db.connect();

  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    const chatId = parseInt(paramString(req.params.chat_id), 10);
    if (isNaN(chatId)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);
    }

    const { encrypted_content, used_llm_id } = req.body ?? {};
    if (!encrypted_content || !used_llm_id) {
      return sendApiError(res, 400, ErrorCodes.REQUIRED_FIELDS_MISSING);
    }

    // Ensure chat belongs to the user.
    const chatCheck = await client.query(
      `SELECT 1 FROM Chat WHERE chat_id = $1 AND app_user_id = $2 AND is_hidden = FALSE`,
      [chatId, userId]
    );
    if (chatCheck.rows.length === 0) {
      return sendApiError(res, 403, ErrorCodes.FORBIDDEN);
    }

    const messageBodyCol = await getMessageBodyColumn(client);

    const usedLlmIdInt = parseInt(String(used_llm_id));
    if (isNaN(usedLlmIdInt)) {
      return sendApiError(res, 400, ErrorCodes.INVALID_USED_LLM_ID);
    }

    await client.query('BEGIN');

    // Serialize inserts within a chat so "previous message" is well-defined.
    await client.query(`SELECT 1 FROM Chat WHERE chat_id = $1 FOR UPDATE`, [chatId]);

    const parentColExists = await hasParentMessageIdColumn(client);
    const parentRes = await client.query<{ message_id: number }>(
      `SELECT message_id
       FROM Message
       WHERE chat_id = $1
       ORDER BY sent_time DESC, message_id DESC
       LIMIT 1`,
      [chatId]
    );
    const parentMessageId = parentRes.rows[0]?.message_id ?? null;

    // Store user message
    const userPlaintext = String(encrypted_content);
    const userEncrypted = encrypt(userPlaintext);
    if (!userEncrypted) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }
    const userInsertSql = parentColExists
      ? `INSERT INTO Message (chat_id, used_llm_id, ${messageBodyCol}, is_sent_by_user, parent_message_id)
         VALUES ($1, $2, $3, TRUE, $4)
         RETURNING message_id`
      : `INSERT INTO Message (chat_id, used_llm_id, ${messageBodyCol}, is_sent_by_user)
         VALUES ($1, $2, $3, TRUE)
         RETURNING message_id`;
    const userInsertParams = parentColExists
      ? [chatId, usedLlmIdInt, userEncrypted, parentMessageId]
      : [chatId, usedLlmIdInt, userEncrypted];
    const userIns = await client.query<{ message_id: string | number }>(userInsertSql, userInsertParams);
    const newUserMessageId = Number(userIns.rows[0]?.message_id);
    if (!Number.isFinite(newUserMessageId)) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }

    // Placeholder assistant response (real generation can be implemented via DB functions later).
    // DB constraint requires at least one letter and allows [[:alnum:][:punct:][:space:]].
    const assistantContent = 'Assistant response (placeholder).';
    const assistantEncrypted = encrypt(assistantContent);
    if (!assistantEncrypted) {
      await client.query('ROLLBACK');
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }
    const assistantInsertSql = parentColExists
      ? `INSERT INTO Message (chat_id, used_llm_id, ${messageBodyCol}, is_sent_by_user, parent_message_id)
         VALUES ($1, $2, $3, FALSE, $4)`
      : `INSERT INTO Message (chat_id, used_llm_id, ${messageBodyCol}, is_sent_by_user)
         VALUES ($1, $2, $3, FALSE)`;
    const assistantInsertParams = parentColExists
      ? [chatId, usedLlmIdInt, assistantEncrypted, newUserMessageId]
      : [chatId, usedLlmIdInt, assistantEncrypted];
    await client.query(assistantInsertSql, assistantInsertParams);

    await client.query('COMMIT');

    const result_after = await client.query(
      `SELECT
         m.message_id,
         m.${messageBodyCol} AS cipher_body,
         m.sent_time,
         m.is_sent_by_user,
         m.is_flagged_by_user,
         m.used_llm_id,
         lm.model_name AS used_llm_name
       FROM Message m
       LEFT JOIN LLM lm ON lm.llm_id = m.used_llm_id
       WHERE m.chat_id = $1
       ORDER BY m.sent_time ASC, m.message_id ASC`,
      [chatId]
    );

    res.status(201).json(
      result_after.rows.map((r: { cipher_body: string } & Record<string, unknown>) => ({
        message_id: r.message_id,
        sent_time: r.sent_time,
        is_sent_by_user: r.is_sent_by_user,
        is_flagged_by_user: r.is_flagged_by_user,
        used_llm_id: r.used_llm_id,
        used_llm_name: r.used_llm_name,
        encrypted_content: decrypt(r.cipher_body) ?? String(r.cipher_body ?? ''),
      }))
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const { code, params } = mapPgErrorToCode(err);
    sendApiError(res, 500, code, params);
  } finally {
    client.release();
  }
});
