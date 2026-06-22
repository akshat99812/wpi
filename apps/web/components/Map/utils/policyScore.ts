// Pro-map "Policy score" choropleth: fills each state by its composite
// wind-investment attractiveness score (best → worst). Data comes from the
// Pro-gated /api/policy/score endpoint (GeoJSON, computed in scoring.ts).

import type { Map as MlMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

const SOURCE_ID = "policy-score";
export const POLICY_SCORE_FILL_LAYER_ID = "policy-score-fill";
export const POLICY_SCORE_OUTLINE_LAYER_ID = "policy-score-outline";

const RED = "#ef4444";
const AMBER = "#f59e0b";
const GREEN = "#10b981";

export interface PolicyScoreProps {
  state_code: string;
  name: string;
  score: number;
  rank: number;
  grade: string;
  coverage: number;
}
export type PolicyScoreFC = GeoJSON.FeatureCollection<GeoJSON.Geometry, PolicyScoreProps>;

let cache: Promise<PolicyScoreFC> | null = null;

export function fetchPolicyScores(force = false): Promise<PolicyScoreFC> {
  if (force) cache = null;
  if (!cache) {
    cache = fetch(`${API_URL}/api/policy/score`, { credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error(`policy score ${r.status}`);
      return r.json() as Promise<PolicyScoreFC>;
    });
  }
  return cache;
}

function hexLerp(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Red(worst) → amber(mid) → green(best) for a score within [min,max]. Shared by
// the map fill and the legend swatches so they always agree.
export function scoreToColor(score: number, min: number, max: number): string {
  if (max <= min) return AMBER;
  const t = Math.max(0, Math.min(1, (score - min) / (max - min)));
  return t < 0.5 ? hexLerp(RED, AMBER, t * 2) : hexLerp(AMBER, GREEN, (t - 0.5) * 2);
}

// Add the choropleth. Idempotent. Colors stretch across the actual score range
// so the 8 states span the full red→green ramp.
export async function addPolicyScore(
  map: MlMap,
  opts: { beforeId?: string; visible?: boolean } = {},
): Promise<void> {
  let fc: PolicyScoreFC;
  try {
    fc = await fetchPolicyScores();
  } catch (err) {
    console.error("[policy-score] failed to load scores", err);
    return;
  }
  if (!map.getCanvas()) return;

  const scores = fc.features.map((f) => f.properties.score);
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 100;
  const mid = (min + max) / 2;

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc as GeoJSON.FeatureCollection });
  }

  const beforeId = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;

  if (!map.getLayer(POLICY_SCORE_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: POLICY_SCORE_FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "score"],
            min, RED,
            mid, AMBER,
            max <= min ? min + 1 : max, GREEN,
          ],
          "fill-opacity": 0.55,
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(POLICY_SCORE_OUTLINE_LAYER_ID)) {
    map.addLayer(
      {
        id: POLICY_SCORE_OUTLINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": "rgba(255,255,255,0.5)", "line-width": 0.8 },
      },
      beforeId,
    );
  }

  // Apply initial visibility here (layers were added asynchronously, so the
  // caller can't initVis immediately after).
  setPolicyScoreVisibility(map, opts.visible ?? true);

  // Click → quick readout of rank/score/grade.
  const popup = new maplibregl.Popup({ closeButton: false });
  map.on("click", POLICY_SCORE_FILL_LAYER_ID, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as unknown as PolicyScoreProps;
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${p.name}</strong><br/>#${p.rank} of 8 · score ${p.score} · grade ${p.grade}`,
      )
      .addTo(map);
  });
}

export function setPolicyScoreVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of [POLICY_SCORE_FILL_LAYER_ID, POLICY_SCORE_OUTLINE_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  } catch (err) {
    console.error("[policy-score] could not set visibility", err);
  }
}
