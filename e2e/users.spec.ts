import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildAdminUsersPageMocks } from './mocks/adminApiMocks';
import { adminUsersList } from './fixtures/users';

// ─── 8.1 Users page loads ─────────────────────────────────────────────────
test('users page loads with list of users', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminUsersPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('admin@example.com')).toBeVisible();
  await expect(page.getByText('user@example.com')).toBeVisible();
});

// ─── 8.2 Search/filter narrows user list ─────────────────────────────────
test('searching by email filters the user list', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildAdminUsersPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page.getByText('admin@example.com')).toBeVisible();
  await expect(page.getByText('user@example.com')).toBeVisible();

  // Type into the search box.
  await page.getByPlaceholder("User's email").fill('admin');

  // Only admin user visible; regular user filtered out.
  await expect(page.getByText('admin@example.com')).toBeVisible();
  await expect(page.getByText('user@example.com')).not.toBeVisible();
});

// ─── 8.3 Create a new user ────────────────────────────────────────────────
test('creating a new user shows success toast', async ({ page }) => {
  await bootstrapAuthSession(page);

  const updatedList = [
    ...adminUsersList,
    {
      app_user_id: 3,
      email: 'new@example.com',
      preferred_llm_language: 'en',
      llm_custom_global_instruction: null,
      is_active: true,
      created_at_time: new Date('2026-04-01T00:00:00Z').toISOString(),
      modified_at_time: new Date('2026-04-01T00:00:00Z').toISOString(),
      user_role_codes: 'CHA',
      user_role_names: 'Chat User',
      user_group_codes: '',
      user_group_names: '',
    },
  ];

  let usersCallCount = 0;
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/admin/users',
      handler: ({ route }) => {
        usersCallCount++;
        // After creation (second call), return the updated list.
        return fulfillJson(route, usersCallCount === 1 ? adminUsersList : updatedList);
      },
    },
    {
      method: 'POST',
      pathname: '/api/admin/users',
      handler: ({ route }) =>
        fulfillJson(route, { app_user_id: 3, email: 'new@example.com' }, 201),
    },
    ...buildAdminUsersPageMocks().filter((m) => m.pathname !== '/api/admin/users'),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  // Open the "Add user" dialog.
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Fill in required fields.
  await page.getByRole('dialog').getByPlaceholder("User's email").fill('new@example.com');

  // Select language via SearchableSelect (trigger button opens listbox).
  const langTrigger = page.getByRole('dialog').getByRole('button', { name: /English|select/i });
  await langTrigger.click();
  await page.getByRole('option', { name: /English/i }).first().click();

  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('User added.')).toBeVisible();
});

// ─── 8.5 Deactivate a user ───────────────────────────────────────────────
test('deactivating a user calls the deactivate endpoint', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'PUT',
      pathname: /^\/api\/admin\/users\/\d+\/deactivate$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    ...buildAdminUsersPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page.getByText('admin@example.com')).toBeVisible();

  const deactivateResponse = page.waitForResponse(
    (r) => r.url().includes('/deactivate') && r.request().method() === 'PUT'
  );

  // Click the Deactivate button for the first user row.
  await page.getByTitle('Deactivate').first().click();

  const resp = await deactivateResponse;
  expect(resp.status()).toBe(200);
});

// ─── 8.6 Delete user with confirmation ───────────────────────────────────
test('deleting a user with email confirmation removes them from the list', async ({ page }) => {
  await bootstrapAuthSession(page);

  let usersCallCount = 0;
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/admin/users',
      handler: ({ route }) => {
        usersCallCount++;
        // After deletion, return only the admin user.
        return fulfillJson(route, usersCallCount === 1 ? adminUsersList : [adminUsersList[0]!]);
      },
    },
    {
      method: 'DELETE',
      pathname: /^\/api\/admin\/users\/\d+$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    ...buildAdminUsersPageMocks().filter((m) => m.pathname !== '/api/admin/users'),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  await expect(page.getByText('user@example.com')).toBeVisible();

  // Open edit row for the regular user (second row).
  await page.getByTitle('Edit user').nth(1).click();

  // Find and click Delete button in the edit panel.
  await page.getByRole('button', { name: 'Delete user' }).click();

  // Type the email to confirm (in the delete confirmation dialog).
  const deleteDialog = page.getByRole('dialog', { name: 'Delete user' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByPlaceholder('user@example.com').fill('user@example.com');
  await page.getByRole('button', { name: 'Yes, delete user' }).click();

  await expect(page.getByText('User deleted.')).toBeVisible();
  await expect(page.getByText('user@example.com')).not.toBeVisible();
});

// ─── 8.7 Change user password ─────────────────────────────────────────────
test('changing a user password shows success toast', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'PUT',
      pathname: /^\/api\/admin\/users\/\d+\/password$/,
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
    ...buildAdminUsersPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/users');

  // Open edit row for admin user (first row).
  await page.getByTitle('Edit user').first().click();

  // Open the change password dialog.
  await page.getByRole('button', { name: 'Change password' }).click();

  const dialog = page.getByRole('dialog', { name: 'Change user password' });
  await expect(dialog).toBeVisible();

  const inputs = dialog.locator('input[type="password"]');
  await inputs.nth(0).fill('newLongPassword123!');
  await inputs.nth(1).fill('newLongPassword123!');

  await dialog.getByRole('button', { name: 'Save new password' }).click();

  await expect(page.getByText('User password has been changed.')).toBeVisible();
});
