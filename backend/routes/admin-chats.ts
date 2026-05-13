import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { decrypt } from '../services/encryption.js';
import { getMessageBodyColumn } from '../services/message-body-column.js';

export const adminChatsRouter = Router();

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

function parseOptionalIsoDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseOptionalInt(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function normalizeSortDir(raw: unknown): 'asc' | 'desc' {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'asc' ? 'asc' : 'desc';
}

function normalizeChatSortKey(
  raw: unknown
):
  | 'last_message_time'
  | 'start_time'
  | 'message_count'
  | 'flagged_count'
  | 'email'
  | 'title' {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (
    v === 'last_message_time' ||
    v === 'start_time' ||
    v === 'message_count' ||
    v === 'flagged_count' ||
    v === 'email' ||
    v === 'title'
  ) {
    return v;
  }
  return 'last_message_time';
}

function buildTimeRangeFilter(
  from: Date | null,
  to: Date | null,
  params: unknown[],
  columnSql: string
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const nextParams = [...params];
  if (from) {
    nextParams.push(from.toISOString());
    clauses.push(`${columnSql} >= $${nextParams.length}`);
  }
  if (to) {
    nextParams.push(to.toISOString());
    clauses.push(`${columnSql} < $${nextParams.length}`);
  }
  return {
    sql: clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`,
    params: nextParams,
  };
}

/** Rewire `$1`, `$2`, … placeholders to start at `startIndex` (1-based). */
function renumberSqlPlaceholders(sql: string, startIndex: number): string {
  return sql.replace(/\$(\d+)/g, (_, n) => `$${startIndex + Number(n) - 1}`);
}

const MESSAGE_TIMESERIES_GRAIN_SQL = {
  hour: { trunc: 'hour', step: `interval '1 hour'` },
  day: { trunc: 'day', step: `interval '1 day'` },
  week: { trunc: 'week', step: `interval '1 week'` },
  month: { trunc: 'month', step: `interval '1 month'` },
} as const;

type MessageTimeseriesGrain = keyof typeof MESSAGE_TIMESERIES_GRAIN_SQL;

function pickMessageTimeseriesGrain(from: Date, to: Date): MessageTimeseriesGrain {
  const spanMs = to.getTime() - from.getTime();
  const dayMs = 86400000;
  // For a few days (incl. single calendar day and "last 7 days"), bucket by hour so `sent_time` is visible.
  if (spanMs <= 7 * dayMs) return 'hour';
  // Daily through ~two calendar months (covers "last 30", full months, DST) before coarser weeks.
  if (spanMs <= 62 * dayMs) return 'day';
  if (spanMs <= 120 * dayMs) return 'week';
  return 'month';
}

adminChatsRouter.get('/api/admin/chats/overview', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const from = parseOptionalIsoDate(req.query.from);
    const to = parseOptionalIsoDate(req.query.to);
    const flaggedOnly = String(req.query.flagged_only ?? '').toLowerCase() === 'true';

    // Time-based message counts for fixed periods (relative to "now").
    const messageCounts = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM message WHERE sent_time >= date_trunc('day', CURRENT_TIMESTAMP))  AS messages_today,
         (SELECT COUNT(*)::int FROM message WHERE sent_time >= date_trunc('week', CURRENT_TIMESTAMP)) AS messages_week,
         (SELECT COUNT(*)::int FROM message WHERE sent_time >= date_trunc('month', CURRENT_TIMESTAMP)) AS messages_month,
         (SELECT COUNT(*)::int FROM message WHERE sent_time >= date_trunc('year', CURRENT_TIMESTAMP))  AS messages_year,
         (SELECT COUNT(*)::int FROM message WHERE is_flagged_by_user = TRUE) AS flagged_total`
    );

    const rangeFilter = buildTimeRangeFilter(from, to, [], 'm.sent_time');
    const flaggedSql = flaggedOnly ? ` AND m.is_flagged_by_user = TRUE` : '';

    const llmUsage = await db.query(
      `SELECT
         m.used_llm_id,
         COALESCE(l.model_name, CONCAT('LLM ', m.used_llm_id)) AS used_llm_name,
         COUNT(*)::int AS message_count
       FROM message m
       LEFT JOIN llm l ON l.llm_id = m.used_llm_id
       WHERE 1=1${rangeFilter.sql}${flaggedSql}
       GROUP BY m.used_llm_id, used_llm_name
       ORDER BY message_count DESC, used_llm_name ASC`,
      rangeFilter.params
    );

    // LLM answer-time stats (assistant message time minus immediately preceding user message time).
    // Scope: assistant messages within the selected range; only count pairs where the immediately
    // previous message in the same chat is a user message. If flagged_only=true, only include
    // assistant messages flagged by the user.
    const answerTimeRangeFilter = buildTimeRangeFilter(from, to, [flaggedOnly], 'm.sent_time');
    const answerTimeStats = await db.query(
      `WITH ordered AS (
         SELECT
           m.chat_id,
           m.sent_time,
           m.is_sent_by_user,
           m.is_flagged_by_user,
           LAG(m.is_sent_by_user) OVER (PARTITION BY m.chat_id ORDER BY m.sent_time ASC, m.message_id ASC) AS prev_is_user,
           LAG(m.sent_time) OVER (PARTITION BY m.chat_id ORDER BY m.sent_time ASC, m.message_id ASC) AS prev_sent_time
         FROM message m
         WHERE 1=1${answerTimeRangeFilter.sql}
       ),
       paired AS (
         SELECT (EXTRACT(EPOCH FROM (sent_time - prev_sent_time)) * 1000.0) AS answer_ms
         FROM ordered
         WHERE is_sent_by_user = FALSE
           AND prev_is_user = TRUE
           AND prev_sent_time IS NOT NULL
           AND ($1::boolean = FALSE OR is_flagged_by_user = TRUE)
       )
       SELECT
         MIN(answer_ms)::int AS min_ms,
         MAX(answer_ms)::int AS max_ms,
         AVG(answer_ms)::int AS avg_ms,
         COUNT(*)::int AS n
       FROM paired
       WHERE answer_ms IS NOT NULL
         AND answer_ms >= 0`,
      answerTimeRangeFilter.params
    );

    const totalInRange = await db.query(
      `SELECT COUNT(*)::int AS messages_in_range
       FROM message m
       WHERE 1=1${rangeFilter.sql}${flaggedSql}`,
      rangeFilter.params
    );

    let messages_over_time: {
      grain: MessageTimeseriesGrain;
      points: { period_start: string; message_count: number }[];
    } | null = null;

    if (from && to && from.getTime() < to.getTime()) {
      const grain = pickMessageTimeseriesGrain(from, to);
      const { trunc, step } = MESSAGE_TIMESERIES_GRAIN_SQL[grain];
      const ts = await db.query(
        `WITH series AS (
           SELECT generate_series(
             date_trunc('${trunc}', $1::timestamptz),
             date_trunc('${trunc}', $2::timestamptz - interval '1 microsecond'),
             ${step}
           ) AS bucket_start
         ),
         counts AS (
           SELECT date_trunc('${trunc}', m.sent_time) AS bucket_start, COUNT(*)::int AS message_count
           FROM message m
           WHERE m.sent_time >= $1::timestamptz
             AND m.sent_time < $2::timestamptz
             AND ($3::boolean = FALSE OR m.is_flagged_by_user = TRUE)
           GROUP BY 1
         )
         SELECT s.bucket_start, COALESCE(c.message_count, 0)::int AS message_count
         FROM series s
         LEFT JOIN counts c USING (bucket_start)
         ORDER BY s.bucket_start`,
        [from.toISOString(), to.toISOString(), flaggedOnly]
      );
      messages_over_time = {
        grain,
        points: ts.rows.map((r: { bucket_start: Date; message_count: number }) => ({
          period_start:
            r.bucket_start instanceof Date ? r.bucket_start.toISOString() : String(r.bucket_start),
          message_count: r.message_count ?? 0,
        })),
      };
    }

    res.json({
      range: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      messages: {
        today: messageCounts.rows[0]?.messages_today ?? 0,
        week: messageCounts.rows[0]?.messages_week ?? 0,
        month: messageCounts.rows[0]?.messages_month ?? 0,
        year: messageCounts.rows[0]?.messages_year ?? 0,
        flagged_total: messageCounts.rows[0]?.flagged_total ?? 0,
        in_range: totalInRange.rows[0]?.messages_in_range ?? 0,
      },
      messages_over_time,
      answer_time_stats: {
        min_ms: answerTimeStats.rows[0]?.min_ms ?? null,
        max_ms: answerTimeStats.rows[0]?.max_ms ?? null,
        avg_ms: answerTimeStats.rows[0]?.avg_ms ?? null,
        n: answerTimeStats.rows[0]?.n ?? 0,
      },
      llm_usage: llmUsage.rows,
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

adminChatsRouter.get('/api/admin/chats/bounds', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const flaggedOnly = String(req.query.flagged_only ?? '').toLowerCase() === 'true';
    const where = flaggedOnly ? `WHERE m.is_flagged_by_user = TRUE` : '';

    const r = await db.query(
      `
      SELECT
        MIN(m.sent_time) AS min_sent_time,
        MAX(m.sent_time) AS max_sent_time
      FROM message m
      ${where}
      `
    );

    res.json({
      min_sent_time: r.rows[0]?.min_sent_time ?? null,
      max_sent_time: r.rows[0]?.max_sent_time ?? null,
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

adminChatsRouter.get('/api/admin/chats', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const from = parseOptionalIsoDate(req.query.from);
    const to = parseOptionalIsoDate(req.query.to);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const flaggedOnly = String(req.query.flagged_only ?? '').toLowerCase() === 'true';
    const targetAppUserId = parseOptionalInt(req.query.app_user_id);
    const usedLlmIdFilter = parseOptionalInt(req.query.used_llm_id);

    const limitRaw = req.query.limit;
    const fetchAllChats =
      String(limitRaw ?? '')
        .trim()
        .toLowerCase() === 'all';
    const limit = fetchAllChats
      ? null
      : Math.max(1, Math.min(parseOptionalInt(req.query.limit) ?? 50, 500));
    const offset = fetchAllChats ? 0 : Math.max(0, parseOptionalInt(req.query.offset) ?? 0);

    const sortKey = normalizeChatSortKey(req.query.sort);
    const sortDir = normalizeSortDir(req.query.dir);

    const params: unknown[] = [];
    const where: string[] = [`c.is_hidden = FALSE`];

    if (targetAppUserId && targetAppUserId > 0) {
      params.push(targetAppUserId);
      where.push(`c.app_user_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(c.chat_title ILIKE $${params.length} OR au.email ILIKE $${params.length})`);
    }

    // We scope chat list to chats that have at least one message in range if a range is provided.
    const rangeFilter = buildTimeRangeFilter(from, to, params, 'm.sent_time');
    params.splice(0, params.length, ...rangeFilter.params);

    const rangeJoinCondition =
      from || to ? `AND 1=1${rangeFilter.sql.replaceAll(' AND ', ' AND ')}` : '';

    if (usedLlmIdFilter && usedLlmIdFilter > 0) {
      params.push(usedLlmIdFilter);
      const llmIdPlaceholder = params.length;
      const existsRange = buildTimeRangeFilter(from, to, [], 'mf.sent_time');
      const existsRangeSql = renumberSqlPlaceholders(existsRange.sql, params.length + 1);
      params.push(...existsRange.params);
      where.push(
        `EXISTS (
          SELECT 1 FROM message mf
          WHERE mf.chat_id = c.chat_id
            AND mf.is_sent_by_user = FALSE
            AND mf.used_llm_id = $${llmIdPlaceholder}
            AND 1=1${existsRangeSql}
        )`
      );
    }

    const having = flaggedOnly ? `HAVING SUM(CASE WHEN m.is_flagged_by_user THEN 1 ELSE 0 END) > 0` : '';

    const orderBy = (() => {
      const dir = sortDir.toUpperCase();
      if (sortKey === 'email') return `au.email ${dir}, c.chat_id DESC`;
      if (sortKey === 'title') return `COALESCE(c.chat_title, '') ${dir}, c.chat_id DESC`;
      if (sortKey === 'start_time') return `start_time ${dir} NULLS LAST, c.chat_id DESC`;
      if (sortKey === 'message_count') return `message_count ${dir}, c.chat_id DESC`;
      if (sortKey === 'flagged_count') return `flagged_count ${dir}, c.chat_id DESC`;
      return `last_message_time ${dir} NULLS LAST, c.chat_id DESC`;
    })();

    // Distinct LLMs used (assistant messages) within the same timeframe as the listing.
    // Extra placeholders apply only to the list query (not the total count query).
    const llmListRange = buildTimeRangeFilter(from, to, [], 'm_inner.sent_time');
    const llmListRangeSql = renumberSqlPlaceholders(llmListRange.sql, params.length + 1);
    const llmAggSql = `
      (
        SELECT COALESCE(
          json_agg(
            json_build_object('used_llm_id', u.used_llm_id, 'used_llm_name', u.used_llm_name)
            ORDER BY u.used_llm_name
          ),
          '[]'::json
        )
        FROM (
          SELECT DISTINCT m_inner.used_llm_id,
            COALESCE(l_inner.model_name, CONCAT('LLM ', m_inner.used_llm_id::text)) AS used_llm_name
          FROM message m_inner
          LEFT JOIN llm l_inner ON l_inner.llm_id = m_inner.used_llm_id
          WHERE m_inner.chat_id = c.chat_id
            AND m_inner.is_sent_by_user = FALSE
            AND m_inner.used_llm_id IS NOT NULL
            AND 1=1${llmListRangeSql}
        ) u
      ) AS llms_used`;

    const listParams = [...params, ...llmListRange.params];

    const limitOffsetSql = fetchAllChats
      ? ''
      : `
      LIMIT $${listParams.length + 1}
      OFFSET $${listParams.length + 2}`;

    // If a time range is provided, join messages within that range (so counts reflect the selected timeframe).
    const sql = `
      SELECT
        c.chat_id,
        c.chat_title AS title,
        COALESCE(MIN(m.sent_time), c.modified_at_time) AS start_time,
        c.app_user_id,
        au.email AS user_email,
        MAX(m.sent_time) AS last_message_time,
        COUNT(m.message_id)::int AS message_count,
        SUM(CASE WHEN m.is_flagged_by_user THEN 1 ELSE 0 END)::int AS flagged_count,
        ${llmAggSql}
      FROM chat c
      JOIN app_user au ON au.app_user_id = c.app_user_id
      JOIN message m ON m.chat_id = c.chat_id ${rangeJoinCondition}
      WHERE ${where.join(' AND ')}
      GROUP BY c.chat_id, c.chat_title, c.modified_at_time, c.app_user_id, au.email
      ${having}
      ORDER BY ${orderBy}${limitOffsetSql}
    `;

    const sqlParams = fetchAllChats ? listParams : [...listParams, limit, offset];
    const rows = await db.query(sql, sqlParams);

    // Total for pagination (same filters).
    const total = await db.query(
      `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT c.chat_id
        FROM chat c
        JOIN app_user au ON au.app_user_id = c.app_user_id
        JOIN message m ON m.chat_id = c.chat_id ${rangeJoinCondition}
        WHERE ${where.join(' AND ')}
        GROUP BY c.chat_id
        ${having}
      ) x
      `,
      params
    );

    res.json({
      limit: fetchAllChats ? 'all' : limit,
      offset: fetchAllChats ? 0 : offset,
      total: total.rows[0]?.total ?? 0,
      rows: rows.rows,
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

adminChatsRouter.get('/api/admin/chats/:chat_id/messages', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);
    if (!(await isAdminUser(userId))) return sendApiError(res, 403, ErrorCodes.PERMISSION_DENIED);

    const chatId = parseOptionalInt(req.params.chat_id);
    if (!chatId || chatId <= 0) return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);

    const from = parseOptionalIsoDate(req.query.from);
    const to = parseOptionalIsoDate(req.query.to);
    const onlyFlagged = String(req.query.flagged_only ?? '').toLowerCase() === 'true';
    const sortDir = normalizeSortDir(req.query.dir);

    const baseParams: unknown[] = [chatId];
    const rangeFilter = buildTimeRangeFilter(from, to, baseParams, 'm.sent_time');

    const flaggedClause = onlyFlagged ? ` AND m.is_flagged_by_user = TRUE` : '';

    const chatMeta = await db.query(
      `SELECT
         c.chat_id,
         c.chat_title AS title,
         COALESCE(fm.first_message_time, c.modified_at_time) AS start_time,
         c.app_user_id,
         au.email AS user_email
       FROM chat c
       JOIN app_user au ON au.app_user_id = c.app_user_id
       LEFT JOIN LATERAL (
         SELECT MIN(m.sent_time) AS first_message_time
         FROM message m
         WHERE m.chat_id = c.chat_id
       ) fm ON TRUE
       WHERE c.chat_id = $1
         AND c.is_hidden = FALSE`,
      [chatId]
    );
    if (chatMeta.rows.length === 0) return sendApiError(res, 404, ErrorCodes.CHAT_NOT_FOUND);

    const messageBodyCol = await getMessageBodyColumn();
    const messages = await db.query(
      `SELECT
         m.message_id,
         m.${messageBodyCol} AS cipher_body,
         m.sent_time,
         m.is_sent_by_user,
         m.is_flagged_by_user,
         m.used_llm_id,
         lm.model_name AS used_llm_name
       FROM message m
       LEFT JOIN llm lm ON lm.llm_id = m.used_llm_id
       WHERE m.chat_id = $1${rangeFilter.sql}${flaggedClause}
       ORDER BY m.sent_time ${sortDir.toUpperCase()}, m.message_id ${sortDir.toUpperCase()}`,
      rangeFilter.params
    );

    res.json({
      chat: chatMeta.rows[0],
      range: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      rows: messages.rows.map((r: { cipher_body: string } & Record<string, unknown>) => ({
        message_id: r.message_id,
        sent_time: r.sent_time,
        is_sent_by_user: r.is_sent_by_user,
        is_flagged_by_user: r.is_flagged_by_user,
        used_llm_id: r.used_llm_id,
        used_llm_name: r.used_llm_name,
        encrypted_content: decrypt(r.cipher_body) ?? String(r.cipher_body ?? ''),
      })),
    });
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, ErrorCodes.DATABASE_ERROR);
  }
});

