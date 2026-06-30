"use client";

// Which saved sites are currently *shown on the map* as outline overlays.
// Separate from savedSitesStore (the persisted list): this is ephemeral view
// state, and lives in its own module store so it survives the Saved-sites tab
// unmounting (tab switch) and is shared between the tab (toggles) and the
// pro-map page (renders the overlay layer). Mirrors logisticsRouteStore's
// replay-on-subscribe pub/sub.

import { useSyncExternalStore } from "react";
import type { SavedSite } from "./savedSites";

let shown: SavedSite[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getShownSavedSites(): SavedSite[] {
  return shown;
}

export function isSavedSiteShown(id: string): boolean {
  return shown.some((s) => s.id === id);
}

/** Add/remove a site from the on-map overlay (multiple may be shown at once). */
export function toggleShownSavedSite(site: SavedSite): void {
  shown = shown.some((s) => s.id === site.id)
    ? shown.filter((s) => s.id !== site.id)
    : [...shown, site];
  emit();
}

export function hideShownSavedSite(id: string): void {
  if (!shown.some((s) => s.id === id)) return;
  shown = shown.filter((s) => s.id !== id);
  emit();
}

export function clearShownSavedSites(): void {
  if (shown.length === 0) return;
  shown = [];
  emit();
}

/** Drop shown sites that no longer exist (e.g. after a delete) and refresh the
 *  stored copy of any that changed (e.g. after a rename), keyed by id. */
export function reconcileShownSavedSites(current: SavedSite[]): void {
  const byId = new Map(current.map((s) => [s.id, s]));
  const next = shown
    .filter((s) => byId.has(s.id))
    .map((s) => byId.get(s.id)!);
  const changed =
    next.length !== shown.length || next.some((s, i) => s !== shown[i]);
  if (changed) {
    shown = next;
    emit();
  }
}

/** Subscribe to the shown-sites overlay set (the page + the tab both use this). */
export function useShownSavedSites(): SavedSite[] {
  return useSyncExternalStore(subscribe, getShownSavedSites, getShownSavedSites);
}
