/**
 * Resource + finance figures (plan §3.1): CufCurve, McIrrDistribution (F16),
 * Tornado, TariffStack. Pure props → SVG; SSR via renderToStaticMarkup.
 *
 * DEFERRED to PR6b: CashflowCumulative (needs the 20-yr cashflow series exposed
 * from windFinance.cashflowModel, like PR1 did for the MC draws) and IstsStepdown
 * (policy step-down schedule).
 */

import type { TornadoRow } from "../../../analysis/windSensitivity";
import { clamp, FONT, PALETTE, scaleLinear } from "./scales";

export interface CufCurveProps {
  curve: ReadonlyArray<readonly [number, number]>; // [ws@100m, cuf]
  ws?: number | null;
  cuf?: number | null;
  width?: number;
  height?: number;
}

/** CUF vs wind-speed curve with the site's operating point marked. */
export function CufCurve({ curve, ws, cuf, width = 320, height = 150 }: CufCurveProps) {
  const m = { l: 34, r: 10, t: 10, b: 26 };
  const xsArr = curve.map((p) => p[0]);
  const ysArr = curve.map((p) => p[1]);
  const xMin = Math.min(...xsArr);
  const xMax = Math.max(...xsArr);
  const yMax = Math.max(...ysArr) * 1.1 || 1;
  const x = scaleLinear().domain([xMin, xMax]).range([m.l, width - m.r]);
  const y = scaleLinear().domain([0, yMax]).range([height - m.b, m.t]);
  const path = curve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)
    .join(" ");
  const hasPoint = ws != null && cuf != null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      <line x1={m.l} y1={height - m.b} x2={width - m.r} y2={height - m.b} stroke={PALETTE.axis} />
      <line x1={m.l} y1={m.t} x2={m.l} y2={height - m.b} stroke={PALETTE.axis} />
      <path d={path} fill="none" stroke={PALETTE.accent} strokeWidth={2} />
      {hasPoint ? (
        <g>
          <circle cx={x(clamp(ws as number, xMin, xMax))} cy={y(cuf as number)} r={4} fill={PALETTE.marginal} />
          <text x={x(clamp(ws as number, xMin, xMax)) - 6} y={y(cuf as number) - 7} textAnchor="end" fontSize={9} fontWeight={700} fill={PALETTE.ink}>
            {(ws as number).toFixed(1)} m/s · {((cuf as number) * 100).toFixed(0)}%
          </text>
        </g>
      ) : null}
      <text x={(m.l + width - m.r) / 2} y={height - 5} textAnchor="middle" fontSize={9} fill={PALETTE.muted}>
        wind speed @100 m (m/s)
      </text>
      <text x={6} y={m.t + 4} fontSize={9} fill={PALETTE.muted}>CUF</text>
    </svg>
  );
}

export interface McIrrDistributionProps {
  histogram: { binEdges: number[]; counts: number[] };
  p10?: number;
  p50?: number;
  p90?: number;
  width?: number;
  height?: number;
}

/** Monte-Carlo equity-IRR histogram (figure F16) with P10/P50/P90 markers. */
export function McIrrDistribution({ histogram, p10, p50, p90, width = 320, height = 150 }: McIrrDistributionProps) {
  const m = { l: 28, r: 10, t: 14, b: 26 };
  const { binEdges, counts } = histogram;
  if (counts.length === 0 || binEdges.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={10} fill={PALETTE.muted}>N/A</text>
      </svg>
    );
  }
  const xMin = binEdges[0] as number;
  const xMax = binEdges[binEdges.length - 1] as number;
  const cMax = Math.max(...counts) || 1;
  const x = scaleLinear().domain([xMin, xMax]).range([m.l, width - m.r]);
  const y = scaleLinear().domain([0, cMax]).range([height - m.b, m.t]);
  const marks = [
    { lbl: "P10", v: p10, col: PALETTE.muted, w: 1, dash: "3 2" },
    { lbl: "P50", v: p50, col: PALETTE.ink, w: 1.5, dash: "" },
    { lbl: "P90", v: p90, col: PALETTE.muted, w: 1, dash: "3 2" },
  ];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      {counts.map((c, i) => {
        const x0 = x(binEdges[i] as number);
        const x1 = x(binEdges[i + 1] as number);
        return (
          <rect
            key={i}
            x={x0}
            y={y(c)}
            width={Math.max(0.5, x1 - x0 - 0.5)}
            height={height - m.b - y(c)}
            fill={PALETTE.accentSoft}
            stroke={PALETTE.accent}
            strokeWidth={0.3}
          />
        );
      })}
      {marks.map((mk) =>
        mk.v != null ? (
          <g key={mk.lbl}>
            <line x1={x(mk.v)} y1={m.t} x2={x(mk.v)} y2={height - m.b} stroke={mk.col} strokeWidth={mk.w} strokeDasharray={mk.dash} />
            <text x={x(mk.v)} y={m.t - 2} textAnchor="middle" fontSize={8} fill={mk.col}>{mk.lbl}</text>
          </g>
        ) : null,
      )}
      <line x1={m.l} y1={height - m.b} x2={width - m.r} y2={height - m.b} stroke={PALETTE.axis} />
      <text x={(m.l + width - m.r) / 2} y={height - 5} textAnchor="middle" fontSize={9} fill={PALETTE.muted}>equity IRR</text>
    </svg>
  );
}

