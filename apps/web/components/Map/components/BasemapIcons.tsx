import React from 'react';

// All icons share the same dimensions and stroke style for a cohesive look.
// stroke-width 1.6 reads cleanly at 14×14 without feeling chunky.
const baseProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const SatelliteIcon = () => (
  <svg {...baseProps}>
    {/* Dish + signal arcs */}
    <path d="M5 19l5.5-5.5" />
    <path d="M3 21l2-2" />
    <circle cx="13.5" cy="10.5" r="2.5" />
    <path d="M17 7a5 5 0 0 1 0 7" />
    <path d="M19.5 4.5a8 8 0 0 1 0 12" />
  </svg>
);

export const TerrainIcon = () => (
  <svg {...baseProps}>
    {/* Two mountain peaks */}
    <path d="M3 19l5-8 4 6 3-4 6 6" />
    <circle cx="17" cy="6" r="1.4" />
  </svg>
);

export const WindIcon = () => (
  <svg {...baseProps}>
    {/* Three flowing wind lines */}
    <path d="M4 8h11a3 3 0 1 0-3-3" />
    <path d="M4 12h15a3 3 0 1 1-3 3" />
    <path d="M4 16h9" />
  </svg>
);

export const StreetIcon = () => (
  <svg {...baseProps}>
    {/* Folded map */}
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v16" />
    <path d="M15 6v16" />
  </svg>
);

export const ProIcon = () => (
  <svg {...baseProps}>
    {/* Lock — used for the disabled "Pro" tier */}
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

import type { BasemapId } from '../types';

export const BASEMAP_ICONS: Record<BasemapId, React.FC> = {
  satellite: SatelliteIcon,
  terrain:   TerrainIcon,
  wind:      WindIcon,
  street:    StreetIcon,
  pro:       ProIcon,
};
