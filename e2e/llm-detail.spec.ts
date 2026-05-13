import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildManagerApiMocks } from './mocks/managerApiMocks';

const llmDetailExtraMocks = [
  { method: 'GET', pathname: '/api/llm-supported-language/1', handler: ({ route }: any) => fulfillJson(route, []) },
  { method: 'GET', pathname: '/api/keeled', handler: ({ route }: any) => fulfillJson(route, [{ language_code: 'en', language_name: 'English' }]) },
  { method: 'GET', pathname: '/api/llm-modality/1', handler: ({ route }: any) => fulfillJson(route, []) },
  { method: 'GET', pathname: '/api/modalities', handler: ({ route }: any) => fulfillJson(route, []) },
  { method: 'GET', pathname: '/api/llm-price/1', handler: ({ route }: any) => fulfillJson(route, []) },
  { method: 'GET', pathname: '/api/valuutad', handler: ({ route }: any) => fulfillJson(route, []) },
  { method: 'GET', pathname: '/api/llm-names', handler: ({ route }: any) => fulfillJson(route, [{ llm_id: 1, llm_name: 'Model A' }, { llm_id: 2, llm_name: 'Model B' }]) },
];

// ─── 7.1 LLM detail page renders model name and heading ──────────────────
test('llm detail page renders model name and heading', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [
    ...llmDetailExtraMocks,
    ...buildManagerApiMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/llm/1');

  await expect(page.getByRole('heading', { name: /Model data/i }).first()).toBeVisible();
  await expect(page.getByText('Model A').first()).toBeVisible();
});

// ─── 7.2 Admin can edit model fields and save ─────────────────────────────
test('llm detail edit flow shows success toast', async ({ page }) => {
  await bootstrapAuthSession(page);

  const putMock = {
    method: 'PUT',
    pathname: /^\/api\/llms\/\d+$/,
    handler: ({ route }: any) => fulfillJson(route, {}),
  };

  await mockApi(page, [
    putMock,
    ...llmDetailExtraMocks,
    ...buildManagerApiMocks(),
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/llm/1');

  // Wait for the model data card to be visible
  await expect(page.getByRole('heading', { name: /Model data/i }).first()).toBeVisible();

  // Click the edit model button
  await page.getByTitle('Edit model data').click();

  // The edit form should appear - find the llm_name input
  const nameInput = page.locator('#llm_name');
  await expect(nameInput).toBeVisible();

  // Clear and fill with a new name that passes validation
  await nameInput.clear();
  await nameInput.fill('model-a-updated');

  // Click Save changes button
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Assert success toast
  await expect(page.getByText('Language model updated successfully!')).toBeVisible();
});
