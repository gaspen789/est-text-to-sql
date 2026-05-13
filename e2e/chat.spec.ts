import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildChatSendMocks, chat99Messages } from './mocks/chatApiMocks';

// ─── 5.1 Chat page loads with LLM selector ────────────────────────────────
test('chat page loads (offline mocked API)', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, buildDefaultApiMocks());

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
  await expect(page.locator('select[name="used_llm_id"]')).toBeVisible();
});

// ─── 5.6 Clicking a chat in the sidebar loads its messages ───────────────
test('selecting a chat renders its messages', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, buildDefaultApiMocks());

  await page.goto('/');

  await page.getByText('Welcome chat').click();

  await expect(page.getByText('Hello from assistant')).toBeVisible();
  await expect(page.getByText('Hello from user')).toBeVisible();
});

// ─── 5.10 Send button is disabled when composer is empty ──────────────────
test('send button is disabled when message is empty', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, buildDefaultApiMocks());

  await page.goto('/');

  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeDisabled();

  await page.locator('textarea').fill('hello');
  await expect(sendButton).toBeEnabled();

  await page.locator('textarea').fill('');
  await expect(sendButton).toBeDisabled();
});

// ─── 5.2 + 5.3 Sending a message shows user message + assistant response ──
test('sending a message shows user message and assistant response', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildChatSendMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();

  // Optimistic user message appears immediately
  await expect(page.getByText('Hello', { exact: true })).toBeVisible();

  // Assistant response streams in and is visible after stream completes
  await expect(page.getByText('Hello from the assistant!')).toBeVisible();
});

// ─── 5.8 LLM API error shows error UI ─────────────────────────────────────
test('failed message shows error message and retry button', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildChatSendMocks({ fail: true }),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('An error occurred')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

// ─── 5.9 Retry button re-sends the message ────────────────────────────────
test('retry button re-sends the failed message', async ({ page }) => {
  let chatApiCallCount = 0;

  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/chats',
      handler: ({ route }) =>
        fulfillJson(route, { chat_id: 99, title: 'new chat', start_time: new Date().toISOString() }),
    },
    {
      method: 'POST',
      pathname: '/api/chat',
      handler: ({ route }) => {
        chatApiCallCount++;
        if (chatApiCallCount === 1) {
          // First attempt fails
          return fulfillJson(route, { code: 'INTERNAL_ERROR' }, 500);
        }
        // Retry succeeds
        const ndjson =
          JSON.stringify({ type: 'text', text: 'Hello from the assistant!' }) + '\n';
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson });
      },
    },
    // Return persisted messages so the error block has a non-empty message list to render in.
    {
      method: 'GET',
      pathname: '/api/chats/99/messages',
      handler: ({ route }) => fulfillJson(route, chat99Messages as any),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(page.getByText('Hello from the assistant!')).toBeVisible();
});

// ─── 5.7 Flag button sends the flag request ───────────────────────────────
test('flag button sends flag request for an assistant message', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'PUT',
      pathname: /^\/api\/chats\/\d+\/messages\/\d+\/flag$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  // Load a chat that has messages
  await page.getByText('Welcome chat').click();
  await expect(page.getByText('Hello from assistant')).toBeVisible();

  // Wait for the flag response when the flag button is clicked
  const flagResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/messages/') &&
      r.url().includes('/flag') &&
      r.request().method() === 'PUT'
  );

  await page.getByTitle('Flag message').first().click();

  const resp = await flagResponse;
  expect(resp.status()).toBe(200);
});

// ─── 5.11 Assistant message can show generated SQL ─────────────────────────
test('assistant response renders a SQL code block', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/chats',
      handler: ({ route }) =>
        fulfillJson(route, { chat_id: 99, title: 'new chat', start_time: new Date().toISOString() }),
    },
    {
      method: 'POST',
      pathname: '/api/chat',
      handler: ({ route }) => {
        const ndjson =
          JSON.stringify({
            type: 'text',
            text:
              'Here is the SQL I ran:\n\n```sql\nSELECT 1 AS n\n```\n\nAnswer: 1',
          }) + '\n';
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson });
      },
    },
    {
      method: 'GET',
      pathname: '/api/chats/99/messages',
      handler: ({ route }) =>
        fulfillJson(route, [
          {
            message_id: 301,
            encrypted_content: 'Show me SQL',
            sent_time: new Date('2026-01-01T12:01:00.000Z').toISOString(),
            is_sent_by_user: true,
            is_flagged_by_user: false,
            used_llm_id: 1,
          },
          {
            message_id: 302,
            encrypted_content:
              'Here is the SQL I ran:\n\n```sql\nSELECT 1 AS n\n```\n\nAnswer: 1',
            sent_time: new Date('2026-01-01T12:01:05.000Z').toISOString(),
            is_sent_by_user: false,
            is_flagged_by_user: false,
            used_llm_id: 1,
            used_llm_name: 'Test LLM',
          },
        ]),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Show me SQL');
  await page.getByRole('button', { name: 'Send' }).click();

  // The SQL code block should render in the assistant bubble.
  await expect(page.getByText('SELECT 1 AS n', { exact: true })).toBeVisible();
});

