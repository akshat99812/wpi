"use client";

// Shared client store for saved sites. Both the "Save site" button (in the
// analysis results) and the "Saved sites" tool tab read/write the same list, so
// it lives in a tiny module-level store (mirrors logisticsRouteStore's pub/sub)
// exposed through a useSyncExternalStore hook. Persistence is delegated to the
// API client in ./savedSites; this store is the in-memory cache + subscribers.

import { useSyncExternalStore, useEffect } from "react";
import {
  fetchSavedSites,
  createSavedSite,
  deleteSavedSite,
  renameSavedSite,
  type SavedSite,
  type SavedSitePayload,
} from "./savedSites";

interface SavedSitesState {
  sites: SavedSite[];
  max: number;
  loading: boolean;
  error: string | null;
  /** True once the first fetch has resolved (success or failure). */
  loaded: boolean;
}

const DEFAULT_MAX = 3;

let state: SavedSitesState = {
  sites: [],
  max: DEFAULT_MAX,
  loading: false,
  error: null,
  loaded: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<SavedSitesState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SavedSitesState {
  return state;
}

// Single in-flight guard so the button + tab mounting together fire only one
// initial GET.
let inflight: Promise<void> | null = null;
// Bumped by every local mutation. A refresh that began before a mutation landed
// must NOT overwrite the optimistic list with its now-stale server snapshot
// (the GET may have read the DB before the mutation's write committed).
let mutationSeq = 0;

export function refreshSavedSites(force = false): Promise<void> {
  if (inflight) return inflight;
  if (state.loaded && !force) return Promise.resolve();
  const seq = mutationSeq;
  setState({ loading: true, error: null });
  inflight = fetchSavedSites()
    .then(({ sites, max }) => {
      // A save/delete/rename landed while this GET was in flight → keep the
      // optimistic list (newer than the snapshot we just read); only clear the
      // loading flag and adopt the authoritative `max`.
      if (mutationSeq !== seq) {
        setState({ max, loading: false, loaded: true });
        return;
      }
      setState({ sites, max, loading: false, loaded: true });
    })
    .catch((e: unknown) =>
      setState({
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : "Failed to load saved sites",
      }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Save a site; the returned site is appended to the list. Throws (incl.
 *  SavedSiteLimitError) so the caller can surface the message. */
export async function saveSite(payload: SavedSitePayload): Promise<SavedSite> {
  const { site } = await createSavedSite(payload);
  mutationSeq++;
  setState({ sites: [...state.sites, site], loaded: true });
  return site;
}

export async function removeSite(id: string): Promise<void> {
  await deleteSavedSite(id);
  mutationSeq++;
  setState({ sites: state.sites.filter((s) => s.id !== id) });
}

export async function renameSite(id: string, name: string): Promise<void> {
  const { site } = await renameSavedSite(id, name);
  mutationSeq++;
  setState({ sites: state.sites.map((s) => (s.id === site.id ? site : s)) });
}

/** Subscribe to the saved-sites store; auto-loads on first mount. */
export function useSavedSites() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void refreshSavedSites();
  }, []);
  return {
    ...snapshot,
    refresh: () => refreshSavedSites(true),
    save: saveSite,
    remove: removeSite,
    rename: renameSite,
  };
}
