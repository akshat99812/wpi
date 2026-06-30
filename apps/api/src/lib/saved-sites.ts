/**
 * Per-user "saved sites" store (Pro feature). A user may save up to
 * MAX_SAVED_SITES screened AOIs; each row holds the ring geometry + a compact
 * comparison summary as a JSON payload. Lives in the same SQLite DB as Better
 * Auth so all per-user records sit next to the `user` table.
 *
 * The store is a thin, synchronous data layer (bun:sqlite). The 3-site cap is
 * enforced inside a transaction (count-then-insert) so two near-simultaneous
 * saves can never both slip past it. All mutations are scoped by user_id, so a
 * user can only ever list / delete / rename their OWN rows.
 */

import { Database } from "bun:sqlite";

/** Hard cap on saved sites per user. Surfaced to the client so the UI matches. */
export const MAX_SAVED_SITES = 3;

export interface SavedSiteRow {
  id: string;
  name: string;
  /** Opaque JSON: { ring, centroid, areaKm2, isPointMode, summary }. */
  payload: string;
  created_at: string;
}

/** Thrown by create() when the per-user cap is already reached → HTTP 409. */
export class SavedSiteLimitError extends Error {
  readonly code = "SAVED_SITE_LIMIT";
  constructor(max: number) {
    super(`Saved-site limit reached (${max})`);
    this.name = "SavedSiteLimitError";
  }
}

export interface SavedSiteStore {
  list(userId: string): SavedSiteRow[];
  count(userId: string): number;
  /** @throws SavedSiteLimitError when the user is already at MAX_SAVED_SITES. */
  create(userId: string, name: string, payload: string): SavedSiteRow;
  remove(userId: string, id: string): boolean;
  rename(userId: string, id: string, name: string): SavedSiteRow | null;
}

/**
 * Build a store over a given Database. The default singleton uses the Better
 * Auth DB; tests inject an in-memory Database so they never touch the real one.
 */
export function createSavedSiteStore(db: Database): SavedSiteStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_site (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saved_site_user ON saved_site (user_id);`,
  );

  // Tiebreak on rowid (monotonic insertion order), not id: created_at has only
  // 1-second resolution, so two saves in the same second would otherwise order
  // by random UUID. rowid keeps "oldest first" stable regardless.
  const listStmt = db.query(
    `SELECT id, name, payload, created_at FROM saved_site
      WHERE user_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const countStmt = db.query(
    `SELECT count(*) AS n FROM saved_site WHERE user_id = ?`,
  );
  const insertStmt = db.query(
    `INSERT INTO saved_site (id, user_id, name, payload) VALUES (?, ?, ?, ?)`,
  );
  const getStmt = db.query(
    `SELECT id, name, payload, created_at FROM saved_site
      WHERE id = ? AND user_id = ?`,
  );
  const deleteStmt = db.query(
    `DELETE FROM saved_site WHERE id = ? AND user_id = ?`,
  );
  const renameStmt = db.query(
    `UPDATE saved_site SET name = ? WHERE id = ? AND user_id = ?`,
  );

  const countFor = (userId: string): number =>
    (countStmt.get(userId) as { n: number }).n;

  // count + insert atomically so a race can't exceed the cap.
  const createTxn = db.transaction(
    (userId: string, name: string, payload: string): SavedSiteRow => {
      if (countFor(userId) >= MAX_SAVED_SITES) {
        throw new SavedSiteLimitError(MAX_SAVED_SITES);
      }
      const id = crypto.randomUUID();
      insertStmt.run(id, userId, name, payload);
      return getStmt.get(id, userId) as SavedSiteRow;
    },
  );

  return {
    list: (userId) => listStmt.all(userId) as SavedSiteRow[],
    count: (userId) => countFor(userId),
    create: (userId, name, payload) => createTxn(userId, name, payload),
    remove: (userId, id) => deleteStmt.run(id, userId).changes > 0,
    rename: (userId, id, name) => {
      const res = renameStmt.run(name, id, userId);
      if (res.changes === 0) return null;
      return getStmt.get(id, userId) as SavedSiteRow;
    },
  };
}
