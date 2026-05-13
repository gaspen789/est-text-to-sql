import { fulfillJson, type ApiMock } from './api';
import { chatsList, chat10Messages, llmNamesActive } from '../fixtures/chat';

export function buildDefaultApiMocks(): ApiMock[] {
  return [
    {
      method: 'GET',
      pathname: '/api/user/session-status',
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    {
      method: 'GET',
      pathname: '/api/llm-names/active',
      handler: ({ route }) => fulfillJson(route, llmNamesActive),
    },
    {
      method: 'GET',
      pathname: '/api/chats',
      handler: ({ route }) => fulfillJson(route, chatsList),
    },
    {
      method: 'GET',
      pathname: /^\/api\/chats\/\d+\/messages$/,
      handler: ({ route, url }) => {
        const chatId = parseInt(url.pathname.split('/')[3] ?? '', 10);
        if (chatId === 10) return fulfillJson(route, chat10Messages);
        return fulfillJson(route, []);
      },
    },
  ];
}

