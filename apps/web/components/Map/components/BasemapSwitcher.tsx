"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { BASEMAP_LABELS, ENABLED_BASEMAPS, LOCKED_BASEMAPS } from '../constants';
import { BASEMAP_ICONS } from './BasemapIcons';
import type { BasemapId } from '../types';

interface Props {
  mode: BasemapId;
  onChange: (id: BasemapId) => void;
}

const ACTIVE_GLOW: Partial<Record<BasemapId, { from: string; to: string; text: string; shadow: string }>> = {
  satellite: { from: '#ff9a3c', to: '#ff7a1f', text: '#0a0e18', shadow: 'rgba(255,138,31,0.55)' },
  terrain:   { from: '#ffb066', to: '#ff8a1f', text: '#0a0e18', shadow: 'rgba(255,138,31,0.50)' },
  wind:      { from: '#67e8f9', to: '#22d3ee', text: '#06121a', shadow: 'rgba(34,211,238,0.60)' },
  street:    { from: '#ffd0a0', to: '#ff8a1f', text: '#0a0e18', shadow: 'rgba(255,138,31,0.50)' },
};

export function BasemapSwitcher({ mode, onChange }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-wrap gap-1 rounded-2xl px-1.5 py-1.5
                 backdrop-blur-2xl backdrop-saturate-150 overflow-hidden
                 bg-[#0a0e18]/85 border border-white/15
                 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(0,0,0,0.3)]"
    >
      {/* Specular highlight — subtle diagonal sheen */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 35%, rgba(255,255,255,0) 60%)',
        }}
      />
      {/* Inner edge softener */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.08), transparent 60%)',
        }}
      />

      {ENABLED_BASEMAPS.map(id => {
        const Icon     = BASEMAP_ICONS[id];
        const isActive = mode === id;
        const isLocked = LOCKED_BASEMAPS.includes(id);
        const glow     = ACTIVE_GLOW[id];

        if (isLocked) {
          return (
            <div
              key={id}
              title="Pro mode is coming soon"
              aria-disabled
              className="relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold
                         cursor-not-allowed select-none
                         text-white/25 border border-white/[0.06]"
            >
              <Icon />
              <span className="hidden sm:inline">{BASEMAP_LABELS[id]}</span>
              <span className="hidden sm:inline text-[8px] uppercase tracking-wider ml-0.5 text-white/30">
                Locked
              </span>
            </div>
          );
        }

        return (
          <motion.button
            key={id}
            onClick={() => onChange(id)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className={`group relative z-10 flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1.5 rounded-xl
                        text-[10px] font-bold whitespace-nowrap outline-none
                        transition-colors duration-200
                        ${isActive ? '' : 'text-white/65 hover:text-white'}`}
            style={isActive && glow ? { color: glow.text } : undefined}
          >
            {/* Animated active background — slides between buttons via shared layoutId */}
            {isActive && glow && (
              <motion.span
                layoutId="basemap-active-pill"
                className="absolute inset-0 rounded-xl"
                style={{
                  background: `linear-gradient(135deg, ${glow.from} 0%, ${glow.to} 100%)`,
                  boxShadow:  `0 0 18px ${glow.shadow}, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.18)`,
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
              />
            )}

            {/* Soft hover wash for inactive buttons */}
            {!isActive && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-xl transition-colors duration-200
                           bg-white/0 group-hover:bg-white/[0.08]"
              />
            )}

            <span className="relative flex items-center gap-1 sm:gap-1.5">
              <Icon />
              <span className="hidden sm:inline">{BASEMAP_LABELS[id]}</span>
            </span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
