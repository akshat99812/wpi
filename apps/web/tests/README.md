# E2E tests (Playwright)

End-to-end tests for the Wind Power India web app (Next.js 14, App Router).

## Layout

```
tests/
├── e2e/
│   ├── smoke/landing.spec.ts      # public landing page loads + key content
│   └── auth/pro-gating.spec.ts    # /chat,/mast redirect to /login when unauthed
├── pages/                         # Page Object Model
│   ├── LandingPage.ts
│   └── LoginPage.ts
└── fixtures/
    └── auth.ts                    # proUser fixture + hasE2ECreds() helper
```

Config: `apps/web/playwright.config.ts`.

## Running

From `apps/web`:

```bash
bun run test:e2e            # headless, all specs
bun run test:e2e:headed     # headed browser
bun run test:e2e:ui         # interactive UI mode
bun run test:e2e:report     # open the last HTML report
```

The config's `webServer` runs `bun run dev` on :3000 automatically, and reuses
a dev server you already have running (`reuseExistingServer` when not in CI).
Point at a deployed environment with `BASE_URL=https://… bun run test:e2e`.

## Authenticated (Pro) flows

`/chat`, `/mast`, and the finance dashboard sit behind the Better Auth session
cookie (web middleware) and `requirePro` (API). The unauthenticated redirect is
covered with no setup. To exercise *authenticated* flows, provide a real Pro
user's credentials:

```bash
E2E_USER_EMAIL=you@example.com E2E_USER_PASSWORD=… bun run test:e2e
```

Specs that need auth use the `proUser` fixture from `fixtures/auth.ts` and skip
themselves when these env vars are absent, so the suite stays green locally.

## Adding browsers

The scaffold ships Chromium only. To add more, install the binaries and
uncomment the projects in `playwright.config.ts`:

```bash
bunx playwright install firefox webkit
```

## Conventions

- Prefer accessible selectors (`getByRole`, `getByLabel`, `getByText`) over CSS
  classes. Add `data-testid` only where copy/roles are ambiguous.
- Wait for conditions (`waitForURL`, `waitForResponse`, locator auto-wait), not
  fixed timeouts.
- Keep selectors in Page Objects, assertions in specs.
```
