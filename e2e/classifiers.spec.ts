import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildRolesMock, adminRole } from './mocks/adminApiMocks';

const classifiersMocks = [
  buildRolesMock(adminRole),
  {
    method: 'GET',
    pathname: '/api/admin/classifiers/languages',
    handler: ({ route }: any) => fulfillJson(route, [{ language_code: 'EN', language_name: 'English', is_active: true }]),
  },
  {
    method: 'GET',
    pathname: '/api/admin/classifiers/roles',
    handler: ({ route }: any) => fulfillJson(route, [{ user_role_code: 'ADM', user_role_name: 'Administrator' }]),
  },
  {
    method: 'GET',
    pathname: '/api/admin/classifiers/groups',
    handler: ({ route }: any) => fulfillJson(route, []),
  },
];

// ─── 12.1 Classifiers page renders heading and Languages tab ─────────────
test('classifiers page renders heading and languages tab', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...classifiersMocks,
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/classifiers');

  await expect(page.getByRole('heading', { name: 'Classifiers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Languages' }).first()).toBeVisible();
});

// ─── 12.2 Add language classifier shows success toast ────────────────────
test('add language classifier shows success toast', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/admin/classifiers/languages',
      handler: ({ route }: any) => fulfillJson(route, { language_code: 'EST', language_name: 'Estonian' }, 201),
    },
    ...classifiersMocks,
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/classifiers');

  // Wait for the page to load with user classifiers section visible
  await expect(page.getByRole('button', { name: 'Languages' }).first()).toBeVisible();

  // Click "Add language" button - use the first one (UserClassifiersSection)
  await page.getByRole('button', { name: 'Add language' }).first().click();

  const modalInner = page.getByTestId('classifier-modal');
  await modalInner.getByTestId('classifier-code-input').fill('EST');
  await modalInner.getByTestId('classifier-name-input').fill('Estonian');

  // Click the Save button in the modal
  await modalInner.getByRole('button', { name: 'Save' }).click();

  // Assert success toast
  await expect(page.getByText('Classifier saved.')).toBeVisible();
});

// ─── 12.3 Deactivate language classifier works ───────────────────────────
test('deactivate language classifier works', async ({ page }) => {
  await bootstrapAuthSession(page);

  let deactivateCalled = false;

  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/admin/classifiers/languages/EN/deactivate',
      handler: ({ route }: any) => {
        deactivateCalled = true;
        return fulfillJson(route, {});
      },
    },
    ...classifiersMocks,
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/classifiers');

  // Wait for the Languages tab to be selected by default and English to appear
  await expect(page.getByRole('button', { name: 'Languages' }).first()).toBeVisible();

  // Find the deactivate/toggle button for the EN language entry
  await page.getByTestId('classifier-toggle-btn').first().click();

  // Wait for mutation
  await page.waitForTimeout(500);

  expect(deactivateCalled).toBe(true);
});
