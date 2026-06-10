import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  // Don't crash the API on startup if the Pro-map DB is offline — the windmills
  // routes will surface a 503 themselves. Other routes (chat, data, etc.) keep
  // working. This makes local dev sane when PostGIS isn't up yet.
  console.warn("[db] DATABASE_URL not set — windmills routes will 503");
}

export const pool = new pg.Pool({
  connectionString: url,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export function dbAvailable(): boolean {
  return Boolean(url);
}
