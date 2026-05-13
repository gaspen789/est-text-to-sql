import type { Page } from '@playwright/test';

/** Sets localStorage language to English so UI strings are stable for assertions. */
export async function setEnglishLocale(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('app-language', 'en');
  });
}

export async function bootstrapAuthSession(
  page: Page,
  opts?: { userId?: number; email?: string }
): Promise<void> {
  const userId = opts?.userId ?? 1;
  const userEmail = opts?.email ?? 'e2e@example.com';

  await page.addInitScript(
    ({ userId, userEmail }) => {
      // Keep UI strings stable for E2E assertions.
      localStorage.setItem('app-language', 'en');

      sessionStorage.setItem('isAuthenticated', 'true');
      sessionStorage.setItem('userId', String(userId));
      sessionStorage.setItem('userEmail', userEmail);
    },
    { userId, userEmail }
  );
}

