/**
 * AOI permalinks: ring (6-dp rounded, matching the server's cache
 * canonicalization) → deflate-raw → base64url in the URL hash, as
 * `#aoi=<payload>`. Decoding is fully defensive — a mangled hash returns
 * null, never throws.
 *
 * Uses the native CompressionStream/DecompressionStream (Chrome 80+/FF 113+/
 * Safari 16.4+); if unavailable, falls back to uncompressed base64url with a
 * `0` version prefix so links still work everywhere.
 */

const HASH_KEY = "aoi";
const PREFIX_DEFLATE = "1";
const PREFIX_PLAIN = "0";
const COORD_DECIMALS = 6;
const MAX_PAYLOAD_CHARS = 16_384; // hostile-hash guard
const MAX_VERTICES = 105; // server cap + closing vertex headroom

function round6(v: number): number {
  return Math.round(v * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const compressed = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** Ring → hash payload (without the leading '#'). */
export async function encodeAoiHash(ring: [number, number][]): Promise<string> {
  const rounded = ring.map(([lon, lat]) => [round6(lon), round6(lat)]);
  const json = new TextEncoder().encode(JSON.stringify(rounded));
  if (typeof CompressionStream === "undefined") {
    return `${HASH_KEY}=${PREFIX_PLAIN}${toBase64Url(json)}`;
  }
  const deflated = await pipeThrough(json, new CompressionStream("deflate-raw"));
  return `${HASH_KEY}=${PREFIX_DEFLATE}${toBase64Url(deflated)}`;
}

/** Current location.hash → ring, or null if absent/invalid. */
export async function decodeAoiHash(hash: string): Promise<[number, number][] | null> {
  const m = /(?:^|[#&])aoi=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m || m[1].length < 2 || m[1].length > MAX_PAYLOAD_CHARS) return null;
  const version = m[1][0];
  const bytes = fromBase64Url(m[1].slice(1));
  if (!bytes) return null;

  try {
    const json =
      version === PREFIX_DEFLATE
        ? await pipeThrough(bytes, new DecompressionStream("deflate-raw"))
        : bytes;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(json));
    if (!Array.isArray(parsed) || parsed.length < 4 || parsed.length > MAX_VERTICES) {
      return null;
    }
    const ring: [number, number][] = [];
    for (const v of parsed) {
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        typeof v[0] !== "number" ||
        typeof v[1] !== "number" ||
        !Number.isFinite(v[0]) ||
        !Number.isFinite(v[1])
      ) {
        return null;
      }
      ring.push([v[0], v[1]]);
    }
    return ring;
  } catch {
    return null;
  }
}

/** Write (or clear) the AOI hash without adding history entries. */
export function setAoiHash(payload: string | null): void {
  const url = new URL(window.location.href);
  url.hash = payload ?? "";
  window.history.replaceState(null, "", url.toString());
}
