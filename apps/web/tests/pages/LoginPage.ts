import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the login page (`/login`).
 *
 * The form fields are rendered by the shared `Field` component with
 * `label="Email"` / `label="Password"`, so `getByLabel` is reliable without
 * adding test-ids. Submit is the "Log in" button.
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel(/email/i);
    this.passwordInput = page.getByLabel(/password/i);
    this.submitButton = page.getByRole('button', { name: /log ?in/i });
    this.error = page.getByText(/incorrect email or password|error/i);
  }

  /** Navigate to /login, optionally preserving a ?next= target. */
  async goto(next?: string) {
    const url = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectLoaded() {
    await expect(this.submitButton).toBeVisible();
  }
}
