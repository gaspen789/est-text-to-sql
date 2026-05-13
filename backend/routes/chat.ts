import { Router, type Request, type Response } from 'express';
import { streamText, stepCountIs } from 'ai';
import { db } from '../db/index.js';
import { ErrorCodes } from '../errors/codes.js';
import { sendApiError } from '../errors/respond.js';
import { createExternalPool, type ExternalDbmsCode } from '../services/external-db.js';
import { buildSystemPrompt } from '../services/system-prompt.js';
import {
  buildAccessibleSchemaMarkdown,
  buildTools,
  fetchDescribeRelation,
  type DatabaseEntry,
} from '../services/tools.js';
import { createLLMProvider } from '../services/llm-provider.js';
import { refreshChatTitleIfPlaceholder } from '../services/chat-title.js';
import { decrypt, encrypt } from '../services/encryption.js';
import { getMessageBodyColumn } from '../services/message-body-column.js';
import { hasParentMessageIdColumn } from '../services/parent-message-id-column.js';
import { getChatUserFacingErrors, resolveChatUiLocale } from '../lib/chat-ui-translations.js';

export const chatRouter = Router();

/** Temporary: skip AI SDK and return a placeholder stream (set to `false` to restore real LLM). */
const MOCK_LLM_RESPONSE = false;

/** Send debug snapshot headers to the client. Disable in production. */
const DEBUG_SNAPSHOT_HEADERS = process.env.NODE_ENV !== 'production';

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

/**
 * For regular users, database_connection_credential.username must match the USER GROUP NAME
 * (not the 5-char user_group_code used by access_right).
 */
async function fetchUserGroupCredentialUsernames(userId: number): Promise<string[]> {
  const result = await db.query<{ user_group_name: string }>(
    `SELECT ug.name AS user_group_name
     FROM app_user_group_member augm
     JOIN user_group ug USING (user_group_code)
     WHERE augm.app_user_id = $1`,
    [userId]
  );
  return result.rows
    .map((r) => String(r.user_group_name ?? '').trim())
    .filter((n) => n.length > 0);
}

export type AllowedTable = {
  database_name: string;
  schema_name: string;
  table_name: string;
};

type ActiveCredentialRow = {
  database_id: number;
  database_name: string;
  description_for_llm: string | null;
  database_connection_credential_id: number;
  encrypted_host_name: string;
  port: number;
  encrypted_username: string;
  encrypted_password: string;
  is_admin: boolean | null;
  dbms_code: ExternalDbmsCode | null;
};

