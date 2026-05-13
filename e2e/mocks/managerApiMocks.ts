import { fulfillJson, type ApiMock } from './api';
import { llmApiForModel1, llmsAll } from '../fixtures/manager';

export function buildManagerApiMocks(): ApiMock[] {
  return [
    {
      method: 'GET',
      pathname: '/api/llms',
      handler: ({ route }) => fulfillJson(route, llmsAll),
    },
    {
      method: 'GET',
      pathname: '/api/llms/active',
      handler: ({ route }) => fulfillJson(route, llmsAll.filter((m) => m.is_active_llm)),
    },
    {
      method: 'GET',
      pathname: '/api/llms/inactive',
      handler: ({ route }) => fulfillJson(route, llmsAll.filter((m) => !m.is_active_llm)),
    },
    {
      method: 'GET',
      pathname: /^\/api\/llm-api\/\d+$/,
      handler: ({ route, url }) => {
        const llmId = parseInt(url.pathname.split('/')[3] ?? '', 10);
        if (llmId === 1) return fulfillJson(route, llmApiForModel1);
        return fulfillJson(route, []);
      },
    },
    {
      method: 'POST',
      pathname: /^\/api\/llms\/\d+\/activate$/,
      handler: ({ route }) => fulfillJson(route, { no_active_llms_remain: false }),
    },
    {
      method: 'POST',
      pathname: /^\/api\/llms\/\d+\/deactivate$/,
      handler: ({ route }) => fulfillJson(route, { no_active_llms_remain: false }),
    },
  ];
}

