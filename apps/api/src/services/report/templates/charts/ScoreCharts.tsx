/**
 * Score visuals (plan §3.1): BandMeter, ScoreComposition, BulletBar.
 * Pure props → SVG. No DOM, no hooks — SSR via renderToStaticMarkup.
 */

import { clamp, FONT, PALETTE, scaleLinear, scoreColor } from "./scales";

export interface BandMeterProps {
  score: number; // 0–100
  width?: number;
  height?: number;
}

/** 0–100 gauge with site-class band zones and a marker at `score`. */
export function BandMeter({ score, width = 320, height = 64 }: BandMeterProps) {
  const m = 10;
  const trackY = 24;
  const trackH = 14;
  const x = scaleLinear().domain([0, 100]).range([m, width - m]);
  const bands = [
    { from: 0, to: 45, color: PALETTE.marginal },
    { from: 45, to: 60, color: PALETTE.moderate },
    { from: 60, to: 75, color: PALETTE.good },
    { from: 75, to: 100, color: PALETTE.excellent },
  ];
  const s = clamp(score, 0, 100);
  const sx = x(s);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      {bands.map((b) => (
        <rect
          key={b.from}
          x={x(b.from)}
          y={trackY}
          width={x(b.to) - x(b.from)}
          height={trackH}
          fill={b.color}
          opacity={0.85}
        />
      ))}
      <polygon points={`${sx},${trackY - 1} ${sx - 5},${trackY - 9} ${sx + 5},${trackY - 9}`} fill={PALETTE.ink} />
      <line x1={sx} y1={trackY} x2={sx} y2={trackY + trackH} stroke={PALETTE.ink} strokeWidth={2} />
      <text x={sx} y={trackY + trackH + 16} textAnchor="middle" fontSize={13} fontWeight={700} fill={scoreColor(s)}>
        {s.toFixed(0)}
      </text>
      <text x={m} y={16} fontSize={9} fill={PALETTE.muted}>0</text>
      <text x={width - m} y={16} textAnchor="end" fontSize={9} fill={PALETTE.muted}>100</text>
    </svg>
  );
}

export interface ScoreCompositionProps {
  resourcePoints: number;
  gridPoints: number;
  resourceWeight?: number;
  gridWeight?: number;
  width?: number;
  height?: number;
}

/** Stacked bar: resource (weight 72) + grid (weight 28) contributions to the score. */
export function ScoreComposition({
  resourcePoints,
  gridPoints,
  resourceWeight = 72,
  gridWeight = 28,
  width = 320,
  height = 56,
}: ScoreCompositionProps) {
  const m = 10;
  const barY = 20;
  const barH = 18;
  const x = scaleLinear().domain([0, 100]).range([m, width - m]);
  const rW = x(clamp(resourcePoints, 0, 100)) - m;
  const gW = x(clamp(gridPoints, 0, 100)) - m;
  const total = resourcePoints + gridPoints;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      <text x={m} y={14} fontSize={9} fill={PALETTE.accent}>
        Resource {resourcePoints.toFixed(0)}/{resourceWeight}
      </text>
      <text x={width - m} y={14} textAnchor="end" fontSize={9} fill={PALETTE.good}>
        Grid {gridPoints.toFixed(0)}/{gridWeight}
      </text>
      <rect x={m} y={barY} width={Math.max(0, rW)} height={barH} fill={PALETTE.accent} />
      <rect x={m + Math.max(0, rW)} y={barY} width={Math.max(0, gW)} height={barH} fill={PALETTE.good} />
      <text x={m + Math.max(0, rW) + Math.max(0, gW) + 6} y={barY + barH - 4} fontSize={12} fontWeight={700} fill={PALETTE.ink}>
        {total.toFixed(0)}
      </text>
    </svg>
  );
}

export interface BulletBarProps {
  label: string;
  value: number;
  max: number;
  target?: number;
  unit?: string;
  width?: number;
  height?: number;
}

/** Single-metric bullet bar with an optional target tick. */
export function BulletBar({ label, value, max, target, unit = "", width = 320, height = 40 }: BulletBarProps) {
  const m = 10;
  const barY = 22;
  const barH = 12;
  const safeMax = max > 0 ? max : 1;
  const x = scaleLinear().domain([0, safeMax]).range([m, width - m]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      <text x={m} y={15} fontSize={10} fill={PALETTE.muted}>{label}</text>
      <text x={width - m} y={15} textAnchor="end" fontSize={10} fontWeight={700} fill={PALETTE.ink}>
        {value.toFixed(1)}{unit}
      </text>
      <rect x={m} y={barY} width={width - 2 * m} height={barH} fill={PALETTE.grid} />
      <rect x={m} y={barY} width={Math.max(0, x(clamp(value, 0, safeMax)) - m)} height={barH} fill={PALETTE.accent} />
      {target != null ? (
        <line x1={x(clamp(target, 0, safeMax))} y1={barY - 3} x2={x(clamp(target, 0, safeMax))} y2={barY + barH + 3} stroke={PALETTE.ink} strokeWidth={2} />
      ) : null}
    </svg>
  );
}
