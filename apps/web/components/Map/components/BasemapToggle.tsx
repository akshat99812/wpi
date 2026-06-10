import React from 'react';
import { motion } from 'framer-motion';

/**
 * Minimal 2-state basemap toggle for the Pro map — road ↔ satellite.
 *
 * Icon-only (no labels), styled as a small glassy segmented pill to sit beside
 * the bottom-centre cursor readout. The selected option is marked by an orange
 * pill that slides between the two buttons via a shared framer-motion layoutId.
 * Purely presentational — the page cross-fades the satellite raster in response
 * to `onChange`.
 */

export type ProBasemap = 'road' | 'satellite';

const RoadIcon = () => (
  <svg
    width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden
  >
    {/* Road in perspective — two outer edges + a dashed centre line */}
    <path d="M9 4 5 20" />
    <path d="M15 4l4 16" />
    <path d="M12 5v3M12 11v2M12 16v3" />
  </svg>
);

const SatelliteIcon = () => (
  <svg
    width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden
  >
    {/* Orbiting satellite — solar-panel wings, body, dish + signal */}
    <path d="M13 7 9 3 5 7l4 4" />
    <path d="m17 11 4 4-4 4-4-4" />
    <path d="m8 12 4 4 6-6-4-4Z" />
    <path d="m16 8 3-3" />
    <path d="M9 21a6 6 0 0 0-6-6" />
  </svg>
);

const OPTIONS: Array<{ id: ProBasemap; label: string; Icon: React.FC }> = [
  { id: 'road', label: 'Road map', Icon: RoadIcon },
  { id: 'satellite', label: 'Satellite', Icon: SatelliteIcon },
];

interface Props {
  mode: ProBasemap;
  onChange: (mode: ProBasemap) => void;
}

export function BasemapToggle({ mode, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/70 p-1.5 shadow-xl backdrop-blur-md">
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = id === mode;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={
              'relative grid h-11 w-11 place-items-center rounded-lg transition-colors ' +
              (active ? '' : 'text-white/55 hover:bg-white/10 hover:text-white')
            }
          >
            {active && (
              <motion.span
                layoutId="pro-basemap-active"
                className="absolute inset-0 rounded-lg bg-orange shadow-[0_0_14px_rgba(255,138,31,0.45)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
              />
            )}
            <span className={'relative z-10 ' + (active ? 'text-[#0a0e18]' : '')}>
              <Icon />
            </span>
          </button>
        );
      })}
    </div>
  );
}
