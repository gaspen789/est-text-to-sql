import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';

const myDataResponse = {
  databases: [
    {
      database_id: 1,
      database_name: 'MyDB',
      schemas: [
        {
          schema_name: 'public',
          tables: [{ table_name: 'users', columns: [] }],
          views: [],
        },
      ],
    },
  ],
};

// ─── 11.1 My data page renders heading and database name ─────────────────
test('my-data page renders heading and database name', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/me/data-structure',
      handler: ({ route }) => fulfillJson(route, myDataResponse),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/my-data');

  await expect(page.getByRole('heading', { name: 'Data you can access' })).toBeVisible();
  await expect(page.getByText('MyDB')).toBeVisible();
});

// ─── 11.2 Expanding schema reveals table name ────────────────────────────
test('expanding schema reveals table name', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/me/data-structure',
      handler: ({ route }) => fulfillJson(route, myDataResponse),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/my-data');

  // Wait for MyDB to be visible
  await expect(page.getByText('MyDB')).toBeVisible();

  // Database is expanded by default. Schema "public" is collapsed initially.
  // Click on the schema toggle button to expand it
  await page.getByText(/Schema: public/i).click();

  // After expanding, the table name should be visible (shown as schema.tablename)
  await expect(page.getByText(/public\.users/)).toBeVisible();
});

// ─── 11.3 Empty data shows empty state message ───────────────────────────
test('empty data shows empty state message', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/me/data-structure',
      handler: ({ route }) => fulfillJson(route, { databases: [] }),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/my-data');

  await expect(
    page.getByText('You do not have access to any registered tables or views yet.')
  ).toBeVisible();
});
