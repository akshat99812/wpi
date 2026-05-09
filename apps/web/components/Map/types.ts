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
}

export interface MapCanvasProps {
  bundle?: WpiBundle;
  selectedState?: string | null;
  basemap?: BasemapId;
  onStateSelect?: (s: string | null) => void;
  onBasemapChange?: (id: BasemapId) => void;
}
