import React from 'react';

interface Props {
  state: string;
  onClear: () => void;
}

export function SelectedBadge({ state, onClear }: Props) {
  return (
    <div className="bg-[#0e1527]/90 backdrop-blur-sm border border-orange-400/30 rounded-xl px-4 py-2 flex items-center gap-3 shadow-xl">
      <span className="text-[11px] text-orange-400 font-bold">📍 {state}</span>
      <button
        onClick={onClear}
        className="text-white/40 hover:text-orange-400 text-xs"
      >
        ✕ Clear
      </button>
    </div>
  );
}
