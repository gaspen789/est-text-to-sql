import { test, expect } from '@playwright/test';
import { bootstrapAuthSession } from './mocks/auth';
import { mockApi } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';
import { buildManagerApiMocks } from './mocks/managerApiMocks';

// ─── 2.1 Unauthenticated user visiting /manager is redirected ────────────
test('unauthenticated users are redirected to login', async ({ page }) => {
  await mockApi(page, [...buildDefaultApiMocks(), ...buildManagerApiMocks()]);

  await page.goto('/manager');

  await expect(page).toHaveURL(/\/login/);
});

// ─── 6.1 Manager page loads with list of LLMs ────────────────────────────
test('manager page renders models list (offline mocked API)', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [...buildDefaultApiMocks(), ...buildManagerApiMocks()]);

  await page.goto('/manager');

  await expect(page.getByRole('heading', { name: 'Language models' })).toBeVisible();
  await expect(page.getByText('Model A')).toBeVisible();
  await expect(page.getByText('Model B')).toBeVisible();
});

// ─── 6.5 Deactivating an active LLM shows success toast ──────────────────
test('manager page can trigger activate/deactivate flow (mocked POST)', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [...buildDefaultApiMocks(), ...buildManagerApiMocks()]);

  await page.goto('/manager');

  // Model A starts active, so it should show "Deactivate model".
  await page.getByTitle('Deactivate model').first().click();

  // Mutation should complete and toast should appear.
  await expect(page.getByText('Language model deactivated successfully!')).toBeVisible();
});

// ─── 6.2 Filtering by inactive shows only inactive models ────────────────
test('filtering by inactive shows only inactive models', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [...buildDefaultApiMocks(), ...buildManagerApiMocks()]);

  await page.goto('/manager');

  // Both models should be visible initially.
  await expect(page.getByText('Model A')).toBeVisible();
  await expect(page.getByText('Model B')).toBeVisible();

  // Open the filter panel.
  await page.getByRole('button', { name: 'Filter' }).click();

  // Click the "Inactive" pill to filter by inactive status.
  await page.getByRole('button', { name: 'Inactive' }).click();

  // Model B is inactive (is_active_llm: false) and should still be visible.
  await expect(page.getByText('Model B')).toBeVisible();
  // Model A is active and should no longer be visible.
  await expect(page.getByText('Model A')).not.toBeVisible();
});

// ─── 6.3 Sorting descending reverses the model order ──────────────────────
test('sorting descending by name reverses model order', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, [...buildDefaultApiMocks(), ...buildManagerApiMocks()]);

  await page.goto('/manager');

  // Open the sort panel.
  await page.getByRole('button', { name: 'Sort' }).click();

  // Switch sort direction to Descending.
  await page.getByTestId('sort-direction-select').selectOption('desc');

  // With descending sort by model name, Model B should come before Model A in the page text.
  const tableText = await page.locator('#manager-models-section').innerText();
  const indexA = tableText.indexOf('Model A');
  const indexB = tableText.indexOf('Model B');

  expect(indexB).toBeGreaterThan(-1);
  expect(indexA).toBeGreaterThan(-1);
  expect(indexB).toBeLessThan(indexA);
});

