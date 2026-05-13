import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildAdminChatsPageMocks } from './mocks/adminChatsApiMocks';

// ─── 9.1 Admin chats dashboard loads ─────────────────────────────────────
test('admin chats dashboard loads with stat tiles', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminChatsPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/chats');

  await expect(page.getByRole('heading', { name: 'Chat dashboard' })).toBeVisible();
  // Stat tiles.
  await expect(page.getByRole('button', { name: 'Messages today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Messages this week' })).toBeVisible();
});

// ─── 9.3 Clicking a chat loads its messages ───────────────────────────────
test('clicking a chat in the list shows its messages', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminChatsPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/chats');

  await expect(page.getByRole('heading', { name: 'Chat dashboard' })).toBeVisible();

  // The chats list renders after the overview query resolves.
  await expect(page.getByText('Admin chat 1')).toBeVisible({ timeout: 10_000 });

  // Click the chat row's eye/view button.
  await page.getByTitle('Open chat').first().click();

  // Messages section appears with content from the mock.
  await expect(page.getByText('Hello from the admin user')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Hello from the admin assistant')).toBeVisible({ timeout: 10_000 });
});

// ─── 9.4 Flagged messages are visually distinct ──────────────────────────
test('flagged assistant message has a visual ring indicator', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminChatsPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/chats');

  await expect(page.getByText('Admin chat 1')).toBeVisible({ timeout: 10_000 });

  // Open the chat that has a flagged message (message_id 202).
  await page.getByTitle('Open chat').first().click();

  await expect(page.getByText('Hello from the admin assistant')).toBeVisible({ timeout: 10_000 });

  // The flagged message bubble has a data-testid attribute for stable selection.
  const flaggedBubble = page.getByTestId('flagged-message-bubble');
  await expect(flaggedBubble).toBeVisible();
});
