'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { WindFlow, loadWindField, type WindField } from '../utils/windFlow';
import { assetPath } from '@/lib/basePath';

// assetPath: served under the app's basePath in prod (/terminal).
const FIELD_URL = assetPath('/wind-flow/india-wind.json');

// Module-level cache so toggling the mode on/off doesn't refetch the field.
let fieldPromise: Promise<WindField> | null = null;
const getField = () => (fieldPromise ??= loadWindField(FIELD_URL));

/**
 * Mounts the animated wind-particle canvas over the free-tier map while the
 * "Wind flow" basemap is active. The canvas is transparent and
 * pointer-events-none, so map interaction passes straight through; a
 * ResizeObserver keeps the backing store matched to the container.
 */
export function WindFlowOverlay({ map, active }: { map: MlMap | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flowRef = useRef<WindFlow | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active || !map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;

    getField()
      .then((field) => {
        if (cancelled || !canvasRef.current) return;
        const flow = new WindFlow(canvasRef.current, map, field);
        flowRef.current = flow;
        flow.start();
        observer = new ResizeObserver(() => flow.resize());
        observer.observe(canvasRef.current);
      })
      .catch((err) => {
        console.error('[wind-flow] failed to start', err);
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      flowRef.current?.destroy();
      flowRef.current = null;
    };
  }, [active, map]);

  if (!active) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[6] h-full w-full"
      />
      <div className="pointer-events-none absolute bottom-28 left-3 z-20 rounded-lg border border-white/10 bg-[#0a0e18]/80 px-2.5 py-1.5 backdrop-blur">
        <p className="text-[11px] font-medium text-cyan-200">Wind flow · 10 m</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className="h-1.5 w-16 rounded-full"
            style={{
              background:
                'linear-gradient(to right, rgb(86,180,233), rgb(150,240,210), rgb(255,246,200))',
            }}
          />
          <span className="font-mono text-[9px] text-slate-400">calm → fast</span>
        </div>
        <p className="pt-1 text-[9px] leading-snug text-slate-500">
          {error ? 'Wind field unavailable' : 'Static snapshot · Open-Meteo'}
        </p>
      </div>
    </>
  );
}
