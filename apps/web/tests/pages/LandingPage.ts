import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the public landing page (`/`).
 *
 * Selectors prefer accessible roles and stable copy over CSS classes so the
 * tests survive styling changes. Hero stat values come from
 * `apps/web/app/page.tsx` (HERO_STATS).
 */
export class LandingPage {
  readonly page: Page;
  readonly heroHeading: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    // First H1/role heading in the hero. Kept loose on purpose.
    this.heroHeading = page.getByRole('heading', { level: 1 }).first();
    this.loginLink = page.getByRole('link', { name: /log ?in/i }).first();
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  /** A hero stat tile rendered with its value text, e.g. "56.44 GW". */
  statTile(value: string): Locator {
    return this.page.getByText(value, { exact: false }).first();
  }

  async expectLoaded() {
    await expect(this.page).toHaveTitle(/Wind Power India/i);
  }
}
