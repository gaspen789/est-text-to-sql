import { fulfillJson, type ApiMock } from './api';
import { buildRolesMock, adminRole } from './adminApiMocks';
import {
  adminChatsOverviewEmpty,
  adminChatsList,
  adminChat10MessagesResp,
} from '../fixtures/admin-chats';

/** All mocks needed to load /admin/chats without errors. */
export function buildAdminChatsPageMocks(): ApiMock[] {
  return [
    buildRolesMock(adminRole),
    // All /api/admin/chats/overview variants (with or without query params) share this handler.
    {
      method: 'GET',
      pathname: /^\/api\/admin\/chats\/overview$/,
      handler: ({ route }) => fulfillJson(route, adminChatsOverviewEmpty),
    },
    {
      method: 'GET',
      pathname: /^\/api\/admin\/chats\/bounds$/,
      handler: ({ route }) =>
        fulfillJson(route, { min_sent_time: null, max_sent_time: null }),
    },
    {
      method: 'GET',
      pathname: /^\/api\/admin\/chats\/\d+\/messages$/,
      handler: ({ route, url }) => {
        const chatId = parseInt(url.pathname.split('/')[4] ?? '', 10);
        if (chatId === 10) return fulfillJson(route, adminChat10MessagesResp);
        return fulfillJson(route, { chat: null, range: { from: null, to: null }, rows: [] });
      },
    },
    {
      method: 'GET',
      pathname: /^\/api\/admin\/chats$/,
      handler: ({ route }) => fulfillJson(route, adminChatsList),
    },
  ];
}
