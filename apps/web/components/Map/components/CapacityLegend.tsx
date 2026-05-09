import React from 'react';

const ROWS: Array<[string, string]> = [
  ['#4cc87a', '≥ 8 GW'],
  ['#ffb066', '5 – 8 GW'],
  ['#f5a623', '2 – 5 GW'],
  ['#e85c5c', '< 2 GW'],
];

export function CapacityLegend() {
  return (
    <div className="bg-black/65 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
      <div className="text-[8.5px] text-white/40 uppercase font-bold tracking-wide mb-1.5">
        Installed Capacity
      </div>
      {ROWS.map(([color, label]) => (
        <div key={label} className="flex items-center gap-2 py-0.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[9px] text-white/45">{label}</span>
        </div>
      ))}
    </div>
  );
}
