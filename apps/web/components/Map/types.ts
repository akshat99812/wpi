import type { WpiBundle } from '@/lib/types';

// ── Basemap modes ──────────────────────────────────────────────────────────
// 'pro' is intentionally kept in the type but disabled in the switcher UI.
export type BasemapId = 'satellite' | 'terrain' | 'wind' | 'street' | 'pro';

export interface StateMeta {
  lon: number;
  lat: number;
  mw: number;
  plf: number;
  windMs: number;
  potential: number;
}

export interface TooltipState {
  x: number;
  y: number;
  state: string;
  mw: number;
  plf: number;
  windMs: number;
  potential: number;
}

export interface CursorReadout {
  lng: number;
  lat: number;
  zoom: number;
  /** Elevation in metres at the cursor position. null while a fresh
   *  sample is in flight or when outside the elevation grid. */
  elevation?: number | null;
  /** Mean wind speed @ 100 m (m/s) at the cursor, from the pre-baked Global
   *  Wind Atlas grid. null outside coverage / over no-data. Drives the
   *  interactive WindScale legend in wind mode. */
  wind?: number | null;
  /** Value of the ACTIVE wind-resource layer (Pro map: mean speed or power
   *  density at the selected hub height) at the cursor. Absent when no
   *  resource layer is on; value null outside coverage / grid not loaded. */
  resource?: { value: number | null; unit: string; height: number };
}

// ── Wind monitoring mast (Pro map) ─────────────────────────────────────────
// Full per-record attributes returned by GET /api/windmill/:id. Numeric fields
// are typed `number | string | null` because the source data round-trips some
// values as strings; formatters in utils/format.ts coerce defensively.
export interface Windmill {
  id: string;
  lat: number;
  lon: number;
  cum_no: number | null;
  state: string | null;
  station: string | null;
  district: string | null;
  date_commence: string | null;
  date_close: string | null;
  mast_height_m: number | string | null;
  elevation_masl: number | string | null;
  maws_ms: number | string | null;
  mawpd_wm2: number | string | null;
  coord_complete: boolean | null;
}

export interface MapCanvasProps {
  bundle?: WpiBundle;
  selectedState?: string | null;
  basemap?: BasemapId;
  onStateSelect?: (s: string | null) => void;
  onBasemapChange?: (id: BasemapId) => void;
}
