import React from 'react';
import type { CursorReadout as Readout } from '../types';

interface Props { readout: Readout | null }

/**
 * Bottom-center coordinate readout. Shows the cursor's latitude, longitude,
 * and the current zoom level. The MapLibre ScaleControl (added in
 * useMapInit) sits to the left and shows the km scale bar — together they
 * give users complete spatial context per spec change #5.
 */
export function CursorReadoutBar({ readout }: Props) {
  // Always render the chrome so the bar doesn't pop in/out and shift layout;
  // gracefully show em-dashes when the cursor is off the map.
  const lat   = readout ? readout.lat.toFixed(4)  : '— —';
  const lng   = readout ? readout.lng.toFixed(4)  : '— —';
  const zoom  = readout ? readout.zoom.toFixed(2) : '— —';
  // Elevation is only populated in terrain mode (via SRTM lookup).
  // null  → fetch in flight (render a shimmering skeleton)
  // number → resolved value
  // undefined → not in terrain mode (don't render the pill at all)
  const showElevation = readout?.elevation !== undefined;
  const isLoading = readout?.elevation == null;

  return (
    <div className="hidden sm:flex bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 shadow-xl items-center gap-3 font-mono text-[10px] text-white/75 tabular-nums">
      {/* One-time injected keyframes for the elevation skeleton shimmer */}
      <style>{`
        @keyframes cr-skel-sweep { 0%{transform:translateX(-120%);} 100%{transform:translateX(220%);} }
      `}</style>

      <span className="flex items-center gap-1">
        <span className="text-white/40 uppercase tracking-wider text-[9px]">Lat</span>
        <span>{lat}°</span>
      </span>
      <span className="w-px h-3 bg-white/15" />
      <span className="flex items-center gap-1">
        <span className="text-white/40 uppercase tracking-wider text-[9px]">Lng</span>
        <span>{lng}°</span>
      </span>
      <span className="w-px h-3 bg-white/15" />
      <span className="flex items-center gap-1">
        <span className="text-white/40 uppercase tracking-wider text-[9px]">Z</span>
        <span>{zoom}</span>
      </span>
      {showElevation && (
        <>
          <span className="w-px h-3 bg-white/15" />
          <span className="flex items-center gap-1.5">
            <span className="text-orange/85 uppercase tracking-wider text-[9px]">Elev</span>
            {isLoading ? (
              <span
                aria-label="loading elevation"
                className="relative inline-block w-[48px] h-[10px] rounded-[3px]
                           bg-white/[0.07] border border-white/[0.06] overflow-hidden"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1/2
                             bg-gradient-to-r from-transparent via-white/22 to-transparent"
                  style={{ animation: 'cr-skel-sweep 1.1s ease-in-out infinite' }}
                />
              </span>
            ) : (
              <span className="text-white/90">
                {Math.round(readout!.elevation!).toLocaleString('en-IN')} m
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}
