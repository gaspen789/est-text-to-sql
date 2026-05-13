import { test, expect } from '@playwright/test';
import { bootstrapAuthSession, setEnglishLocale } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';
import { buildDefaultApiMocks } from './mocks/defaultApiMocks';

// ─── 1.1 Correct credentials → redirected to / ────────────────────────────
test('correct credentials redirect to chat page', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/login',
      handler: ({ route }) => fulfillJson(route, { success: 1 }),
    },
    ...buildDefaultApiMocks(),
  ]);

  await page.goto('/login');

  await page.fill('#email', 'user@example.com');
  await page.fill('#password', 'correctpassword');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
});

// ─── 1.2 Wrong password → error toast ─────────────────────────────────────
test('wrong password shows error toast', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/login',
      handler: ({ route }) =>
        fulfillJson(route, { code: 'LOGIN_INVALID_CREDENTIALS' }, 401),
    },
  ]);

  await page.goto('/login');

  await page.fill('#email', 'user@example.com');
  await page.fill('#password', 'wrongpassword');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText('Invalid email or password.')).toBeVisible();
});

// ─── 1.3 Empty email → client-side validation toast ───────────────────────
test('empty email shows validation toast', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, []);

  await page.goto('/login');

  await page.fill('#password', 'somepassword');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText('Please enter an email address')).toBeVisible();
});

// ─── 1.4 Empty password → client-side validation toast ────────────────────
test('empty password shows validation toast', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, []);

  await page.goto('/login');

  await page.fill('#email', 'user@example.com');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText('Please enter a password')).toBeVisible();
});

// ─── 1.5 Already-authenticated user visiting /login → redirected to / ─────
test('authenticated user visiting /login is redirected to chat page', async ({ page }) => {
  await bootstrapAuthSession(page);
  await mockApi(page, buildDefaultApiMocks());

  await page.goto('/login');

  await expect(page).toHaveURL('/');
});
