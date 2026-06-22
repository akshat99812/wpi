"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { fetchChoropleth, type MetaDimension } from "@/lib/policy";

interface Props {
  dimensions: MetaDimension[]; // full list; we filter to numeric
  year: number | null;
}

const LOW_COLOR = "#3a2f22";
const HIGH_COLOR = "#ff8a1f";
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// India-states choropleth for any numeric policy dimension (feature spec §5.4/§6).
export default function DimensionChoropleth({ dimensions, year }: Props) {
  const numericDims = useMemo(() => dimensions.filter((d) => d.value_type === "numeric"), [dimensions]);
  const [dim, setDim] = useState<string>("");
  const [range, setRange] = useState<{ min: number; max: number; unit: string | null } | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);

  // Default to the first numeric dimension once meta arrives.
  useEffect(() => {
    if (!dim && numericDims.length) setDim(numericDims[0].key);
  }, [numericDims, dim]);

  // Init map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0f19" } }],
      },
      center: [80.5, 22.5],
      zoom: 3.2,
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("choro", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "choro-fill",
        type: "fill",
        source: "choro",
        paint: { "fill-color": "#27324a", "fill-opacity": 0.85 },
      });
      map.addLayer({
        id: "choro-line",
        type: "line",
        source: "choro",
        paint: { "line-color": "#0b0f19", "line-width": 0.6 },
      });
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true });
      map.on("click", "choro-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { name: string; display: string };
        popup.setLngLat(e.lngLat).setHTML(`<strong>${p.name}</strong><br/>${p.display}`).addTo(map);
      });
      map.on("mouseenter", "choro-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "choro-fill", () => (map.getCanvas().style.cursor = ""));
      readyRef.current = true;
    });
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Fetch + recolor when dimension / year changes.
  useEffect(() => {
    if (!dim) return;
    let cancelled = false;
    fetchChoropleth(dim, year)
      .then((fc) => {
        if (cancelled) return;
        const values = fc.features.map((f) => f.properties.value);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 1;
        setRange({ min, max, unit: numericDims.find((d) => d.key === dim)?.unit ?? null });
        setCount(fc.features.length);

        const apply = () => {
          const map = mapRef.current;
          if (!map || !map.getSource("choro")) return;
          (map.getSource("choro") as maplibregl.GeoJSONSource).setData(fc as GeoJSON.FeatureCollection);
          // Equal min/max would make interpolate throw — widen by 1.
          const hi = max === min ? min + 1 : max;
          map.setPaintProperty("choro-fill", "fill-color", [
            "interpolate", ["linear"], ["get", "value"],
            min, LOW_COLOR,
            hi, HIGH_COLOR,
          ]);
        };
        if (readyRef.current) apply();
        else mapRef.current?.once("load", apply);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [dim, year, numericDims]);

  if (!numericDims.length) return null;

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Map a numeric dimension</h2>
        <select
          value={dim}
          onChange={(e) => setDim(e.target.value)}
          className="rounded-md border border-border bg-panel px-2 py-1.5 text-sm text-text"
        >
          {numericDims.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
              {d.unit ? ` (${d.unit})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div ref={containerRef} className="h-[360px] w-full" />
        {range && (
          <div className="flex items-center gap-3 border-t border-border bg-panel px-3 py-2 text-xs text-muted">
            <span>{fmt(range.min, range.unit)}</span>
            <span
              className="h-2 flex-1 rounded"
              style={{ background: `linear-gradient(to right, ${LOW_COLOR}, ${HIGH_COLOR})` }}
            />
            <span>{fmt(range.max, range.unit)}</span>
            <span className="ml-2 text-muted/60">
              {count} state{count === 1 ? "" : "s"} with data
            </span>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted/60">
        States with a rule-based or absent value for this dimension are not shaded.
      </p>
    </section>
  );
}

function fmt(n: number, unit: string | null): string {
  if (unit === "₹/kWh") return `₹${n.toFixed(2)}/kWh`;
  if (unit === "%") return `${n.toFixed(2)}%`;
  if (unit === "kW") return `${n} kW`;
  return `${n}`;
}
