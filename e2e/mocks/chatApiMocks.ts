import { fulfillJson, type ApiMock } from './api';
import type { ChatMessageRow } from '../../frontend/src/types/api/chat';
import type { ChatRow } from '../../frontend/src/contexts/chat-session-context';

export const newChatFixture = {
  chat_id: 99,
  title: 'new chat',
  start_time: new Date('2026-01-01T12:00:00.000Z').toISOString(),
} satisfies ChatRow;

export const chat99Messages = [
  {
    message_id: 201,
    encrypted_content: 'Hello',
    sent_time: new Date('2026-01-01T12:01:00.000Z').toISOString(),
    is_sent_by_user: true,
    is_flagged_by_user: false,
    used_llm_id: 1,
  },
  {
    message_id: 202,
    encrypted_content: 'Hello from the assistant!',
    sent_time: new Date('2026-01-01T12:01:05.000Z').toISOString(),
    is_sent_by_user: false,
    is_flagged_by_user: false,
    used_llm_id: 1,
    used_llm_name: 'Test LLM',
  },
] satisfies ChatMessageRow[];

export function buildChatSendMocks(opts?: { fail?: boolean }): ApiMock[] {
  return [
    {
      method: 'POST',
      pathname: '/api/chats',
      handler: ({ route }) => fulfillJson(route, newChatFixture),
    },
    {
      method: 'POST',
      pathname: '/api/chat',
      handler: ({ route }) => {
        if (opts?.fail) {
          return fulfillJson(route, { code: 'INTERNAL_ERROR' }, 500);
        }
        const ndjson =
          JSON.stringify({ type: 'text', text: 'Hello from the assistant!' }) + '\n';
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson,
        });
      },
    },
    {
      method: 'GET',
      pathname: '/api/chats/99/messages',
      handler: ({ route }) => fulfillJson(route, chat99Messages),
    },
    {
      method: 'PUT',
      pathname: /^\/api\/chats\/\d+\/messages\/\d+\/flag$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
  ];
}
