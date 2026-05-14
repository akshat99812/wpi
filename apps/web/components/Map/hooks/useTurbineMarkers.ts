import { useCallback, useRef, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { STATE_DATA } from '../constants';
import { createWindFarmEl } from '../utils/windmill';
import type { WpiBundle } from '@/lib/types';
import type { TooltipState } from '../types';

// Visual-size overrides for states whose true installed MW is so small the
// scale formula collapses to the floor and the marker reads as a speck on
// the basemap. The tooltip continues to show the real MW.
const SIZING_MW_OVERRIDE: Record<string, number> = {
  Kerala: 3500,
};

interface Args {
  bundleRef: MutableRefObject<WpiBundle | undefined>;
  stateRef: MutableRefObject<string | null | undefined>;
  selectRef: MutableRefObject<((s: string | null) => void) | undefined>;
  setTooltip: (t: TooltipState | null) => void;
}

/**
 * Renders one black turbine marker per state in STATE_DATA.
 * Hovering pops the same tooltip the boundary hover uses, so the two
 * interaction surfaces feel unified.
 */
export function useTurbineMarkers({ bundleRef, stateRef, selectRef, setTooltip }: Args) {
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const place = useCallback((m: maplibregl.Map) => {
    // Wipe existing markers first.
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const bundle = bundleRef.current;

    Object.entries(STATE_DATA).forEach(([state, d]) => {
      const liveRow = bundle?.stateCapacity?.find(s => s.state === state);
      const mw = liveRow?.installed_mw ?? d.mw;
      const sizingMw = SIZING_MW_OVERRIDE[state] ?? mw;

      const { el, inner, overlay, scale } = createWindFarmEl(sizingMw);

      // ── Hover handling ────────────────────────────────────────────────
      // Use Pointer Events (pointerenter / pointerleave / pointercancel)
      // rather than legacy mouse events. Safari is known to drop
      // `mouseleave` on transformed/stacked elements when the cursor
      // crosses quickly between markers (each marker has a CSS-transformed
      // inner inside an overlay), which left the tooltip stuck on the
      // previously-hovered state. Pointer events fire reliably across
      // Chromium / Safari / Firefox for the same transitions.
      const show = () => {
        const p = m.project([d.lon, d.lat]);
        setTooltip({
          x: p.x,
          y: p.y,
          state,
          mw,
          plf: d.plf,
          windMs: d.windMs,
          potential: d.potential,
        });
        inner.style.transform = `scale(${scale * 1.15})`;
      };
      const hide = () => {
        setTooltip(null);
        inner.style.transform = `scale(${scale})`;
      };

      overlay.addEventListener('pointerenter',  show);
      overlay.addEventListener('pointerleave',  hide);
      overlay.addEventListener('pointercancel', hide);
      // Belt-and-suspenders: legacy mouseleave catches the rare case where
      // pointer events aren't dispatched (older WebKit on iOS, e.g.).
      overlay.addEventListener('mouseleave',    hide);

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = stateRef.current;
        selectRef.current?.(cur === state ? null : state);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([d.lon, d.lat])
        .addTo(m);
      markersRef.current.push(marker);
    });
  }, [bundleRef, stateRef, selectRef, setTooltip]);

  const remove = useCallback(() => {
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
  }, []);

  return { place, remove };
}
