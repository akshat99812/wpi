import React from 'react';
import { BASEMAP_LABELS, ENABLED_BASEMAPS, LOCKED_BASEMAPS } from '../constants';
import { BASEMAP_ICONS } from './BasemapIcons';
import type { BasemapId } from '../types';

interface Props {
  mode: BasemapId;
  onChange: (id: BasemapId) => void;
}

/**
 * Top-left basemap switcher. Each button is icon + label.
 * "Pro" is rendered as a locked/disabled chip per spec change #1.
 */
export function BasemapSwitcher({ mode, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1 bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-lg border border-white/15 rounded-2xl px-1.5 py-1.5 shadow-2xl">
      {ENABLED_BASEMAPS.map(id => {
        const Icon     = BASEMAP_ICONS[id];
        const isActive = mode === id;
        const isLocked = LOCKED_BASEMAPS.includes(id);

        if (isLocked) {
          return (
            <div
              key={id}
              title="Pro mode is coming soon"
              aria-disabled
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-white/25 cursor-not-allowed select-none border border-white/5"
            >
              <Icon />
              <span>{BASEMAP_LABELS[id]}</span>
              <span className="text-[8px] uppercase tracking-wider text-white/30 ml-0.5">Locked</span>
            </div>
          );
        }

        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 whitespace-nowrap ${
              isActive
                ? id === 'wind'
                  ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-900 shadow-[0_0_16px_rgba(34,211,238,0.6)] scale-[1.03]'
                  : 'bg-orange-400 text-[#0a0e18] shadow-[0_0_12px_rgba(255,138,31,0.55)]'
                : 'text-white/55 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon />
            <span>{BASEMAP_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
