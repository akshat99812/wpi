import { test, expect } from '@playwright/test';
import { hasE2ECreds } from '../../fixtures/auth';

/**
 * Pro-gating is enforced two ways:
 *  - web middleware (middleware.ts) redirects unauthed visitors of Pro routes
 *    (e.g. /mast) to /login?next=<path>
 *  - the API re-validates the session on every Pro request (requirePro)
 *
 * The chatbot moved under the Research tab: /chat now 308-redirects to
 * /research/chatbot (next.config redirects run before middleware), and that
 * page is Pro-gated IN-PAGE (ChatBot shows "Pro subscription required" for
 * non-Pro users) rather than via the middleware /login bounce. These redirect
 * paths need no backend, so they run everywhere.
 */
test.describe('Pro route gating', () => {
  test('legacy /chat redirects to the Research chatbot', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForURL(/\/research\/chatbot/);
    expect(new URL(page.url()).pathname).toBe('/research/chatbot');
  });

  test('redirects unauthenticated /mast to /login', async ({ page }) => {
    await page.goto('/mast');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('authenticated user can reach the Research chatbot', async ({ page }) => {
    test.skip(
      !hasE2ECreds(),
      'Set E2E_USER_EMAIL / E2E_USER_PASSWORD to run authenticated flows.',
    );
    // Placeholder for the authenticated path — flesh out once test creds exist.
    // const login = new LoginPage(page); await login.goto('/research/chatbot'); ...
    await page.goto('/research/chatbot');
    await expect(page).toHaveURL(/\/research\/chatbot/);
  });
});
