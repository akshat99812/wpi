import { test, expect } from '@playwright/test';
import { hasE2ECreds } from '../../fixtures/auth';

/**
 * Pro-gating is enforced two ways:
 *  - web middleware (middleware.ts) redirects unauthed visitors of /chat,/mast
 *    to /login?next=<path>
 *  - the API re-validates the session on every Pro request (requirePro)
 *
 * The redirect path needs no backend or credentials, so it runs everywhere.
 */
test.describe('Pro route gating', () => {
  test('redirects unauthenticated /chat to /login with next param', async ({
    page,
  }) => {
    await page.goto('/chat');
    await page.waitForURL(/\/login/);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/chat');
  });

  test('redirects unauthenticated /mast to /login', async ({ page }) => {
    await page.goto('/mast');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('authenticated user can reach /chat', async ({ page }) => {
    test.skip(
      !hasE2ECreds(),
      'Set E2E_USER_EMAIL / E2E_USER_PASSWORD to run authenticated flows.',
    );
    // Placeholder for the authenticated path — flesh out once test creds exist.
    // const login = new LoginPage(page); await login.goto('/chat'); ...
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/chat/);
  });
});
