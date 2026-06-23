/**
 * Unit tests for the render-pool semaphore (plan §5.1) — the backpressure +
 * cancellation logic, isolated from Chromium so it runs fast + deterministic.
 */

import { describe, expect, test } from "bun:test";

import { PoolBusyError, Semaphore } from "./semaphore";

describe("Semaphore — permits", () => {
  test("hands out up to `size` permits immediately", async () => {
    const s = new Semaphore(2);
    expect(s.free).toBe(2);
    await s.acquire(50);
    await s.acquire(50);
    expect(s.free).toBe(0);
  });

  test("an over-capacity acquire times out with PoolBusyError", async () => {
    const s = new Semaphore(1);
    await s.acquire(50);
    await expect(s.acquire(20)).rejects.toBeInstanceOf(PoolBusyError);
    expect(s.waiting).toBe(0); // the timed-out waiter is removed from the queue
  });

  test("release hands the permit to the next waiter (FIFO)", async () => {
    const s = new Semaphore(1);
    await s.acquire(1000);
    let first = false;
    let second = false;
    const p1 = s.acquire(1000).then(() => {
      first = true;
    });
    const p2 = s.acquire(1000).then(() => {
      second = true;
    });
    expect(s.waiting).toBe(2);

    s.release();
    await p1;
    expect(first).toBe(true);
    expect(second).toBe(false);

    s.release();
    await p2;
    expect(second).toBe(true);
    expect(s.free).toBe(0); // both permits are out, none leaked back
  });

  test("release returns the permit when nobody is waiting", async () => {
    const s = new Semaphore(1);
    await s.acquire(50);
    expect(s.free).toBe(0);
    s.release();
    expect(s.free).toBe(1);
  });
});

describe("Semaphore — abort (client disconnect)", () => {
  test("an already-aborted signal rejects with AbortError", async () => {
    const s = new Semaphore(1);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(s.acquire(50, ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(s.free).toBe(1); // never took a permit
  });

  test("aborting while queued rejects and dequeues the waiter", async () => {
    const s = new Semaphore(1);
    await s.acquire(1000);
    const ctrl = new AbortController();
    const p = s.acquire(1000, ctrl.signal);
    expect(s.waiting).toBe(1);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(s.waiting).toBe(0);
  });
});
