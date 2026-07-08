import { expect, test, type Page } from '@playwright/test';

test.describe('PlanMerge auth toolbar', () => {
  test.skip(process.env.AUTH_TEST_LOGIN !== '1', 'requires test login');

  test('signs in with the test provider and signs out from the toolbar', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await signInWithTestCredentials(page, 'e2e-auth-user');
    await page.goto('/');

    await expect(page.getByTestId('auth-user-menu')).toContainText('e2e-auth-user');

    await page.getByRole('button', { name: /^로그아웃$/ }).click();

    await expect(page.getByTestId('auth-login-button')).toBeVisible();
    await expect(page.getByTestId('auth-user-menu')).toHaveCount(0);
  });
});

async function signInWithTestCredentials(page: Page, username: string) {
  const csrfToken = await getCsrfToken(page);
  const response = await page.request.post('/api/auth/callback/credentials', {
    form: {
      username,
      csrfToken,
      callbackUrl: '/',
    },
    headers: {
      'X-Auth-Return-Redirect': '1',
    },
  });

  expect(response.ok()).toBeTruthy();

  const payload: unknown = await response.json();
  const redirectUrl = getStringField(payload, 'url') ?? '/';

  if (redirectUrl.includes('error=')) {
    throw new Error(`테스트 로그인에 실패했습니다: ${redirectUrl}`);
  }
}

async function getCsrfToken(page: Page) {
  const response = await page.request.get('/api/auth/csrf');

  expect(response.ok()).toBeTruthy();

  const payload: unknown = await response.json();
  const csrfToken = getStringField(payload, 'csrfToken');

  if (!csrfToken) {
    throw new Error('Auth.js CSRF 토큰을 받지 못했습니다.');
  }

  return csrfToken;
}

function getStringField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];

  return typeof field === 'string' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