function resolveAllowedCredentials(
  rows: ActiveCredentialRow[],
  opts: { admin: boolean; groupNames: string[] }
): ActiveCredentialRow[] {
  // Rows are ordered DESC by credential id; we may return multiple matches.
  const out: ActiveCredentialRow[] = [];
  for (const r of rows) {
    const username = (decrypt(r.encrypted_username) ?? r.encrypted_username ?? '').trim();
    if (!username) continue;

    if (opts.admin) {
      if (username === 'app_admin') out.push(r);
      continue;
    }

    if (opts.groupNames.includes(username)) out.push(r);
  }

  // De-dupe by credential id (defensive) while preserving order.
  const seen = new Set<number>();
  return out.filter((r) => {
    const id = Number(r.database_connection_credential_id);
    if (!Number.isFinite(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Resolve which relations (tables and views) a user may access, based on access_right grants
 * through their user groups. Admins bypass and get all active relations.
 */
async function fetchAllowedTables(userId: number): Promise<AllowedTable[]> {
  const admin = await isAdminUser(userId);
  const result = await db.query(
    `
    WITH member_groups AS (
      SELECT user_group_code
      FROM app_user_group_member
      WHERE app_user_id = $1
    ),
    granted AS (
      SELECT r.resource_id
      FROM resource r
      WHERE $2::boolean = TRUE
        AND r.is_active = TRUE
      UNION
      SELECT DISTINCT ar.resource_id
      FROM access_right ar
      INNER JOIN member_groups mg ON mg.user_group_code = ar.user_group_code
      WHERE $2::boolean = FALSE
    ),
    from_table AS (
      SELECT rd.name AS database_name, rs.name AS schema_name, rt.name AS table_name
      FROM granted g
      INNER JOIN resource_table rt ON rt.table_id = g.resource_id
      INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
      INNER JOIN resource_schema rs ON rs.schema_id = rt.schema_id
      INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
      INNER JOIN resource_database rd ON rd.database_id = rs.database_id
      INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
    ),
    from_schema AS (
      SELECT rd.name AS database_name, rs.name AS schema_name, rt.name AS table_name
      FROM granted g
      INNER JOIN resource_schema rs ON rs.schema_id = g.resource_id
      INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
      INNER JOIN resource_database rd ON rd.database_id = rs.database_id
      INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
      INNER JOIN resource_table rt ON rt.schema_id = rs.schema_id
      INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
    ),
    from_database AS (
      SELECT rd.name AS database_name, rs.name AS schema_name, rt.name AS table_name
      FROM granted g
      INNER JOIN resource_database rd ON rd.database_id = g.resource_id
      INNER JOIN resource r_d ON r_d.resource_id = rd.database_id AND r_d.is_active = TRUE
      INNER JOIN resource_schema rs ON rs.database_id = rd.database_id
      INNER JOIN resource r_s ON r_s.resource_id = rs.schema_id AND r_s.is_active = TRUE
      INNER JOIN resource_table rt ON rt.schema_id = rs.schema_id
      INNER JOIN resource r_t ON r_t.resource_id = rt.table_id AND r_t.is_active = TRUE
    )
    SELECT DISTINCT database_name, schema_name, table_name
    FROM (
      SELECT * FROM from_table
      UNION ALL
      SELECT * FROM from_schema
      UNION ALL
      SELECT * FROM from_database
    ) combined
    ORDER BY database_name, schema_name, table_name
    `,
    [userId, admin]
  );
  return result.rows as AllowedTable[];
}

async function insertMessageWithComputedParent(opts: {
  chatId: number;
  llmId: number;
  messageBodyCol: string;
  encryptedBody: string;
  isSentByUser: boolean;
}): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Serialize inserts within a chat so "previous message" is well-defined.
    await client.query(`SELECT 1 FROM Chat WHERE chat_id = $1 FOR UPDATE`, [opts.chatId]);

    const parentColExists = await hasParentMessageIdColumn(client);
    const parentRes = await client.query<{ message_id: number }>(
      `SELECT message_id
       FROM Message
       WHERE chat_id = $1
       ORDER BY sent_time DESC, message_id DESC
       LIMIT 1`,
      [opts.chatId]
    );
    const parentMessageId = parentRes.rows[0]?.message_id ?? null;

    const insertSql = parentColExists
      ? `INSERT INTO Message (chat_id, used_llm_id, ${opts.messageBodyCol}, is_sent_by_user, parent_message_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING message_id`
      : `INSERT INTO Message (chat_id, used_llm_id, ${opts.messageBodyCol}, is_sent_by_user)
         VALUES ($1, $2, $3, $4)
         RETURNING message_id`;

    const insertParams = parentColExists
      ? [opts.chatId, opts.llmId, opts.encryptedBody, opts.isSentByUser, parentMessageId]
      : [opts.chatId, opts.llmId, opts.encryptedBody, opts.isSentByUser];

    const ins = await client.query<{ message_id: string | number }>(insertSql, insertParams);
    const messageId = Number(ins.rows[0]?.message_id);
    if (!Number.isFinite(messageId)) throw new Error('Failed to insert message (no message_id returned)');

    await client.query('COMMIT');
    return messageId;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

chatRouter.post('/api/chat', async (req: Request, res: Response) => {
  const requestStartedAtMs = Date.now();
  const streamDebugId = `chat:${Math.random().toString(16).slice(2)}:${requestStartedAtMs}`;

  const logPrefix = () =>
    `[${streamDebugId}] /api/chat chatId=${String(req.body?.chat_id ?? '?')} userId=${String(
      req.headers['x-user-id'] ?? '?'
    )}`;

  // Log request lifecycle so we can distinguish "LLM stopped" vs "client disconnected".
  let reqAborted = false;
  req.on('aborted', () => {
    reqAborted = true;
    console.warn(`${logPrefix()} request aborted by client`);
  });
  res.on('close', () => {
    // close fires when the underlying connection is closed (may happen before finish)
    console.warn(
      `${logPrefix()} response close (writableEnded=${String(res.writableEnded)} headersSent=${String(
        res.headersSent
      )})`
    );
  });
  res.on('error', (e) => {
    console.error(`${logPrefix()} response error:`, e);
  });

  // 1. Auth
  const userId = getUserIdFromHeader(req);
  if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

  // 2. Validate body
  const { chat_id, llm_id, encrypted_content } = req.body ?? {};

  const chatId = typeof chat_id === 'number' ? chat_id : parseInt(String(chat_id ?? ''), 10);
  const llmId = typeof llm_id === 'number' ? llm_id : parseInt(String(llm_id ?? ''), 10);

  if (!Number.isFinite(chatId) || chatId <= 0) {
    return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_ID);
  }
  if (!Number.isFinite(llmId) || llmId <= 0) {
    return sendApiError(res, 400, ErrorCodes.INVALID_LLM_ID);
  }
  if (
    !encrypted_content ||
    typeof encrypted_content !== 'string' ||
    !encrypted_content.trim() ||
    !/[a-zA-Z0-9]/.test(encrypted_content)
  ) {
    return sendApiError(res, 400, ErrorCodes.INVALID_CHAT_CONTENT);
  }

  try {
    const chatUiLocale = resolveChatUiLocale(req);
    const chatErrors = getChatUserFacingErrors(chatUiLocale);

    // 3. Verify chat belongs to user
    const chatCheck = await db.query(
      `SELECT 1 FROM Chat WHERE chat_id = $1 AND app_user_id = $2 AND is_hidden = FALSE`,
      [chatId, userId]
    );
    if (chatCheck.rows.length === 0) return sendApiError(res, 403, ErrorCodes.FORBIDDEN);

    const messageBodyCol = await getMessageBodyColumn();

    // 4. Resolve LLM: model string, provider company name, and (optionally) api key.
    // In mock mode, we intentionally DO NOT require an API key so any active LLM can be selected.
    const llmResult = await db.query(
      MOCK_LLM_RESPONSE
        ? `SELECT l.model_name, c.name AS llm_group_company
           FROM llm l
           JOIN llm_group lg ON lg.llm_group_id = l.llm_group_id
           JOIN company c    ON c.company_code = lg.company_code
           WHERE l.llm_id = $1
             AND l.is_active = TRUE
           LIMIT 1`
        : `SELECT l.model_name, c.name AS llm_group_company, la.encrypted_api_key AS api_key
           FROM llm l
           JOIN llm_group lg ON lg.llm_group_id = l.llm_group_id
           JOIN company c    ON c.company_code = lg.company_code
           JOIN llm_api la   ON la.llm_id = l.llm_id
           WHERE l.llm_id = $1
             AND l.is_active = TRUE
             AND la.is_active = TRUE
           ORDER BY la.llm_api_id DESC
           LIMIT 1`,
      [llmId]
    );

    if (llmResult.rows.length === 0) {
      return sendApiError(res, 400, ErrorCodes.LLM_NOT_FOUND_OR_INACTIVE);
    }

    const llmRow = llmResult.rows[0] as {
      model_name: string;
      llm_group_company: string;
      api_key?: string | null;
    };
    const model_name = llmRow.model_name;
    const llm_group_company = llmRow.llm_group_company;
    const api_key = decrypt(llmRow.api_key ?? null);
    if (!MOCK_LLM_RESPONSE && !api_key) {
      return sendApiError(res, 400, ErrorCodes.NO_ACTIVE_LLM_API);
    }

    // 5. Fetch message history for context (oldest first)
    const historyResult = await db.query(
      `SELECT ${messageBodyCol} AS cipher_body, is_sent_by_user
       FROM Message
       WHERE chat_id = $1
       ORDER BY sent_time ASC, message_id ASC`,
      [chatId]
    );

    const history = (historyResult.rows as Array<{ cipher_body: string; is_sent_by_user: boolean }>).map(
      (row) => ({
      role: row.is_sent_by_user ? ('user' as const) : ('assistant' as const),
      content: decrypt(row.cipher_body) ?? String(row.cipher_body ?? ''),
    })
    );

    // 6. Persist the user message before streaming starts (id links sql_query rows to this prompt).
    const userPlaintext = encrypted_content.trim();
    const userEncrypted = encrypt(userPlaintext);
    if (!userEncrypted) {
      return sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }
    const triggerMessageId = await insertMessageWithComputedParent({
      chatId,
      llmId,
      messageBodyCol,
      encryptedBody: userEncrypted,
      isSentByUser: true,
    });

    // 7. Resolve which tables the user may access (group-based + admin bypass).
    const admin = await isAdminUser(userId);
    const groupNames = admin ? [] : await fetchUserGroupCredentialUsernames(userId);
    const allowedTables = await fetchAllowedTables(userId);
    const allowedDbNames = [...new Set(allowedTables.map((t) => t.database_name))];

    if (allowedDbNames.length === 0) {
      return sendApiError(res, 403, ErrorCodes.NO_DATABASES_ACCESSIBLE);
    }

    // 8. Fetch active connection credentials for the databases the user has grants on.
    //    IMPORTANT: Credentials are selected server-side based on the requester:
    //      - admins: must use the 'app_admin' database user
    //      - non-admins: may only use database users whose name matches one of their user group NAMES
    const dbResult = await db.query(
      `SELECT
         rd.database_id,
         rd.name                  AS database_name,
         r.description_for_LLM   AS description_for_llm,
         dcc.database_connection_credential_id,
         dcc.encrypted_host_name,
         dcc.port,
         dcc.encrypted_username,
         dcc.encrypted_password,
         dcc.is_admin,
         v.dbms_code
       FROM resource_database rd
       JOIN resource r
         ON r.resource_id = rd.database_id
        AND r.is_active = TRUE
       JOIN database_connection_credential dcc
         ON dcc.database_id = rd.database_id
        AND dcc.is_active = TRUE
       LEFT JOIN dbms_version v ON v.dbms_version_id = dcc.dbms_version_id
       WHERE rd.name = ANY($1::text[])`,
      [allowedDbNames]
    );

    if (dbResult.rows.length === 0) {
      return sendApiError(res, 403, ErrorCodes.NO_DATABASES_ACCESSIBLE);
    }

    // 9. Build databaseMap — key = database_name (human-readable, shown to LLM as database_id)
    const databaseMap = new Map<string, DatabaseEntry>();
    const byDbName = new Map<string, ActiveCredentialRow[]>();
    for (const r of dbResult.rows as ActiveCredentialRow[]) {
      const key = String(r.database_name ?? '').trim();
      if (!key) continue;
      const arr = byDbName.get(key);
      if (arr) arr.push(r);
      else byDbName.set(key, [r]);
    }

    for (const [databaseName, rows] of byDbName.entries()) {
      rows.sort(
        (a, b) =>
          Number(b.database_connection_credential_id) - Number(a.database_connection_credential_id)
      );

      const picked = resolveAllowedCredentials(rows, { admin, groupNames });
      if (picked.length === 0) continue;

      const pools = await Promise.all(
        picked.map(async (p) => {
          const dbms = (p.dbms_code ?? 'PGS') as ExternalDbmsCode;
          return createExternalPool({
            dbms,
            host: decrypt(p.encrypted_host_name) ?? p.encrypted_host_name,
            port: Number(p.port),
            database: databaseName,
            serviceName: databaseName,
            user: decrypt(p.encrypted_username) ?? p.encrypted_username,
            password: decrypt(p.encrypted_password) ?? p.encrypted_password,
          });
        })
      );

      databaseMap.set(databaseName, {
        name: databaseName,
        description: picked[0]?.description_for_llm ?? '',
        pools,
      });
    }

    if (databaseMap.size === 0) {
      return sendApiError(res, 403, ErrorCodes.NO_DATABASES_ACCESSIBLE);
    }

    // 10. Fetch user global instruction, preferred LLM language, and build services
    const userInstructionResult = await db.query(
      `SELECT au.llm_custom_global_instruction,
              au.preferred_llm_language,
              la.language_name AS preferred_language_name
       FROM app_user au
       LEFT JOIN language_active la ON la.language_code = au.preferred_llm_language
       WHERE au.app_user_id = $1
       LIMIT 1`,
      [userId]
    );
    const userRow = userInstructionResult.rows[0] as
      | {
          llm_custom_global_instruction: string | null | undefined;
          preferred_llm_language: string | null | undefined;
          preferred_language_name: string | null | undefined;
        }
      | undefined;
    const llmCustomGlobalInstruction =
      (userRow?.llm_custom_global_instruction as string | null | undefined) ?? null;
    const preferredLlmLanguage = String(userRow?.preferred_llm_language ?? '').trim();

    const baseSystemPrompt = buildSystemPrompt(
      Array.from(databaseMap.entries()).map(([id, e]) => ({
        databaseId: id,
        name: e.name,
        description: e.description,
      })),
      preferredLlmLanguage
        ? {
            code: preferredLlmLanguage,
            name: userRow?.preferred_language_name ?? null,
          }
        : null
    );
    // Full **Accessible data model** is sent only on the first user turn (prefixed to that user
    // message, not persisted). Skipped on follow-ups to limit tokens and avoid re-querying metadata.
    const schemaMarkdown =
      history.length === 0 ? await buildAccessibleSchemaMarkdown(databaseMap, allowedTables) : '';

    const systemPrompt =
      llmCustomGlobalInstruction && String(llmCustomGlobalInstruction).trim()
        ? `## User global instruction\n\n${String(llmCustomGlobalInstruction).trim()}\n\n${baseSystemPrompt}`
        : baseSystemPrompt;

    const tools = buildTools(databaseMap, allowedTables, {
      chatId,
      triggerMessageId,
    });

    const userMessageContent =
      history.length === 0 && schemaMarkdown
        ? `${schemaMarkdown}\n\n---\n\n**User question:**\n\n${userPlaintext}`
        : userPlaintext;

    const messages = [...history, { role: 'user' as const, content: userMessageContent }];

    const stopWhen = stepCountIs(30);

    const providerIntrospection: {
      company: string;
      modelName: string;
      hasApiKey: boolean;
      providerFnCreated: boolean;
      providerFnName?: string;
      modelCreated: boolean;
      modelType?: string;
      modelKeys?: string[];
    } = {
      company: llm_group_company,
      modelName: model_name,
      hasApiKey: Boolean(api_key),
      providerFnCreated: false,
      modelCreated: false,
    };

    // In non-mock mode, construct the provider function + model early so we can snapshot
    // *exactly* what would be passed to streamText.
    const providerFn =
      !MOCK_LLM_RESPONSE && api_key ? createLLMProvider(llm_group_company, api_key) : null;
    if (providerFn) {
      providerIntrospection.providerFnCreated = true;
      providerIntrospection.providerFnName = providerFn.name || '(anonymous)';
    }

    const modelForStreamText =
      providerFn && !MOCK_LLM_RESPONSE ? providerFn(model_name) : null;
    if (modelForStreamText) {
      providerIntrospection.modelCreated = true;
      providerIntrospection.modelType = typeof modelForStreamText;
      try {
        providerIntrospection.modelKeys = Object.keys(modelForStreamText as Record<string, unknown>);
      } catch {
        providerIntrospection.modelKeys = ['<uninspectable>'];
      }
    }

    // Pre-flight log: show (sanitized) inputs the LLM would receive.
    // Intentionally does NOT include API keys, DB credentials, or tool execute functions.
    const llmInputSnapshot = {
      chatId,
      userId,
      llm: { llmId, mock: MOCK_LLM_RESPONSE },
      provider: providerIntrospection,
      userGlobalInstruction: llmCustomGlobalInstruction ? '<omitted>' : null,
      preferredLlmLanguage: preferredLlmLanguage || null,
      systemPrompt: '<omitted>',
      messages: '<omitted>',
      tools: {
        names: Object.keys(tools),
        meta: Object.fromEntries(
          Object.entries(tools).map(([name, t]) => [
            name,
            {
              // best-effort: these are not guaranteed by type, so keep it defensive
              description: (t as unknown as { description?: unknown }).description,
              inputSchemaType: typeof (t as unknown as { inputSchema?: unknown }).inputSchema,
            },
          ])
        ),
      },
      streamTextArgsPreview: {
        model: modelForStreamText ? '<server-side model instance>' : null,
        system: '<omitted>',
        messages: '<omitted>',
        tools: Object.keys(tools),
        stopWhen: { type: 'stepCountIs', steps: 10 },
      },
    };

    const corsExpose: string[] = ['X-Chat-Stream-Format'];

    if (DEBUG_SNAPSHOT_HEADERS) {

      const snapshotJson = JSON.stringify(llmInputSnapshot);
      const snapshotBase64 = Buffer.from(snapshotJson, 'utf8').toString('base64');

      const CHUNK_SIZE = 3500;
      const MAX_CHUNKS = 8;
      const chunks: string[] = [];
      for (let i = 0; i < snapshotBase64.length; i += CHUNK_SIZE) {
        chunks.push(snapshotBase64.slice(i, i + CHUNK_SIZE));
      }

      const truncated = chunks.length > MAX_CHUNKS;
      const sentChunks = truncated ? chunks.slice(0, MAX_CHUNKS) : chunks;

      if (!truncated && snapshotBase64.length <= 6000) {
        res.setHeader('X-LLM-Input-Snapshot', snapshotBase64);
        corsExpose.push('X-LLM-Input-Snapshot');
      }

      res.setHeader('X-LLM-Input-Snapshot-Chunks', String(sentChunks.length));
      corsExpose.push('X-LLM-Input-Snapshot-Chunks', 'X-LLM-Input-Snapshot-Truncated');
      for (let i = 0; i < sentChunks.length; i++) {
        const name = `X-LLM-Input-Snapshot-${i + 1}`;
        res.setHeader(name, sentChunks[i]);
        corsExpose.push(name);
      }

      res.setHeader('X-LLM-Input-Snapshot-Truncated', truncated ? 'true' : 'false');
    }

    res.setHeader('Access-Control-Expose-Headers', corsExpose.join(', '));

    const maybeRefreshTitleAfterFirstAssistant = async () => {
      try {
        const c = await db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM Message WHERE chat_id = $1 AND is_sent_by_user = FALSE`,
          [chatId]
        );
        if (Number(c.rows[0]?.n) !== 1) return;
        await refreshChatTitleIfPlaceholder({
          chatId,
          userId,
          model: modelForStreamText,
          mockLlm: MOCK_LLM_RESPONSE,
        });
      } catch (err) {
        console.error('refreshChatTitleIfPlaceholder:', err);
      }
    };

    // In mock mode, stop here (after all preparation) to verify everything is ready.
    if (MOCK_LLM_RESPONSE) {
      const placeholder = `Assistant response (placeholder) for ${llm_group_company} / ${model_name}.`;
      try {
        const assistantEncrypted = encrypt(placeholder);
        if (!assistantEncrypted) throw new Error('assistant message encryption failed');
        await insertMessageWithComputedParent({
          chatId,
          llmId,
          messageBodyCol,
          encryptedBody: assistantEncrypted,
          isSentByUser: false,
        });
        await maybeRefreshTitleAfterFirstAssistant();
      } catch (err) {
        console.error('Failed to save assistant message:', err);
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(placeholder);
      return;
    }

    // Must be set before streamText: onChunk may write immediately and would otherwise
    // flush headers without a JSON line-oriented content type.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Chat-Stream-Format', 'ndjson');
    // Ensure streaming starts immediately (avoid buffering proxies / Node/Express).
    // `flushHeaders` exists on Node's ServerResponse and is safe to call when present.
    res.flushHeaders?.();

    // 10. Stream (NDJSON: text + reasoning deltas; fixes multi-step tool runs where only the last step was persisted)
    const streamStartedAtMs = Date.now();
    let chunkCount = 0;
    let firstChunkAtMs: number | null = null;
    let lastChunkAtMs: number | null = null;
    let finishedEventSeen = false;
    console.info(
      `${logPrefix()} stream start (llmCompany=${llm_group_company} model=${model_name} mock=${String(
        MOCK_LLM_RESPONSE
      )})`
    );

    // Debug: log what we send to the LLM (avoid tools + secrets; truncate big payloads).
    if (DEBUG_SNAPSHOT_HEADERS) {
      try {
        console.log(`${logPrefix()} LLM request payload:`, JSON.stringify({
          provider: llm_group_company,
          model: model_name,
          system: String(systemPrompt ?? ''),
          messages: (messages ?? []).map((m) => ({
            role: (m as { role?: unknown }).role,
            content: String((m as { content?: unknown }).content ?? ''),
          })),
        }));
      } catch (e) {
        console.warn(`${logPrefix()} failed to log LLM payload:`, e);
      }
    }

    const result = streamText({
      model: modelForStreamText!,
      system: systemPrompt,
      messages,
      tools,
      stopWhen,
      onChunk: ({ chunk }) => {
        chunkCount += 1;
        const now = Date.now();
        if (firstChunkAtMs == null) {
          firstChunkAtMs = now;
          console.info(
            `${logPrefix()} first chunk after ${String(firstChunkAtMs - streamStartedAtMs)}ms (type=${
              (chunk as { type?: unknown }).type as string
            })`
          );
        }
        lastChunkAtMs = now;

        if (res.writableEnded) {
          // This can happen if the client disconnected mid-stream; we still want to see it.
          if (chunkCount <= 3 || chunkCount % 50 === 0) {
            console.warn(
              `${logPrefix()} skipping chunk write: response already ended (chunkCount=${String(
                chunkCount
              )}, type=${String((chunk as { type?: unknown }).type)})`
            );
          }
          return;
        }

        try {
          if (chunk.type === 'text-delta' && chunk.text) {
            res.write(`${JSON.stringify({ type: 'text', text: chunk.text })}\n`);
          } else if (chunk.type === 'reasoning-delta' && chunk.text) {
            res.write(`${JSON.stringify({ type: 'reasoning', text: chunk.text })}\n`);
          }
        } catch (e) {
          console.error(
            `${logPrefix()} failed writing chunk (chunkCount=${String(chunkCount)} type=${String(
              (chunk as { type?: unknown }).type
            )}):`,
            e
          );
        }
      },
      onStepFinish: (step) => {
        if (!DEBUG_SNAPSHOT_HEADERS) return;
        try {
          const s = step as unknown as Record<string, unknown>;
          console.log(`${logPrefix()} LLM step full context:`, JSON.stringify({
            system: systemPrompt,
            request: s.request,
          }));
        } catch (e) {
          console.warn(`${logPrefix()} failed to log step context:`, e);
        }
      },
      onFinish: async (event) => {
        finishedEventSeen = true;
        const finishedAtMs = Date.now();
        // AI SDK event shape varies by version/provider, so log defensively.
        const eventAny = event as unknown as Record<string, unknown>;
        const steps = Array.isArray((eventAny as { steps?: unknown }).steps)
          ? ((eventAny as { steps?: unknown }).steps as Array<unknown>)
          : [];
        const finishReason =
          (eventAny as { finishReason?: unknown }).finishReason ??
          (eventAny as { finish_reason?: unknown }).finish_reason ??
          null;
        const usage = (eventAny as { usage?: unknown }).usage ?? null;
        const warnings = (eventAny as { warnings?: unknown }).warnings ?? null;

        console.info(
          `${logPrefix()} onFinish after ${String(finishedAtMs - streamStartedAtMs)}ms (chunkCount=${String(
            chunkCount
          )}, steps=${String(steps.length)}, finishReason=${String(finishReason)})`
        );
        if (usage) console.info(`${logPrefix()} usage:`, usage);
        if (warnings) console.warn(`${logPrefix()} warnings:`, warnings);

        const summarizeStep = (step: unknown, idx: number) => {
          const s = (step ?? {}) as Record<string, unknown>;
          const textLen = typeof s.text === 'string' ? s.text.length : 0;
          const reasoningLen = typeof s.reasoningText === 'string' ? s.reasoningText.length : 0;

          const toolCallsRaw = s.toolCalls;
          const toolResultsRaw = s.toolResults;

          const toolCalls = Array.isArray(toolCallsRaw)
            ? toolCallsRaw
                .map((c) => {
                  const call = (c ?? {}) as Record<string, unknown>;
                  return {
                    toolName: String(call.toolName ?? call.name ?? '<unknown-tool>'),
                    toolCallId: call.toolCallId != null ? String(call.toolCallId) : undefined,
                  };
                })
                .slice(0, 20)
            : null;

          const toolResults = Array.isArray(toolResultsRaw)
            ? toolResultsRaw
                .map((r) => {
                  const rr = (r ?? {}) as Record<string, unknown>;
                  const resultPreview =
                    rr.result == null
                      ? null
                      : typeof rr.result === 'string'
                        ? `string(len=${rr.result.length})`
                        : Array.isArray(rr.result)
                          ? `array(len=${rr.result.length})`
                          : typeof rr.result === 'object'
                            ? `object(keys=${(() => {
                                try {
                                  return Object.keys(rr.result as Record<string, unknown>).length;
                                } catch {
                                  return 'unknown';
                                }
                              })()})`
                            : typeof rr.result;
                  return {
                    toolName: rr.toolName != null ? String(rr.toolName) : undefined,
                    toolCallId: rr.toolCallId != null ? String(rr.toolCallId) : undefined,
                    error: rr.error != null ? String(rr.error) : undefined,
                    resultPreview,
                  };
                })
                .slice(0, 20)
            : null;

          return {
            idx,
            keys: Object.keys(s).slice(0, 40),
            textLen,
            reasoningLen,
            toolCallsCount: Array.isArray(toolCallsRaw) ? toolCallsRaw.length : 0,
            toolResultsCount: Array.isArray(toolResultsRaw) ? toolResultsRaw.length : 0,
            toolCalls,
            toolResults,
          };
        };

        // Inspect last steps: helps diagnose finishReason=tool-calls / step cap endings.
        // Sanitized: does not print tool args/results, only names + sizes/previews.
        const lastN = 3;
        const start = Math.max(0, steps.length - lastN);
        const lastSteps = steps.slice(start).map((s, i) => summarizeStep(s, start + i));
        console.info(`${logPrefix()} lastSteps summary:`, lastSteps);

        const answerText = event.steps.map((s) => s.text).filter(Boolean).join('');
        const reasoningCombined = event.steps
          .map((s) => s.reasoningText)
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .join('\n\n')
          .trim();

        let persisted = answerText;
        if (reasoningCombined) {
          persisted = `<thinking>\n${reasoningCombined}\n</thinking>\n\n${answerText}`;
        }

        const finalText =
          persisted?.trim() && /[a-zA-Z0-9]/.test(persisted)
            ? persisted.trim()
            : chatErrors.unableToGenerate;
        try {
          const assistantEncrypted = encrypt(finalText);
          if (!assistantEncrypted) throw new Error('assistant message encryption failed');
          await insertMessageWithComputedParent({
            chatId,
            llmId,
            messageBodyCol,
            encryptedBody: assistantEncrypted,
            isSentByUser: false,
          });
          await maybeRefreshTitleAfterFirstAssistant();
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }
      },
    });

    const sendStreamError = (message: string) => {
      // The frontend understands `{ type: "error", message }` NDJSON lines.
      // Only attempt to write if the client is still connected and we haven't ended.
      if (reqAborted || res.writableEnded) return;
      try {
        res.write(`${JSON.stringify({ type: 'error', message })}\n`);
      } catch (e) {
        console.error(`${logPrefix()} failed writing stream error chunk:`, e);
      }
    };

    try {
      await result.consumeStream();
    } catch (streamErr) {
      console.error(
        `${logPrefix()} consumeStream threw after ${String(Date.now() - streamStartedAtMs)}ms (chunkCount=${String(
          chunkCount
        )}, finishedEventSeen=${String(finishedEventSeen)} reqAborted=${String(reqAborted)}):`,
        streamErr
      );

      // If the LLM/provider failed mid-stream, tell the user explicitly instead of
      // silently ending the stream (which looks like a "randomly stopped" answer).
      // Avoid sending this if the client disconnected.
      if (!reqAborted) {
        sendStreamError(chatErrors.llmStreamFailed);
      }
    }

    console.info(
      `${logPrefix()} stream consume completed after ${String(Date.now() - streamStartedAtMs)}ms (chunkCount=${String(
        chunkCount
      )}, finishedEventSeen=${String(finishedEventSeen)} firstChunkMs=${String(
        firstChunkAtMs == null ? null : firstChunkAtMs - streamStartedAtMs
      )} lastChunkMs=${String(
        lastChunkAtMs == null ? null : lastChunkAtMs - streamStartedAtMs
      )} resEnded=${String(res.writableEnded)} reqAborted=${String(reqAborted)})`
    );

    if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    console.error('POST /api/chat error:', err);
    if (!res.headersSent) {
      sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR);
    }
  }
});

/**
 * DEV-ONLY: Smoke-test DB connectivity without calling the LLM.
 * Builds schema preload metadata, samples one describe, and runs execute_query.
 * Disabled when NODE_ENV=production.
 */
if (process.env.NODE_ENV !== 'production') {
  chatRouter.post('/api/chat/preflight', async (req: Request, res: Response) => {
    const userId = getUserIdFromHeader(req);
    if (!userId) return sendApiError(res, 401, ErrorCodes.UNAUTHORIZED);

    try {
      const admin = await isAdminUser(userId);
      const groupNames = admin ? [] : await fetchUserGroupCredentialUsernames(userId);
      const dbResult = await db.query(
        `SELECT
           rd.database_id,
           rd.name                  AS database_name,
           r.description_for_LLM   AS description_for_llm,
           dcc.database_connection_credential_id,
           dcc.encrypted_host_name,
           dcc.port,
           dcc.encrypted_username,
           dcc.encrypted_password,
           dcc.is_admin,
           v.dbms_code
         FROM resource_database rd
         JOIN resource r
           ON r.resource_id = rd.database_id
          AND r.is_active = TRUE
         JOIN database_connection_credential dcc
           ON dcc.database_id = rd.database_id
          AND dcc.is_active = TRUE
         LEFT JOIN dbms_version v ON v.dbms_version_id = dcc.dbms_version_id`
      );

      if (dbResult.rows.length === 0) {
        return res.json({ ok: false, error: 'No accessible databases found.' });
      }

      const databaseMap = new Map<string, DatabaseEntry>();
      const byDbName = new Map<string, ActiveCredentialRow[]>();
      for (const r of dbResult.rows as ActiveCredentialRow[]) {
        const key = String(r.database_name ?? '').trim();
        if (!key) continue;
        const arr = byDbName.get(key);
        if (arr) arr.push(r);
        else byDbName.set(key, [r]);
      }

      for (const [databaseName, rows] of byDbName.entries()) {
        rows.sort(
          (a, b) =>
            Number(b.database_connection_credential_id) - Number(a.database_connection_credential_id)
        );

        const picked = resolveAllowedCredentials(rows, { admin, groupNames });
        if (picked.length === 0) continue;

        const pools = await Promise.all(
          picked.map(async (p) => {
            const dbms = (p.dbms_code ?? 'PGS') as ExternalDbmsCode;
            return createExternalPool({
              dbms,
              host: decrypt(p.encrypted_host_name) ?? p.encrypted_host_name,
              port: Number(p.port),
              database: databaseName,
              serviceName: databaseName,
              user: decrypt(p.encrypted_username) ?? p.encrypted_username,
              password: decrypt(p.encrypted_password) ?? p.encrypted_password,
            });
          })
        );

        databaseMap.set(databaseName, {
          name: databaseName,
          description: picked[0]?.description_for_llm ?? '',
          pools,
        });
      }

      if (databaseMap.size === 0) {
        return res.json({
          ok: false,
          error: admin
            ? "No databases have an active credential with username 'app_admin'."
            : 'No databases have an active credential matching your user group name(s).',
        });
      }

      const preflightAllowed = await fetchAllowedTables(userId);
      const tools = buildTools(databaseMap, preflightAllowed);
      const results: Record<string, { ok: boolean; data?: unknown; error?: string }> = {};

      const execOpts = { toolCallId: 'preflight', messages: [], abortSignal: undefined as never };
      const firstDbId = Array.from(databaseMap.keys())[0];

      // 1. Same schema markdown the LLM receives (metadata queries only)
      try {
        const md = await buildAccessibleSchemaMarkdown(databaseMap, preflightAllowed);
        results.schema_preload = { ok: true, data: { charLength: md.length } };
      } catch (e: unknown) {
        results.schema_preload = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      // 2. describe_relation — first granted relation (if any)
      try {
        const firstGrant = preflightAllowed[0];
        if (firstGrant && databaseMap.has(firstGrant.database_name)) {
          const entry = databaseMap.get(firstGrant.database_name)!;
          const d = await fetchDescribeRelation(entry, firstGrant.schema_name, firstGrant.table_name);
          results.describe_sample = d.ok
            ? {
                ok: true,
                data: {
                  schema: d.data.schema,
                  table_name: d.data.table_name,
                  columnCount: d.data.columns.length,
                },
              }
            : { ok: false, error: d.error };
        } else {
          results.describe_sample = { ok: true, data: 'Skipped — no grants.' };
        }
      } catch (e: unknown) {
        results.describe_sample = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      // 3. execute_query — harmless query
      try {
        const data = await tools.execute_query.execute!(
          { database_id: firstDbId, query: 'SELECT 1 AS preflight_check' },
          execOpts
        );
        results.execute_query = { ok: !('error' in (data as Record<string, unknown>)), data };
      } catch (e: unknown) {
        results.execute_query = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      const allOk = Object.values(results).every((r) => r.ok);
      res.json({ ok: allOk, databases: Array.from(databaseMap.keys()), results });
    } catch (err) {
      console.error('POST /api/chat/preflight error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
