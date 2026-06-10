import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Wind Power India web app (Next.js 14, App Router).
 *
 * - Tests live in `tests/e2e`. Page Objects in `tests/pages`, fixtures in
 *   `tests/fixtures`.
 * - In dev the app runs at `/` (NEXT_PUBLIC_BASE_PATH empty); in prod it's
 *   served under `/terminal`. Override the base via BASE_URL when pointing at a
 *   deployed environment.
 * - `webServer` starts `bun run dev` only if nothing is already listening on
 *   :3000, so a dev server you already have running is reused.
 */

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  // Output for traces/screenshots/videos. Gitignored.
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Add more browsers once their binaries are installed:
    //   bunx playwright install firefox webkit
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
  },
});
