/**
 * Bounded-wait counting semaphore for the render pool (plan §5.1).
 *
 * Backpressure, NOT an unbounded queue: a caller waits at most `timeoutMs` for a
 * permit, then gets PoolBusyError (→ the controller maps it to 503 + Retry-After).
 * An AbortSignal frees a waiter immediately (client disconnect). Permits are
 * handed to waiters FIFO. Extracted from browserPool so this logic is unit-
 * testable without launching Chromium.
 */

export class PoolBusyError extends Error {
  constructor() {
    super("render pool busy");
    this.name = "PoolBusyError";
  }
}

/** A cross-runtime "aborted" error (name === "AbortError"). */
export function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

interface Waiter {
  settled: boolean;
  resolve: () => void;
  reject: (e: Error) => void;
}

export class Semaphore {
  private available: number;
  private readonly queue: Waiter[] = [];

  constructor(size: number) {
    this.available = Math.max(1, Math.floor(size));
  }

  /** Free permits right now. */
  get free(): number {
    return this.available;
  }

  /** Callers currently blocked waiting for a permit. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Acquire a permit. Resolves immediately if one is free; otherwise waits up to
   * `timeoutMs` (→ PoolBusyError) or until `signal` aborts (→ AbortError).
   */
  acquire(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        resolve: () => settle(resolve),
        reject: (e) => settle(() => reject(e)),
      };
      const settle = (fn: () => void) => {
        if (waiter.settled) return;
        waiter.settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
        fn();
      };
      const onAbort = () => waiter.reject(abortError());
      const timer = setTimeout(
        () => waiter.reject(new PoolBusyError()),
        timeoutMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  /** Release a permit — handed directly to the next live waiter (FIFO), else returned. */
  release(): void {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (waiter && !waiter.settled) {
        waiter.resolve();
        return;
      }
    }
    this.available += 1;
  }
}
