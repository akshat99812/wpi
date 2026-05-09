// ── Windmill marker (uniform black, regardless of MW) ─────────────────────
// Size still scales subtly with MW so big farms read bigger, but the colour
// is constant per the design spec.
const TURBINE_COLOR    = '#0b0f17'; // near-black (slightly cooler than pure #000 to sit on satellite)
const TURBINE_ACCENT   = '#1a1f2e'; // slight tonal step for the front blade
const TURBINE_TOWER_LT = '#3a3f4a';
const TURBINE_TOWER_DK = '#1a1d24';
const HUB_HIGHLIGHT    = '#ffffff';

export interface TurbineEl {
  el: HTMLElement;
  inner: HTMLElement;
  overlay: HTMLElement;
  scale: number;
}

export function createWindFarmEl(mw: number): TurbineEl {
  const el = document.createElement('div');
  el.style.cssText = 'width:40px;height:50px;pointer-events:none;';

  const inner = document.createElement('div');
  const scale = Math.min(1.3, Math.max(0.85, 0.85 + (mw / 10000) * 0.45));
  inner.style.cssText =
    `position:absolute;inset:0;transform-origin:bottom center;` +
    `transform:scale(${scale});` +
    `transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);` +
    `pointer-events:none;` +
    // Soft drop-shadow so the black turbine separates from any basemap.
    `filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.35));`;

  inner.innerHTML = `
    <svg width="40" height="50" viewBox="0 0 40 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>
        .wm-spin { animation: wm-r 3s linear infinite; transform-origin: 20px 18px; }
        @keyframes wm-r { to { transform: rotate(360deg); } }
      </style>
      <!-- ground shadow -->
      <ellipse cx="20" cy="48" rx="12" ry="2" fill="#000" opacity="0.35"/>
      <ellipse cx="20" cy="48" rx="6"  ry="1" fill="#000" opacity="0.55"/>
      <!-- tower -->
      <polygon points="17.5,48 22.5,48 21.5,18 18.5,18" fill="${TURBINE_TOWER_LT}"/>
      <polygon points="20,48 22.5,48 21.5,18 20,18"     fill="${TURBINE_TOWER_DK}"/>
      <!-- blades -->
      <g class="wm-spin">
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${TURBINE_COLOR}"  opacity="0.98"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${TURBINE_ACCENT}" opacity="0.98" transform="rotate(120,20,18)"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${TURBINE_COLOR}"  opacity="0.98" transform="rotate(240,20,18)"/>
      </g>
      <!-- hub -->
      <circle cx="20" cy="18" r="3"   fill="${TURBINE_COLOR}"/>
      <circle cx="20" cy="18" r="1.5" fill="${HUB_HIGHLIGHT}"/>
    </svg>`;
  el.appendChild(inner);

  // Larger invisible hit-target for hover/click.
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;inset:-10px;z-index:10;cursor:pointer;pointer-events:auto;';
  el.appendChild(overlay);

  return { el, inner, overlay, scale };
}