// ─── 5.12 Empty query result shows a friendly assistant message ────────────
test('empty-result response shows friendly empty state in chat', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/chats/99/messages',
      handler: ({ route }) =>
        fulfillJson(route, [
          {
            message_id: 201,
            encrypted_content: 'Leia kõik kirjed, mida pole olemas',
            sent_time: new Date('2026-01-01T12:01:00.000Z').toISOString(),
            is_sent_by_user: true,
            is_flagged_by_user: false,
            used_llm_id: 1,
          },
          {
            message_id: 202,
            encrypted_content:
              'Ma ei leidnud sinu päringule ühtegi tulemust. Proovi täpsustada ajavahemikku või teisi filtreid.',
            sent_time: new Date('2026-01-01T12:01:05.000Z').toISOString(),
            is_sent_by_user: false,
            is_flagged_by_user: false,
            used_llm_id: 1,
            used_llm_name: 'Test LLM',
          },
        ]),
    },
    {
      method: 'POST',
      pathname: '/api/chats',
      handler: ({ route }) =>
        fulfillJson(route, { chat_id: 99, title: 'new chat', start_time: new Date().toISOString() }),
    },
    {
      method: 'POST',
      pathname: '/api/chat',
      handler: ({ route }) => {
        const ndjson =
          JSON.stringify({
            type: 'text',
            text: 'Ma ei leidnud sinu päringule ühtegi tulemust. Proovi täpsustada ajavahemikku või teisi filtreid.',
          }) + '\n';
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson });
      },
    },
    {
      method: 'PUT',
      pathname: /^\/api\/chats\/\d+\/messages\/\d+\/flag$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Leia kõik kirjed, mida pole olemas');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(
    page.getByText(/Ma ei leidnud sinu päringule ühtegi tulemust/i)
  ).toBeVisible();
});

// ─── 5.13 Follow-up questions can build on prior turns ────────────────────
test('follow-up question keeps the conversation history visible', async ({ page }) => {
  let sendCount = 0;
  let messagesFetchCount = 0;

  const persisted = [
    {
      message_id: 401,
      encrypted_content: 'Mis on müügitulu kokku?',
      sent_time: new Date('2026-01-01T12:01:00.000Z').toISOString(),
      is_sent_by_user: true,
      is_flagged_by_user: false,
      used_llm_id: 1,
      used_llm_name: null,
    },
    {
      message_id: 402,
      encrypted_content:
        'Müügitulu kokku on 100.\n\n```sql\nSELECT SUM(amount) AS total_sales\nFROM sales\n```\n',
      sent_time: new Date('2026-01-01T12:01:05.000Z').toISOString(),
      is_sent_by_user: false,
      is_flagged_by_user: false,
      used_llm_id: 1,
      used_llm_name: 'Test LLM',
    },
    {
      message_id: 403,
      encrypted_content: 'Aga 2025 aastal?',
      sent_time: new Date('2026-01-01T12:02:00.000Z').toISOString(),
      is_sent_by_user: true,
      is_flagged_by_user: false,
      used_llm_id: 1,
      used_llm_name: null,
    },
    {
      message_id: 404,
      encrypted_content:
        '2025 aastal on müügitulu 60.\n\n```sql\nSELECT SUM(amount) AS total_sales\nFROM sales\nWHERE year = 2025\n```\n',
      sent_time: new Date('2026-01-01T12:02:05.000Z').toISOString(),
      is_sent_by_user: false,
      is_flagged_by_user: false,
      used_llm_id: 1,
      used_llm_name: 'Test LLM',
    },
  ];

  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/chats',
      handler: ({ route }) =>
        fulfillJson(route, { chat_id: 99, title: 'new chat', start_time: new Date().toISOString() }),
    },
    {
      method: 'POST',
      pathname: '/api/chat',
      handler: ({ route }) => {
        sendCount++;
        const text =
          sendCount === 1
            ? persisted[1]!.encrypted_content
            : persisted[3]!.encrypted_content;
        const ndjson = JSON.stringify({ type: 'text', text }) + '\n';
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson });
      },
    },
    {
      method: 'GET',
      pathname: '/api/chats/99/messages',
      handler: ({ route }) => {
        messagesFetchCount++;
        if (messagesFetchCount <= 1) {
          return fulfillJson(route, persisted.slice(0, 2) as any);
        }
        return fulfillJson(route, persisted as any);
      },
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/');

  await page.locator('textarea').fill('Mis on müügitulu kokku?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Müügitulu kokku on 100/i)).toBeVisible();

  await page.locator('textarea').fill('Aga 2025 aastal?');
  await page.getByRole('button', { name: 'Send' }).click();

  // Both turns should be visible (history preserved) and follow-up answer rendered.
  await expect(page.getByText('Mis on müügitulu kokku?', { exact: true })).toBeVisible();
  await expect(page.getByText('Aga 2025 aastal?', { exact: true })).toBeVisible();
  await expect(page.getByText(/2025 aastal on müügitulu 60/i)).toBeVisible();
});

