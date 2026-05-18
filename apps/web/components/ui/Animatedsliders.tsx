"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

// ── AnimatedSlider ─────────────────────────────────────────────────────────
interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  index?: number; // for stagger
}

function AnimatedSlider({ id, label, value, min, max, step, unit, onChange, index = 0 }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; key: number } | null>(null);

  // Staggered mount animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), index * 60);
    return () => clearTimeout(t);
  }, [index]);

  const getValueFromPointer = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    return Math.round(raw / step) * step;
  }, [min, max, step, value]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const v = getValueFromPointer(e.clientX);
    onChange(parseFloat(v.toFixed(4)));
    // Ripple on click
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) setRipple({ x: e.clientX - rect.left, key: Date.now() });
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const v = getValueFromPointer(e.clientX);
    onChange(parseFloat(v.toFixed(4)));
  };
  const handlePointerUp = () => setDragging(false);

  // Accent color per group
  const accent =
    index < 2 ? '#67e8f9'   // capacity / tariff → cyan
    : index < 4 ? '#4ade80' // PLF / rate → green
    : index < 6 ? '#ffb366' // WTG / BoP → amber
    : '#a5b4fc';             // debt / tenor / om → lavender

  return (
    <div
      className="group relative"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(10px)',
        transition: `opacity 0.35s ease ${index * 0.06}s, transform 0.35s ease ${index * 0.06}s`,
      }}
    >
      {/* Label row */}
      <div className="flex items-center justify-between mb-2">
        <label
          htmlFor={id}
          className="text-[10.5px] font-bold uppercase tracking-widest select-none"
          style={{ color: hovered || dragging ? accent : 'rgba(255,255,255,0.45)',
                   transition: 'color 0.2s ease' }}
        >
          {label}
        </label>
        {/* Value badge */}
        <div
          className="relative px-2 py-0.5 rounded-md font-black font-mono text-[11.5px] select-none"
          style={{
            background: hovered || dragging ? `${accent}18` : 'rgba(255,255,255,0.05)',
            border: `1px solid ${hovered || dragging ? `${accent}55` : 'rgba(255,255,255,0.08)'}`,
            color: hovered || dragging ? accent : 'rgba(255,255,255,0.7)',
            transition: 'all 0.2s ease',
            minWidth: 64,
            textAlign: 'right',
          }}
        >
          {typeof value === 'number'
            ? value % 1 === 0 ? value : value.toFixed(step < 0.1 ? 2 : 1)
            : value}
          <span className="text-[8.5px] font-bold ml-0.5 opacity-70">{unit}</span>

          {/* Tiny flash on value change */}
          <span
            key={value}
            className="absolute inset-0 rounded-md pointer-events-none"
            style={{
              background: accent,
              opacity: 0,
              animation: 'flashBadge 0.3s ease forwards',
            }}
          />
        </div>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        id={id}
        className="relative h-[6px] rounded-full cursor-pointer select-none"
        style={{ background: 'rgba(255,255,255,0.07)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); }}
      >
        {/* Filled portion */}
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}99, ${accent})`,
            boxShadow: hovered || dragging ? `0 0 10px 2px ${accent}55` : 'none',
            transition: dragging ? 'none' : 'width 0.15s ease, box-shadow 0.2s ease',
          }}
        />

        {/* Ripple on click */}
        {ripple && (
          <span
            key={ripple.key}
            className="absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full pointer-events-none"
            style={{
              left: ripple.x - 16,
              background: accent,
              opacity: 0,
              transform: 'translate(0, -50%) scale(0)',
              animation: 'rippleOut 0.5s ease forwards',
            }}
          />
        )}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full"
          style={{
            left: `${pct}%`,
            width: dragging ? 18 : hovered ? 16 : 12,
            height: dragging ? 18 : hovered ? 16 : 12,
            background: '#fff',
            border: `2.5px solid ${accent}`,
            boxShadow: dragging
              ? `0 0 0 4px ${accent}33, 0 0 14px ${accent}88`
              : hovered
              ? `0 0 0 3px ${accent}25, 0 0 8px ${accent}55`
              : `0 0 6px rgba(0,0,0,0.5)`,
            transition: dragging ? 'width 0.1s, height 0.1s, box-shadow 0.1s' : 'all 0.15s ease',
            zIndex: 2,
          }}
        />
      </div>

      {/* Min / Max ghost labels */}
      <div className="flex justify-between mt-1 px-0.5">
        <span className="text-[8px] text-white/20 font-mono">{min}</span>
        <span className="text-[8px] text-white/20 font-mono">{max}</span>
      </div>
    </div>
  );
}

// ── Demo params type ───────────────────────────────────────────────────────
interface Params {
  size: number; tariff: number; plf: number; rate: number;
  wtg: number; bop: number; debt: number; tenor: number; om: number;
}

// ── Main export ────────────────────────────────────────────────────────────
export default function FinancialSliders({
  p,
  set,
}: {
  p: Params;
  set: (key: keyof Params) => (v: number) => void;
}) {
  return (
    <>
      {/* Keyframe animations injected once */}
      <style>{`
        @keyframes flashBadge {
          0%   { opacity: 0.35; }
          100% { opacity: 0; }
        }
        @keyframes rippleOut {
          0%   { opacity: 0.3; transform: translate(0, -50%) scale(0.2); }
          100% { opacity: 0;   transform: translate(0, -50%) scale(2.5); }
        }
      `}</style>

      <div className="bg-[#0e1527] border border-[#1e2c44] rounded-xl p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-4 sm:gap-y-5">
        <AnimatedSlider index={0} id="finSize"   label="Capacity"     value={p.size}   min={20}  max={1000} step={5}    unit="MW"       onChange={set('size')} />
        <AnimatedSlider index={1} id="finTariff" label="Tariff"       value={p.tariff} min={2.5} max={6.5}  step={0.05} unit="₹/kWh"   onChange={set('tariff')} />
        <AnimatedSlider index={2} id="finPlf"    label="PLF"          value={p.plf}    min={16}  max={45}   step={0.5}  unit="%"        onChange={set('plf')} />
        <AnimatedSlider index={3} id="finRate"   label="Interest Rate" value={p.rate}  min={7}   max={13}   step={0.1}  unit="% p.a."   onChange={set('rate')} />
        <AnimatedSlider index={4} id="finWtg"    label="WTG Cost"     value={p.wtg}    min={4.5} max={9.0}  step={0.05} unit="₹Cr/MW"  onChange={set('wtg')} />
        <AnimatedSlider index={5} id="finBop"    label="BoP Cost"     value={p.bop}    min={1.5} max={4.0}  step={0.05} unit="₹Cr/MW"  onChange={set('bop')} />
        <AnimatedSlider index={6} id="finDebt"   label="Debt %"       value={p.debt}   min={0}   max={85}   step={1}    unit="%"        onChange={set('debt')} />
        <AnimatedSlider index={7} id="finTenor"  label="Debt Tenor"   value={p.tenor}  min={5}   max={20}   step={1}    unit="yrs"      onChange={set('tenor')} />
        <div className="sm:col-span-2">
          <AnimatedSlider index={8} id="finOm"   label="O&M Cost"     value={p.om}     min={5}   max={30}   step={0.1}  unit="₹L/MW/yr" onChange={set('om')} />
        </div>
      </div>
    </>
  );
}