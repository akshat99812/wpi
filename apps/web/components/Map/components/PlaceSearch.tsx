"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { searchPlaces, type PlaceResult } from "../utils/geocode";

/**
 * Pro-map place search.
 *
 * A floating search box (docked top-centre by the parent) that geocodes a
 * free-text place query via {@link searchPlaces} and flies the map to the
 * chosen result, dropping a temporary marker. Self-contained: owns its query /
 * results / marker state and cleans the marker up on unmount.
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;
// Zoom for a point result with no known extent (a single building/POI).
const POINT_ZOOM = 12;
// Cap fitBounds so a tiny extent (a village) doesn't zoom in absurdly far.
const BOUNDS_MAX_ZOOM = 13;
const MARKER_COLOR = "#38bdf8"; // sky-400 — matches the Pro-map accent.

interface Props {
  mapRef: React.RefObject<MlMap | null>;
}

export function PlaceSearch({ mapRef }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const abortRef = useRef<AbortController | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── Debounced geocode on query change ──────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      searchPlaces(q, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActiveIndex(-1);
          setOpen(true);
          setError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setResults([]);
          setError("Search failed — try again.");
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // ── Close the dropdown on an outside click ─────────────────────────────
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Cleanup marker + in-flight request on unmount ──────────────────────
  useEffect(
    () => () => {
      markerRef.current?.remove();
      abortRef.current?.abort();
    },
    [],
  );

  const goTo = useCallback(
    (r: PlaceResult) => {
      const map = mapRef.current;
      if (!map) return;
      // Drop / move a single marker on the selected place.
      markerRef.current?.remove();
      markerRef.current = new maplibregl.Marker({ color: MARKER_COLOR })
        .setLngLat([r.lon, r.lat])
        .addTo(map);

      if (r.bounds) {
        map.fitBounds(
          [
            [r.bounds[0], r.bounds[1]],
            [r.bounds[2], r.bounds[3]],
          ],
          { padding: 80, maxZoom: BOUNDS_MAX_ZOOM, duration: 900 },
        );
      } else {
        map.flyTo({ center: [r.lon, r.lat], zoom: POINT_ZOOM, duration: 900 });
      }

      setQuery(r.name);
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
    },
    [mapRef],
  );

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
    setActiveIndex(-1);
    markerRef.current?.remove();
    markerRef.current = null;
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.currentTarget.blur();
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (pick) goTo(pick);
    }
  };

  const showDropdown =
    open &&
    (loading || error != null || results.length > 0 || query.trim().length >= MIN_QUERY_LEN);

  return (
    <div ref={rootRef} className="relative w-[min(88vw,22rem)]">
      <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-2xl backdrop-blur">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search for a place…"
          aria-label="Search for a place"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
        />
        {loading && <Spinner className="h-4 w-4 shrink-0 text-slate-400" />}
        {!loading && query.length > 0 && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="rounded-md p-0.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 py-1 shadow-2xl backdrop-blur"
        >
          {error != null ? (
            <li className="px-3 py-2 text-sm text-rose-300">{error}</li>
          ) : results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-slate-400">No places found.</li>
          ) : (
            results.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => goTo(r)}
                  className={
                    "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors " +
                    (i === activeIndex ? "bg-sky-500/15" : "hover:bg-white/5")
                  }
                >
                  <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-100">
                      {r.name}
                    </span>
                    {r.detail && (
                      <span className="block truncate text-xs text-slate-400">
                        {r.detail}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <path d="M12 21s7-6.3 7-11a7 7 0 0 0-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className ?? ""}`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
