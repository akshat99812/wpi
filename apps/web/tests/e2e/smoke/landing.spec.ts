import { test, expect } from '@playwright/test';
import { LandingPage } from '../../pages/LandingPage';

test.describe('Landing page', () => {
  let landing: LandingPage;

  test.beforeEach(async ({ page }) => {
    landing = new LandingPage(page);
    await landing.goto();
  });

  test('loads with the correct title', async () => {
    await landing.expectLoaded();
  });

  test('renders a hero heading', async () => {
    await expect(landing.heroHeading).toBeVisible();
  });

  test('shows the installed-capacity hero stat', async () => {
    // Value sourced from HERO_STATS in app/page.tsx (MNRE physical progress).
    await expect(landing.statTile('56.44 GW')).toBeVisible();
  });

  test('exposes a path to log in', async () => {
    await expect(landing.loginLink).toBeVisible();
  });
});
