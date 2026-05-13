import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildDatabasesPageMocks } from './mocks/databasesApiMocks';
import { databasesList } from './fixtures/databases';

// ─── 10.1 Databases page renders heading and TestDB ──────────────────────
test('databases page renders heading and TestDB', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildDatabasesPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/databases');

  await expect(page.getByRole('heading', { name: 'Databases', exact: true })).toBeVisible();
  await expect(page.getByText('TestDB').first()).toBeVisible();
});

// ─── 10.2 Add database connection shows success toast ────────────────────
test('add database connection shows success toast', async ({ page }) => {
  await bootstrapAuthSession(page);

  let dbCallCount = 0;
  const mocks = [
    {
      method: 'POST',
      pathname: '/api/admin/databases',
      handler: ({ route }: any) => fulfillJson(route, { database_id: 2 }, 201),
    },
    // Override the GET for databases to be stateful
    {
      method: 'GET',
      pathname: '/api/admin/databases',
      handler: ({ route }: any) => {
        dbCallCount++;
        if (dbCallCount > 1) {
          return fulfillJson(route, [...databasesList, { ...databasesList[0], database_id: 2, database_name: 'NewDB' }]);
        }
        return fulfillJson(route, databasesList);
      },
    },
    ...buildDatabasesPageMocks().filter((m) => m.pathname !== '/api/admin/databases'),
    ...buildDefaultApiMocks(),
  ];

  await mockApi(page, mocks);
  await page.goto('/databases');

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Databases', exact: true })).toBeVisible();

  // Click "Add database connection"
  await page.getByRole('button', { name: 'Add database connection' }).click();

  // Dialog should appear
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fill in all required fields
  await dialog.getByTestId('db-form-name').fill('NewDB');
  await dialog.getByTestId('db-form-host').fill('newhost');
  await dialog.getByTestId('db-form-port').fill('5432');
  await dialog.getByTestId('db-form-username').fill('newuser');
  await dialog.getByTestId('db-form-password').fill('secret123');

  // Click Save
  await dialog.getByRole('button', { name: 'Save' }).click();

  // Assert success toast
  await expect(page.getByText('Database connection added.')).toBeVisible();
});

// ─── 10.3 Clicking open detail page navigates to database detail ─────────
test('clicking open detail page navigates to database detail', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...buildDatabasesPageMocks(),
    ...buildDefaultApiMocks(),
    // Mock the detail page API calls
    {
      method: 'GET',
      pathname: '/api/admin/databases/1',
      handler: ({ route }: any) => fulfillJson(route, databasesList[0]),
    },
  ]);

  await page.goto('/databases');

  // Wait for list to render
  await expect(page.getByText('TestDB').first()).toBeVisible();

  // Click the "Open detailed view" button for TestDB
  await page.getByTitle('Open detailed view').first().click();

  // Assert URL changed
  await expect(page).toHaveURL(/\/databases\/1/);
});

// ─── 10.4 Deactivate button calls deactivate endpoint ────────────────────
test('deactivate button calls deactivate endpoint', async ({ page }) => {
  await bootstrapAuthSession(page);

  let deactivateCalled = false;

  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/admin/databases/1/deactivate',
      handler: ({ route }: any) => {
        deactivateCalled = true;
        return fulfillJson(route, {});
      },
    },
    ...buildDatabasesPageMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/databases');

  // Wait for list to render
  await expect(page.getByText('TestDB').first()).toBeVisible();

  // Click the toggle button for TestDB
  await page.getByTestId('database-toggle-btn').first().click();

  // Wait a bit for the mutation to complete
  await page.waitForTimeout(500);

  expect(deactivateCalled).toBe(true);
});
