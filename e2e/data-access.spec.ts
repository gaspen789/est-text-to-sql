import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildRolesMock, adminRole } from './mocks/adminApiMocks';
import { databasesList } from './fixtures/databases';

const dataAccessBaseMocks = [
  buildRolesMock(adminRole),
  {
    method: 'GET',
    pathname: '/api/admin/groups',
    handler: ({ route }: any) => fulfillJson(route, [{ user_group_code: 'GRP01', user_group_name: 'Group One' }]),
  },
  {
    method: 'GET',
    pathname: '/api/admin/databases',
    handler: ({ route }: any) => fulfillJson(route, databasesList),
  },
  {
    method: 'GET',
    pathname: /^\/api\/admin\/data-access\/grants/,
    handler: ({ route }: any) => fulfillJson(route, []),
  },
];

// ─── 13.1 Data access page renders heading and database selector ──────────
test('data access page renders heading and database selector', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...dataAccessBaseMocks,
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/data-access');

  await expect(page.getByRole('heading', { name: 'Data access' })).toBeVisible();
  // The database selector is a <select> element with "Select a database…" option
  await expect(page.getByRole('combobox').first()).toBeVisible();
});

// ─── 13.2 Selecting a database shows resources section ───────────────────
test('selecting a database shows resources section', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: /^\/api\/admin\/databases\/\d+\/resources$/,
      handler: ({ route }: any) => fulfillJson(route, {
        database_id: 1,
        schemas: [
          {
            schema_id: 10,
            name: 'public',
            tables: [{ table_id: 100, name: 'users' }],
            views: [],
            materialized_views: [],
          },
        ],
      }),
    },
    ...dataAccessBaseMocks,
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/admin/data-access');

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Data access' })).toBeVisible();

  // Select "TestDB" from the database dropdown
  await page.getByRole('combobox').first().selectOption({ label: 'TestDB' });

  // After selecting, the schemas should appear as tiles
  await expect(page.getByText('public').first()).toBeVisible();
});