export interface TornadoProps {
  baseIrr: number;
  rows: readonly TornadoRow[];
  width?: number;
  height?: number;
}

/** One-at-a-time tornado: horizontal bars from the all-mode base equity IRR. */
export function Tornado({ baseIrr, rows, width = 320, height = 170 }: TornadoProps) {
  const m = { l: 60, r: 12, t: 18, b: 22 };
  const innerRows = rows.slice(0, 8);
  const vals = [baseIrr];
  for (const r of innerRows) {
    if (r.lowIrr != null) vals.push(r.lowIrr);
    if (r.highIrr != null) vals.push(r.highIrr);
  }
  const x = scaleLinear().domain([Math.min(...vals), Math.max(...vals)]).nice().range([m.l, width - m.r]);
  const rowH = (height - m.t - m.b) / Math.max(1, innerRows.length);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      {innerRows.map((r, i) => {
        const yy = m.t + i * rowH + 2;
        const lo = r.lowIrr ?? baseIrr;
        const hi = r.highIrr ?? baseIrr;
        const x0 = x(Math.min(lo, hi));
        const x1 = x(Math.max(lo, hi));
        return (
          <g key={r.variable}>
            <text x={m.l - 5} y={yy + (rowH - 4) / 2} textAnchor="end" fontSize={9} fill={PALETTE.ink} dominantBaseline="middle">
              {r.variable}
            </text>
            <rect x={x0} y={yy} width={Math.max(0.5, x1 - x0)} height={rowH - 5} fill={PALETTE.accentSoft} stroke={PALETTE.accent} strokeWidth={0.3} />
          </g>
        );
      })}
      <line x1={x(baseIrr)} y1={m.t - 4} x2={x(baseIrr)} y2={height - m.b} stroke={PALETTE.ink} strokeWidth={1} />
      <text x={x(baseIrr)} y={m.t - 6} textAnchor="middle" fontSize={8} fill={PALETTE.ink}>base {(baseIrr * 100).toFixed(1)}%</text>
    </svg>
  );
}

export interface TariffStackProps {
  ppa: number;
  rec: number;
  tod: number;
  carbon: number;
  width?: number;
  height?: number;
}

/** Effective-tariff stack — PPA floor + REC + ToD/merchant + carbon (indicative). */
export function TariffStack({ ppa, rec, tod, carbon, width = 320, height = 64 }: TariffStackProps) {
  const m = 10;
  const barY = 26;
  const barH = 18;
  const parts = [
    { label: "PPA", v: ppa, color: PALETTE.accent },
    { label: "REC", v: rec, color: PALETTE.good },
    { label: "ToD", v: tod, color: PALETTE.moderate },
    { label: "Carbon", v: carbon, color: PALETTE.muted },
  ];
  const total = ppa + rec + tod + carbon;
  const x = scaleLinear().domain([0, total || 1]).range([m, width - m]);
  const starts: number[] = [];
  parts.reduce((sum, p, i) => {
    starts[i] = sum;
    return sum + p.v;
  }, 0);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
      <text x={m} y={14} fontSize={9} fill={PALETTE.muted}>Effective tariff stack (indicative)</text>
      {parts.map((p, i) => {
        const x0 = x(starts[i] as number);
        const w = x((starts[i] as number) + p.v) - x0;
        return <rect key={p.label} x={x0} y={barY} width={Math.max(0, w)} height={barH} fill={p.color} />;
      })}
      <text x={width - m} y={14} textAnchor="end" fontSize={11} fontWeight={700} fill={PALETTE.ink}>
        ₹{total.toFixed(2)}/kWh
      </text>
    </svg>
  );
}
