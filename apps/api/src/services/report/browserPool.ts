/**
 * Site-Analysis PDF Export — shared Chromium lifecycle (plan §5.1, decision D5).
 *
 * Lazily launch ONE shared browser; never launch-per-request. A concurrency
 * semaphore (REPORT_BROWSER_POOL_SIZE) + bounded acquire wait gives backpressure
 * (503 + Retry-After) instead of an unbounded queue. Pages always close in a
 * `finally`. An AbortSignal frees the page immediately on client disconnect.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";

import { REPORT_BROWSER_POOL_SIZE } from "./config";
import { abortError, PoolBusyError, Semaphore } from "./semaphore";

export { PoolBusyError };

export interface WithPageOptions {
  /** From the request (req.on('close')) — abort frees the page on disconnect. */
  signal?: AbortSignal;
  /** Max wait for a free permit before throwing PoolBusyError → 503. */
  acquireTimeoutMs?: number;
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 3_000;

const semaphore = new Semaphore(REPORT_BROWSER_POOL_SIZE);

let browserPromise: Promise<Browser> | null = null;
let sigtermHooked = false;

function launchBrowser(): Promise<Browser> {
  if (!sigtermHooked) {
    sigtermHooked = true;
    // Graceful shutdown so a redeploy/SIGTERM closes Chromium, not orphans it.
    process.once("SIGTERM", () => void shutdownBrowserPool());
  }
  return puppeteer.launch({
    headless: true,
    // --no-sandbox is required under container isolation (plan §9.1); harmless
    // in local dev. PUPPETEER_EXECUTABLE_PATH lets the container point at a
    // system Chromium with fonts installed (PR14); undefined → bundled Chromium.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}

/** The shared browser, relaunched if a previous instance disconnected/crashed. */
async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.connected) return existing;
    } catch {
      /* fall through to relaunch */
    }
    browserPromise = null;
  }
  browserPromise ??= launchBrowser();
  return browserPromise;
}

/** Reject `p` as soon as `signal` aborts (client disconnect), else pass through. */
function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", onAbort),
    );
  });
}

/**
 * Acquire a pooled page, run `fn`, and guarantee the page closes + the permit
 * releases. Throws PoolBusyError when no permit frees within the acquire window
 * (→ 503), or an AbortError when the client disconnects.
 */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  opts?: WithPageOptions,
): Promise<T> {
  // Bail before taking a permit if the client already went away.
  if (opts?.signal?.aborted) throw abortError();
  await semaphore.acquire(
    opts?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
    opts?.signal,
  );
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    return await withAbort(fn(page), opts?.signal);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* page may already be gone; ignore */
      }
    }
    semaphore.release();
  }
}

/** Free permits + waiters, for metrics/backpressure tuning. */
export function poolStats(): { free: number; waiting: number } {
  return { free: semaphore.free, waiting: semaphore.waiting };
}

/** Graceful shutdown on SIGTERM — close the shared browser if it was launched. */
export async function shutdownBrowserPool(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* already closed / never fully launched */
  }
}
