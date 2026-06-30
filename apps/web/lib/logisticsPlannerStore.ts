// Keeps the embedded Turbine Logistics Planner's UI state alive across a
// pro-map tab switch. The map *routes* already survive via logisticsRouteStore,
// but the planner panel itself (its form inputs, computed plan, and whether it's
// expanded) lives in React state inside the Site-analysis tab — and that whole
// subtree unmounts the moment you switch to the Masts/Offshore tab, wiping it.
//
// Mirrors savedSitesMapStore: a module-level cache that outlives the unmounting
// tab. Single-slot and keyed by the planning context (destination + turbine
// count), so only the most-recently-planned site is retained — selecting a new
// AOI uses a fresh key and starts clean, with no unbounded growth.

import type { PlanResponse } from "@/lib/logistics";

export interface LogisticsPlannerSnapshot {
  /** PlanLogisticsButton expanded? (owned by the button, patched separately.) */
  open?: boolean;
  /** Planner form inputs (owned by LogisticsPlanner). */
  form?: {
    oem: string;
    model: string;
    scope: string;
    component: string;
    lat: string;
    lon: string;
    siteName: string;
    numTurbines: number;
    terrain: string;
    origins: Record<string, string>;
    showAdvanced: boolean;
  };
  /** Last computed plan + any compute error (transient `computing` is not kept). */
  plan?: PlanResponse | null;
  error?: string | null;
}

let slotKey: string | null = null;
let slotSnap: LogisticsPlannerSnapshot = {};

/** Read the snapshot for `key`, or null if a different site is cached. */
export function readLogisticsSnapshot(
  key: string,
): LogisticsPlannerSnapshot | null {
  return slotKey === key ? slotSnap : null;
}

/** Merge `partial` into the snapshot for `key`. A new key clears the old slot,
 *  so switching to a different site never inherits stale state. Two writers
 *  (the expand button and the planner) patch disjoint fields safely. */
export function patchLogisticsSnapshot(
  key: string,
  partial: LogisticsPlannerSnapshot,
): void {
  if (slotKey !== key) {
    slotKey = key;
    slotSnap = {};
  }
  slotSnap = { ...slotSnap, ...partial };
}
