/**
 * Site-Analysis PDF Export — shared Chromium lifecycle (plan §5.1, decision D5).
 *
 * Lazily launch ONE shared browser; never launch-per-request. A concurrency
 * semaphore (REPORT_BROWSER_POOL_SIZE) + bounded acquire wait gives backpressure
 * (503 + Retry-After) instead of an unbounded queue. Pages always close in a
 * `finally`. An AbortSignal frees the page immediately on client disconnect.
 *
 * SCAFFOLD (PR0): typed stub — the real pool lands in PR10. The Bun+Puppeteer
 * launch path was smoke-tested in PR0 (launch + page.pdf → valid %PDF buffer).
 */

import type { Page } from "puppeteer";

export interface WithPageOptions {
  /** From the request (req.on('close')) — abort frees the page on disconnect. */
  signal?: AbortSignal;
  /** Max wait for a free permit before throwing PoolBusyError → 503. */
  acquireTimeoutMs?: number;
}

export class PoolBusyError extends Error {
  constructor() {
    super("render pool busy");
    this.name = "PoolBusyError";
  }
}

/** Acquire a page, run `fn`, guarantee close + permit release. Implemented PR10. */
export async function withPage<T>(
  _fn: (page: Page) => Promise<T>,
  _opts?: WithPageOptions,
): Promise<T> {
  throw new Error("browserPool.withPage: not implemented (PR10)");
}

/** Graceful shutdown on SIGTERM. No-op until the pool exists (PR10). */
export async function shutdownBrowserPool(): Promise<void> {
  /* no-op (PR0 scaffold) */
}
