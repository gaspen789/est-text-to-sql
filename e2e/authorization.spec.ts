import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildAdminUsersPageMocks, buildRolesMock, regularRole } from './mocks/adminApiMocks';

// ─── 2.1 Unauthenticated user visiting / is redirected ────────────────────
test('unauthenticated user visiting / is redirected to login', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

// ─── 2.2 Unauthenticated user visiting /users is redirected ───────────────
test('unauthenticated user visiting /users is redirected to login', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login/);
});

// ─── 2.3 Unauthenticated user visiting /admin/chats is redirected ─────────
test('unauthenticated user visiting /admin/chats is redirected to login', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/admin/chats');
  await expect(page).toHaveURL(/\/login/);
});

// ─── 2.4 Deactivated account session triggers logout ──────────────────────
test('deactivated account session triggers logout and redirect to login', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/user/session-status',
      handler: ({ route }) =>
        fulfillJson(route, { code: 'ACCOUNT_DEACTIVATED' }, 401),
    },
    // Provide the rest of the default mocks so the chat page doesn't block the deactivation.
    ...buildDefaultApiMocks().filter((m) => m.pathname !== '/api/user/session-status'),
  ]);

  await page.goto('/');

  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ─── 3.1 Regular user visiting /users is redirected to chat ───────────────
test('regular user visiting /users is redirected to chat page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    buildRolesMock(regularRole),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page).toHaveURL('/');
});

// ─── 3.2 Regular user visiting /admin/chats is redirected to chat ─────────
test('regular user visiting /admin/chats is redirected to chat page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    buildRolesMock(regularRole),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/chats');

  await expect(page).toHaveURL('/');
});

// ─── 3.3 Regular user visiting /admin/classifiers is redirected ───────────
test('regular user visiting /admin/classifiers is redirected to chat page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    buildRolesMock(regularRole),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/classifiers');

  await expect(page).toHaveURL('/');
});

// ─── 3.5 Regular user visiting /databases is redirected ───────────────────
test('regular user visiting /databases is redirected to chat page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    buildRolesMock(regularRole),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/databases');

  await expect(page).toHaveURL('/');
});

// ─── 3.6 Admin user can access /users page ────────────────────────────────
test('admin user can access /users page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminUsersPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page).toHaveURL('/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
});
