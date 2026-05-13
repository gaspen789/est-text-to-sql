import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { db } from '../db/index.js';
import { mapPgErrorToCode } from '../errorUtils.js';
import { ErrorCodes } from '../errors/codes.js';
import { decrypt } from './encryption.js';
import { getMessageBodyColumn } from './message-body-column.js';

/** Matches DB `Chat.chat_title` column length. */
export const CHAT_TITLE_MAX_LEN = 30;

export function isDefaultChatTitle(title: string | null | undefined, chatId: number): boolean {
  return (title ?? '').trim() === `Chat ${Number(chatId)}`;
}

/** Provisional DB title before rename: `Chat {id}` or temp hex from create-chat insert. */
const PROVISIONAL_HEX_TITLE = /^[0-9a-f]{8,30}$/i;

export function isProvisionalChatTitle(title: string | null | undefined, chatId: number): boolean {
  const t = (title ?? '').trim();
  if (isDefaultChatTitle(t, chatId)) return true;
  return PROVISIONAL_HEX_TITLE.test(t);
}

/** SQL guard: row still has a provisional title (matches `isProvisionalChatTitle` in JS). */
export const SQL_CHAT_TITLE_STILL_PROVISIONAL = `(
  chat_title = ('Chat ' || chat_id::text)
  OR (chat_title ~ '^[0-9a-f]{8,30}$' AND char_length(chat_title) BETWEEN 8 AND 30)
)`;

export function truncateChatTitle(s: string, maxLen = CHAT_TITLE_MAX_LEN): string {
  const singleLine = s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen).trimEnd();
}

function stripSurroundingQuotes(s: string): string {
  let t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function heuristicTitle(userLines: string[]): string {
  const combined = userLines
    .map((l) =>
      l
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join(' · ');
  return truncateChatTitle(combined || 'Chat');
}

async function pickUniqueTitle(chatId: number, userId: number, preferred: string): Promise<void> {
  const base = truncateChatTitle(stripSurroundingQuotes(preferred));
  const safeBase = /[a-zA-Z0-9]/.test(base) ? base : heuristicTitle([preferred]);

  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = attempt === 0 ? '' : `-${attempt}`;
    const room = Math.max(1, CHAT_TITLE_MAX_LEN - suffix.length);
    const candidate = truncateChatTitle(truncateChatTitle(safeBase).slice(0, room) + suffix);
    if (!candidate.trim() || !/[a-zA-Z0-9]/.test(candidate)) continue;

    try {
      const result = await db.query(
        `UPDATE Chat
         SET chat_title = $1
         WHERE chat_id = $2
           AND app_user_id = $3
           AND is_hidden = FALSE
           AND ${SQL_CHAT_TITLE_STILL_PROVISIONAL}
         RETURNING chat_id`,
        [candidate, chatId, userId]
      );
      if (result.rows.length > 0) return;
      return;
    } catch (err) {
      const { code } = mapPgErrorToCode(err);
      if (code !== ErrorCodes.CHAT_TITLE_ALREADY_EXISTS) {
        console.error('chat-title: failed to persist title:', err);
        return;
      }
    }
  }

  const fallback = truncateChatTitle(`C${String(chatId)}`);
  try {
    await db.query(
      `UPDATE Chat
       SET chat_title = $1
       WHERE chat_id = $2
         AND app_user_id = $3
         AND is_hidden = FALSE
         AND ${SQL_CHAT_TITLE_STILL_PROVISIONAL}`,
      [fallback, chatId, userId]
    );
  } catch (err) {
    console.error('chat-title: fallback title update failed:', err);
  }
}

/**
 * If the chat title is still provisional (`Chat {id}` or temp hex), replace it with a short label
 * derived from all user messages (LLM when possible). Call after the first assistant message
 * is persisted so the thread has user context. Non-blocking callers may fire-and-forget.
 */
export async function refreshChatTitleIfPlaceholder(params: {
  chatId: number;
  userId: number;
  model: LanguageModel | null;
  mockLlm: boolean;
}): Promise<void> {
  const { chatId, userId, model, mockLlm } = params;

  const titleRow = await db.query(
    `SELECT chat_title AS title FROM Chat WHERE chat_id = $1 AND app_user_id = $2`,
    [chatId, userId]
  );
  const currentTitle = titleRow.rows[0]?.title as string | undefined;
  if (!isProvisionalChatTitle(currentTitle, chatId)) return;

  const messageBodyCol = await getMessageBodyColumn();
  const msgs = await db.query(
    `SELECT ${messageBodyCol} AS cipher_body
     FROM Message
     WHERE chat_id = $1 AND is_sent_by_user = TRUE
     ORDER BY sent_time ASC, message_id ASC`,
    [chatId]
  );
  const userLines = (msgs.rows as Array<{ cipher_body: string }>)
    .map((r) => decrypt(r.cipher_body) ?? String(r.cipher_body ?? ''))
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);

  if (userLines.length === 0) return;

  let candidate = heuristicTitle(userLines);

  if (!mockLlm && model) {
    try {
      const listed = userLines.map((t, i) => `${i + 1}. ${t}`).join('\n');
      const { text } = await generateText({
        model,
        system: [
          'You write very short titles for chat threads.',
          `Hard rules: respond with ONLY the title text; max ${CHAT_TITLE_MAX_LEN} characters;`,
          'no quotes; no newlines; if there are several user questions, combine them into one brief headline;',
          'use the same language as the questions when possible.',
        ].join(' '),
        prompt: `User messages:\n${listed}\n\nTitle:`,
        maxOutputTokens: 64,
        temperature: 0.2,
      });
      const cleaned = stripSurroundingQuotes(text ?? '');
      if (cleaned && /[a-zA-Z0-9]/.test(cleaned)) {
        candidate = truncateChatTitle(cleaned);
      }
    } catch (err) {
      console.error('chat-title: generateText failed, using heuristic title:', err);
    }
  }

  await pickUniqueTitle(chatId, userId, candidate);
}
