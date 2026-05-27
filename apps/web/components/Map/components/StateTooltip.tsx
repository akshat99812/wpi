import React from 'react';
import type { TooltipState } from '../types';

interface Props {
  tooltip: TooltipState;
  containerWidth?: number;
  containerHeight?: number;
}

const ROWS: Array<[keyof TooltipState | 'mw' | 'plf' | 'windMs' | 'potential', string, string, string]> = [
  ['mw',        'Installed',  '#ffb366', '⚡'],
  ['windMs',    'Wind Speed', '#67e8f9', '🌬'],
  ['plf',       'Avg PLF',    '#4ade80', '📈'],
  ['potential', 'Potential',  '#a5b4fc', '🔭'],
];

function formatRow(key: string, t: TooltipState): string {
  switch (key) {
    case 'mw':        return `${(t.mw / 1000).toFixed(1)} GW`;
    case 'windMs':    return `${t.windMs} m/s`;
    case 'plf':       return `${t.plf}%`;
    case 'potential': return `${t.potential} GW`;
    default:          return '';
  }
}

const TOOLTIP_W = 220;
const TOOLTIP_H = 222;

export function StateTooltip({ tooltip, containerWidth, containerHeight }: Props) {
  const rawLeft = tooltip.x + 18;
  const rawTop  = Math.max(8, tooltip.y - 160);

  const left = containerWidth
    ? Math.min(rawLeft, containerWidth - TOOLTIP_W - 4)
    : rawLeft;
  const top = containerHeight
    ? Math.min(rawTop, containerHeight - TOOLTIP_H - 4)
    : rawTop;

  return (
    <div
      className="absolute pointer-events-none z-30 w-[220px]"
      style={{ left, top }}
    >
      <div className="absolute inset-0 rounded-2xl blur-xl opacity-40 bg-orange-500" />
      <div className="relative bg-[#060c1a] border border-orange-400/50 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.85)]">
        <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-white/15">
          <div className="w-7 h-7 rounded-lg bg-orange-400/15 border border-orange-400/30 flex items-center justify-center text-[13px]">
            💨
          </div>
          <span className="text-[13px] font-black text-white tracking-wide flex-1">
            {tooltip.state}
          </span>
          <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_2px_rgba(255,138,31,0.7)] animate-pulse" />
        </div>

        <div className="space-y-2">
          {ROWS.map(([key, label, color, icon]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-2 bg-white/[0.04] rounded-lg px-2.5 py-1.5"
            >
              <span className="text-[10px] text-white/55 flex items-center gap-1.5">
                <span className="text-[11px]">{icon}</span>
                {label}
              </span>
              <span
                className="text-[12px] font-black font-mono tracking-tight"
                style={{ color }}
              >
                {formatRow(key as string, tooltip)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-2.5 border-t border-white/10">
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-orange-400" />
            <span className="text-[9px] text-orange-300 font-bold tracking-widest uppercase">
              Click to Filter Dashboard
            </span>
            <div className="w-1 h-1 rounded-full bg-orange-400" />
          </div>
          <div className="mt-1.5 text-[7px] leading-[1.25] text-white/25 text-center">
            Source: MNRE RE-Statistics 2024-25; NIWE &amp; DTU Global Wind Atlas
          </div>
        </div>
      </div>
    </div>
  );
}
