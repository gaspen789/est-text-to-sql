import type { Page, Route } from '@playwright/test';

export type ApiMockHandler = (args: {
  route: Route;
  url: URL;
  method: string;
  requestBodyText: string | null;
}) => Promise<void> | void;

export type ApiMock = {
  method: string;
  pathname: string | RegExp;
  handler: ApiMockHandler;
};

export async function mockApi(page: Page, mocks: ApiMock[]): Promise<void> {
  await page.route('http://127.0.0.1:3999/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method().toUpperCase();

    const bodyText = (() => {
      try {
        return req.postData();
      } catch {
        return null;
      }
    })();

    const match = mocks.find((m) => {
      if (m.method.toUpperCase() !== method) return false;
      if (typeof m.pathname === 'string') return url.pathname === m.pathname;
      return m.pathname.test(url.pathname);
    });

    if (!match) {
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'E2E_UNMOCKED_ENDPOINT',
          error: `No mock registered for ${method} ${url.pathname}`,
        }),
      });
      return;
    }

    await match.handler({
      route,
      url,
      method,
      requestBodyText: bodyText ?? null,
    });
  });
}

export function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

