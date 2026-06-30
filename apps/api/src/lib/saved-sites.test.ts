import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createSavedSiteStore,
  SavedSiteLimitError,
  MAX_SAVED_SITES,
} from "./saved-sites";

/** A fresh store over an isolated in-memory DB (never touches the real auth DB). */
function freshStore() {
  return createSavedSiteStore(new Database(":memory:"));
}

const payload = (tag: string) =>
  JSON.stringify({
    ring: [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ],
    summary: { tag },
  });

test("enforces the per-user cap (3) and rejects the 4th", () => {
  const s = freshStore();
  s.create("u1", "A", payload("a"));
  s.create("u1", "B", payload("b"));
  s.create("u1", "C", payload("c"));
  expect(s.count("u1")).toBe(MAX_SAVED_SITES);
  expect(() => s.create("u1", "D", payload("d"))).toThrow(SavedSiteLimitError);
  expect(s.count("u1")).toBe(MAX_SAVED_SITES);
});

test("the cap is per-user, not global", () => {
  const s = freshStore();
  s.create("u1", "A", payload("a"));
  s.create("u1", "B", payload("b"));
  s.create("u1", "C", payload("c"));
  const row = s.create("u2", "A2", payload("a2")); // different user → allowed
  expect(row.name).toBe("A2");
  expect(s.count("u2")).toBe(1);
});

test("list returns only the owner's sites, oldest first", () => {
  const s = freshStore();
  s.create("u1", "first", payload("1"));
  s.create("u1", "second", payload("2"));
  s.create("u2", "other", payload("o"));
  const mine = s.list("u1");
  expect(mine.map((r) => r.name)).toEqual(["first", "second"]);
  expect(s.list("u2").map((r) => r.name)).toEqual(["other"]);
});

test("delete only removes the caller's own row", () => {
  const s = freshStore();
  const row = s.create("u1", "A", payload("a"));
  expect(s.remove("u2", row.id)).toBe(false); // not the owner → no-op
  expect(s.count("u1")).toBe(1);
  expect(s.remove("u1", row.id)).toBe(true);
  expect(s.count("u1")).toBe(0);
});

test("deleting frees a slot under the cap", () => {
  const s = freshStore();
  const a = s.create("u1", "A", payload("a"));
  s.create("u1", "B", payload("b"));
  s.create("u1", "C", payload("c"));
  expect(() => s.create("u1", "D", payload("d"))).toThrow(SavedSiteLimitError);
  s.remove("u1", a.id);
  const d = s.create("u1", "D", payload("d")); // now there's room
  expect(d.name).toBe("D");
  expect(s.count("u1")).toBe(3);
});

test("rename only affects the owner's row and returns the updated row", () => {
  const s = freshStore();
  const row = s.create("u1", "A", payload("a"));
  expect(s.rename("u2", row.id, "Hijack")).toBeNull(); // not owner → null
  const updated = s.rename("u1", row.id, "Renamed");
  expect(updated?.name).toBe("Renamed");
  expect(s.list("u1")[0]?.name).toBe("Renamed");
});

test("rename of a missing id returns null", () => {
  const s = freshStore();
  expect(s.rename("u1", "does-not-exist", "X")).toBeNull();
});
