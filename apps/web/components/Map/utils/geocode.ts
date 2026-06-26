/**
 * Place geocoding for the Pro map search box.
 *
 * Uses Photon (https://photon.komoot.io) — a free, key-less OSM-backed
 * geocoder. Results are biased toward India (the map's home extent) by passing
 * a centre lat/lon; Photon ranks nearer matches higher but still returns global
 * places, so a user can search anywhere.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";

// India centroid — the Pro map's default centre. Used only to bias result
// ranking toward Indian places; it does not restrict the search.
const BIAS_LAT = 22.5937;
const BIAS_LON = 78.9629;

const RESULT_LIMIT = 6;
const MIN_QUERY_LEN = 2;

export interface PlaceResult {
  /** Stable key for React lists (osm id + coords). */
  id: string;
  /** Primary label, e.g. "Jaisalmer". */
  name: string;
  /** Secondary context, e.g. "Rajasthan, India". Empty when unavailable. */
  detail: string;
  lat: number;
  lon: number;
  /** Optional extent [west, south, east, north] for fitBounds, when known. */
  bounds?: [number, number, number, number];
}

interface PhotonProps {
  name?: string;
  street?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  osm_id?: number;
  osm_type?: string;
  /** Photon order: [minLon, maxLat, maxLon, minLat] = [west, north, east, south]. */
  extent?: [number, number, number, number];
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: PhotonProps;
}

/** Build a readable "City, State, Country" detail line, skipping blanks/dupes. */
function buildDetail(p: PhotonProps): string {
  const parts = [p.city ?? p.county, p.state, p.country]
    .filter((v): v is string => Boolean(v))
    .filter((v) => v !== p.name);
  // De-duplicate consecutive repeats (e.g. city === state).
  return parts.filter((v, i) => v !== parts[i - 1]).join(", ");
}

/** Map Photon's extent [w, n, e, s] → maplibre bounds [w, s, e, n]. */
function toBounds(
  extent?: [number, number, number, number],
): [number, number, number, number] | undefined {
  if (!extent || extent.length !== 4) return undefined;
  const [west, north, east, south] = extent;
  return [west, south, east, north];
}

/**
 * Search for places matching `query`. Returns at most {@link RESULT_LIMIT}
 * results. Returns an empty array for too-short queries. Throws on network or
 * HTTP failure so the caller can surface an error state.
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return [];

  const params = new URLSearchParams({
    q,
    limit: String(RESULT_LIMIT),
    lang: "en",
    lat: String(BIAS_LAT),
    lon: String(BIAS_LON),
  });

  const res = await fetch(`${PHOTON_URL}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Geocoder error ${res.status}`);

  const data = (await res.json()) as { features?: PhotonFeature[] };
  if (!Array.isArray(data.features)) return [];

  const results: PlaceResult[] = [];
  for (const f of data.features) {
    const coords = f.geometry?.coordinates;
    const props = f.properties;
    // Skip malformed features — never trust the external payload's shape.
    if (!coords || coords.length !== 2 || !props?.name) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    results.push({
      id: `${props.osm_type ?? "x"}${props.osm_id ?? ""}:${lon.toFixed(5)},${lat.toFixed(5)}`,
      name: props.name,
      detail: buildDetail(props),
      lat,
      lon,
      bounds: toBounds(props.extent),
    });
  }
  return results;
}
