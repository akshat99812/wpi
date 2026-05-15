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
  const lat = readout ? readout.lat.toFixed(4) : '— —';
  const lng = readout ? readout.lng.toFixed(4) : '— —';
  const elev = readout?.elevation;
  const elevText =
    readout == null    ? '— —'
  : elev == null       ? 'n/a'
  :                      `${Math.round(elev).toLocaleString('en-IN')} m`;

  return (
    <div className="hidden sm:flex bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 shadow-xl items-center gap-3 font-mono text-[10px] text-white/75 tabular-nums">
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
      <span className="flex items-center gap-1.5">
        <span className="text-orange/85 uppercase tracking-wider text-[9px]">Elev</span>
        <span className={readout == null || elev == null ? '' : 'text-white/90'}>{elevText}</span>
      </span>
    </div>
  );
}
