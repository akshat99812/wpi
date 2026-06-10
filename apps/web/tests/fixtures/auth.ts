import { test as base, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * Auth fixtures for Pro-gated flows (`/chat`, `/mast`, finance dashboard).
 *
 * Real enforcement lives in the API (`requirePro`); the web middleware only
 * checks for the presence of the Better Auth session cookie
 * (`wpi.session_token` in dev). To exercise authenticated UI you need real
 * credentials for a Pro user — set them via env:
 *
 *   E2E_USER_EMAIL=...   E2E_USER_PASSWORD=...
 *
 * Specs that need auth should pull the `proUser` page fixture. When creds are
 * absent the fixture throws a clear message; gate such specs with
 * `test.skip(!hasE2ECreds(), ...)` so the suite stays green locally.
 */

export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL;
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD;

export function hasE2ECreds(): boolean {
  return Boolean(E2E_USER_EMAIL && E2E_USER_PASSWORD);
}

/** Log in through the real UI and wait for the session cookie to land. */
async function loginViaUi(page: Page): Promise<void> {
  if (!hasE2ECreds()) {
    throw new Error(
      'proUser fixture requires E2E_USER_EMAIL and E2E_USER_PASSWORD env vars.',
    );
  }
  const login = new LoginPage(page);
  await login.goto();
  await login.login(E2E_USER_EMAIL!, E2E_USER_PASSWORD!);
  // Better Auth sets the session cookie on a successful sign-in; the form then
  // routes away from /login. Wait for the navigation rather than a fixed delay.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

type AuthFixtures = {
  /** A Page already authenticated as a Pro user via the real login flow. */
  proUser: Page;
};

export const test = base.extend<AuthFixtures>({
  proUser: async ({ page }, use) => {
    await loginViaUi(page);
    await use(page);
  },
});

export { expect };
