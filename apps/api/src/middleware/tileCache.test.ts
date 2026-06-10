import { test, expect, beforeEach, afterEach } from "bun:test";
import express, { Request, Response } from "express";
import { promises as fs } from "fs";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import type { Server } from "http";

/**
 * Behavioral tests for the disk-backed tile cache. Each test builds a tiny
 * express app with a configurable fake handler, so the STALE / 204-fallback /
 * write-failure paths (which need a "down" upstream) are deterministic.
 *
 * NOTE: process.env.TILE_CACHE_DIR is read when tileCache() is CALLED, so the
 * import happens inside makeApp() after the env var is set.
 */

let cacheDir: string;
let server: Server | null = null;

beforeEach(() => {
  cacheDir = mkdtempSync(path.join(os.tmpdir(), "tilecache-test-"));
  process.env.TILE_CACHE_DIR = cacheDir;
});

afterEach(() => {
  server?.close();
  server = null;
  delete process.env.TILE_CACHE_DIR;
  rmSync(cacheDir, { recursive: true, force: true });
});

type Handler = (req: Request, res: Response) => void;

async function makeApp(
  handler: Handler,
  ttlMs?: number,
): Promise<{ url: string; calls: () => number }> {
  const { tileCache } = await import("./tileCache");
  let callCount = 0;
  const app = express();
  app.get("/tile/:id", tileCache("test", ttlMs), (req, res) => {
    callCount += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, calls: () => callCount };
}

function okHandler(body: Buffer): Handler {
  return (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.send(body);
  };
}

const downHandler: Handler = (_req, res) => {
  res.status(204).end();
};

test("MISS then HIT: second request is served from disk without the handler", async () => {
  const { url, calls } = await makeApp(okHandler(Buffer.from("tile-bytes")));

  const first = await fetch(`${url}/tile/a`);
  expect(first.status).toBe(200);
  expect(first.headers.get("x-cache")).toBe("MISS");
  expect(await first.text()).toBe("tile-bytes");

  // The cache write is async (fire-and-forget) — give it a beat.
  await Bun.sleep(50);

  const second = await fetch(`${url}/tile/a`);
  expect(second.status).toBe(200);
  expect(second.headers.get("x-cache")).toBe("HIT");
  expect(second.headers.get("content-type")).toContain("text/plain");
  expect(second.headers.get("cache-control")).toBe("public, max-age=60");
  expect(await second.text()).toBe("tile-bytes");
  expect(calls()).toBe(1);
});

test("cache key includes the query string (?v= busting)", async () => {
  const { url, calls } = await makeApp(okHandler(Buffer.from("x")));
  await fetch(`${url}/tile/a?v=1`);
  await Bun.sleep(50);
  await fetch(`${url}/tile/a?v=2`);
  expect(calls()).toBe(2);
});

test("Content-Encoding replay: gzipped bodies survive a HIT intact", async () => {
  const plain = Buffer.from("protobuf-ish payload for the encoding test");
  const { url } = await makeApp((_req, res) => {
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Content-Encoding", "gzip");
    res.send(gzipSync(plain));
  });

  await fetch(`${url}/tile/enc`);
  await Bun.sleep(50);

  const hit = await fetch(`${url}/tile/enc`);
  expect(hit.headers.get("x-cache")).toBe("HIT");
  // fetch auto-decompresses when (and only when) Content-Encoding: gzip is
  // replayed — if the meta sidecar were ignored these bytes would be raw
  // gzip and the comparison would fail.
  expect(Buffer.from(await hit.arrayBuffer()).toString()).toBe(plain.toString());

  // And the sidecar itself recorded the encoding.
  const metas = await findFiles(cacheDir, ".meta");
  expect(metas.length).toBe(1);
  const meta = JSON.parse(await fs.readFile(metas[0]!, "utf8"));
  expect(meta.ce).toBe("gzip");
});

test("STALE: TTL-expired entry is served when the handler degrades to 204", async () => {
  let down = false;
  const { url, calls } = await makeApp((req, res) => {
    if (down) downHandler(req, res);
    else okHandler(Buffer.from("stale-but-served"))(req, res);
  }, 30 /* ttlMs */);

  await fetch(`${url}/tile/s`);
  await Bun.sleep(80); // past TTL
  down = true;

  const res = await fetch(`${url}/tile/s`);
  expect(res.status).toBe(200);
  expect(res.headers.get("x-cache")).toBe("STALE");
  expect(await res.text()).toBe("stale-but-served");
  expect(calls()).toBe(2); // handler WAS attempted (refresh), then fell back
});

test("REFRESH: TTL-expired entry is replaced when the handler succeeds", async () => {
  let version = 1;
  const { url } = await makeApp((_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(Buffer.from(`v${version}`));
  }, 30);

  await fetch(`${url}/tile/r`);
  await Bun.sleep(80);
  version = 2;

  const res = await fetch(`${url}/tile/r`);
  expect(res.headers.get("x-cache")).toBe("REFRESH");
  expect(await res.text()).toBe("v2");
});

test("cold miss + degraded handler → 204 passes through", async () => {
  const { url } = await makeApp(downHandler);
  const res = await fetch(`${url}/tile/cold`);
  expect(res.status).toBe(204);
  expect(res.headers.get("x-cache")).toBeNull();
});

test("4xx passes through even when a stale entry exists", async () => {
  let fail = false;
  const { url } = await makeApp((req, res) => {
    if (fail) res.status(429).json({ error: "slow down" });
    else okHandler(Buffer.from("ok"))(req, res);
  }, 30);

  await fetch(`${url}/tile/f`);
  await Bun.sleep(80);
  fail = true;

  const res = await fetch(`${url}/tile/f`);
  expect(res.status).toBe(429);
});

test("write failure logs a warning and still serves the response", async () => {
  const warnings: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    // Make the namespace dir un-creatable: a FILE occupies its path.
    await fs.writeFile(path.join(cacheDir, "test"), "not-a-dir");
    const { url } = await makeApp(okHandler(Buffer.from("still-served")));

    const res = await fetch(`${url}/tile/w`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("still-served");

    await Bun.sleep(80);
    expect(
      warnings.some((args) => String(args[0]).includes("[tilecache] write failed")),
    ).toBe(true);
  } finally {
    console.warn = origWarn;
  }
});

test("passthrough when TILE_CACHE_DIR is unset outside production", async () => {
  delete process.env.TILE_CACHE_DIR;
  const { url, calls } = await makeApp(okHandler(Buffer.from("nocache")));
  await fetch(`${url}/tile/p`);
  await Bun.sleep(50);
  await fetch(`${url}/tile/p`);
  expect(calls()).toBe(2);
  const files = await findFiles(cacheDir, "");
  expect(files.length).toBe(0);
});

async function findFiles(dir: string, suffix: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findFiles(p, suffix)));
    else if (e.name.endsWith(suffix)) out.push(p);
  }
  return out;
}
