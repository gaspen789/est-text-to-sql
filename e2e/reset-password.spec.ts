import { test, expect } from '@playwright/test';
import { setEnglishLocale } from './mocks/auth';
import { mockApi, fulfillJson } from './mocks/api';

// ─── 4.1 Requesting a reset with any email shows success (no enumeration) ────
test('password reset request shows success message for any email', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'POST',
      pathname: '/api/forgot-password',
      handler: ({ route }) => fulfillJson(route, { ok: true }),
    },
  ]);

  await page.goto('/login');

  // Open the "Forgot my password" modal.
  await page.getByRole('button', { name: 'Forgot my password' }).click();

  await expect(page.getByRole('dialog')).toBeVisible();

  await page.fill('#forgot-email', 'anyone@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();

  // Success message shown regardless of whether the email exists.
  await expect(
    page.getByText('If the email matches an account, a password reset link has been sent. Please check your inbox.')
  ).toBeVisible();
});

// ─── 4.2 Valid reset token → password form shown ───────────────────────────
test('valid reset token shows the new-password form', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/reset-password/verify',
      handler: ({ route }) => fulfillJson(route, { valid: true }),
    },
  ]);

  await page.goto('/reset-password?token=valid-token-abc');

  await expect(page.locator('#reset-new-password')).toBeVisible();
  await expect(page.locator('#reset-confirm-password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
});

// ─── 4.3 Invalid reset token → error message, no form ─────────────────────
test('invalid reset token shows error and no password form', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/reset-password/verify',
      handler: ({ route }) =>
        fulfillJson(route, { code: 'RESET_TOKEN_INVALID' }, 400),
    },
  ]);

  await page.goto('/reset-password?token=bad-token');

  await expect(
    page.getByText('This password reset link is invalid. Please request a new one.')
  ).toBeVisible();
  await expect(page.locator('#reset-new-password')).not.toBeVisible();
});

// ─── 4.4 Password too short → validation error ────────────────────────────
test('password shorter than 8 characters shows validation error', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/reset-password/verify',
      handler: ({ route }) => fulfillJson(route, { valid: true }),
    },
  ]);

  await page.goto('/reset-password?token=valid-token-abc');

  await page.fill('#reset-new-password', 'short');
  await page.fill('#reset-confirm-password', 'short');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page.getByText('New password must be at least 15 characters.')).toBeVisible();
});

// ─── 4.5 Successful reset → navigated to login with success toast ──────────
test('successful password reset navigates to login with success toast', async ({ page }) => {
  await setEnglishLocale(page);
  await mockApi(page, [
    {
      method: 'GET',
      pathname: '/api/reset-password/verify',
      handler: ({ route }) => fulfillJson(route, { valid: true }),
    },
    {
      method: 'POST',
      pathname: '/api/reset-password',
      handler: ({ route }) => fulfillJson(route, { success: true }),
    },
  ]);

  await page.goto('/reset-password?token=valid-token-abc');

  await page.fill('#reset-new-password', 'longEnoughPassword123!');
  await page.fill('#reset-confirm-password', 'longEnoughPassword123!');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText('Password updated. You can now log in with the new password.')
  ).toBeVisible();
});
