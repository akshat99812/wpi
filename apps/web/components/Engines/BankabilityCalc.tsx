"use client";

import React, { useState, useMemo, useCallback } from 'react';
import { calculateIRR } from '@/lib/math';

// ── Constants (spec §10.3) ────────────────────────────────────────────────────
const HOURS  = 8760;
const AUX    = 0.005;
const DEGRAD = 0.005;
const OM_ESC = 0.05;
const INS_PCT = 0.004;
const INS_ESC = 0.03;
const TAX    = 0.25168;
const SALV   = 0.05;
const LIFE   = 25;

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  size:    100,
  wtg:     6.5,
  bop:     2.5,
  debt:    75,
  rate:    9.0,
  tenor:   18,
  tariff:  4.2,
  plf:     37.0,
  om:      8.0,
};

// ── Helper components ─────────────────────────────────────────────────────────
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#0b0f19] border border-[#1e2c44] p-2.5 rounded-xl flex flex-col gap-0.5">
      <span className="text-[9px] text-muted uppercase font-bold tracking-wide leading-tight">{label}</span>
      <span className="text-[13.5px] font-mono font-bold text-[#ffd0a0]">{value}</span>
      {sub && <span className="text-[9px] text-muted/60">{sub}</span>}
    </div>
  );
}

function Slider({
  label, id, value, min, max, step, unit, onChange
}: {
  label: string; id: string; value: number;
  min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="text-[10px] text-muted uppercase font-bold tracking-wide">{label}</label>
        <span className="text-[11px] font-mono font-bold text-[#ffd0a0]">{value} {unit}</span>
      </div>
      <div className="relative flex items-center h-4">
        <div className="w-full h-[3px] rounded-full bg-[#1e2c44] relative overflow-hidden">
          <div className="absolute left-0 h-full bg-gradient-to-r from-orange to-[#ffb066]" style={{ width: `${pct}%` }} />
        </div>
        <input
          id={id}
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ── Main DCF calculation ──────────────────────────────────────────────────────
function runDcf(p: typeof DEFAULTS) {
  const turnkey   = p.wtg + p.bop;
  const capex     = p.size * turnkey;
  const debtAmt   = capex * (p.debt / 100);
  const equityH   = capex - debtAmt;

  const r         = p.rate / 100;
  const annuity   = r === 0 ? debtAmt / p.tenor
                            : debtAmt * (r * Math.pow(1 + r, p.tenor)) / (Math.pow(1 + r, p.tenor) - 1);

  const grossY1   = p.size * HOURS * (p.plf / 100);
  const netY1     = grossY1 * (1 - AUX);
  const revY1     = netY1 * p.tariff * 1000 / 1e7;
  const wc        = revY1 / 12;
  const equityWC  = equityH + wc;

  const projectCF: number[] = [-capex - wc];
  const equityCF:  number[] = [-equityWC];

  let outstanding = debtAmt;
  let wdv         = capex;
  let dscrSum     = 0;
  let minDscr     = 999;
  let eqInflows   = 0;

  let omY1 = 0, insY1 = 0, ebitdaY1 = 0, dscrY1 = 0;

  for (let n = 1; n <= LIFE; n++) {
    const netGen  = grossY1 * (1 - AUX) * Math.pow(1 - DEGRAD, n - 1);
    const rev     = netGen * p.tariff * 1000 / 1e7;
    const om      = (p.size * p.om * 1e5 / 1e7) * Math.pow(1 + OM_ESC, n - 1);
    const ins     = capex * INS_PCT * Math.pow(1 + INS_ESC, n - 1);
    const ebitda  = rev - om - ins;

    const interest  = outstanding * r;
    const principal = n <= p.tenor ? Math.min(annuity - interest, outstanding) : 0;
    outstanding     = Math.max(0, outstanding - principal);

    // WDV accelerated depreciation (40%/yr, capped when exhausted)
    const dep = Math.min(wdv * 0.40, wdv);
    wdv       = Math.max(0, wdv - dep);

    const taxUnlev = Math.max(0, ebitda - dep) * TAX;
    const taxLev   = Math.max(0, ebitda - dep - interest) * TAX;

    const pcf = ebitda - taxUnlev;
    const ecf = ebitda - (n <= p.tenor ? annuity : 0) - taxLev;

    if (n === 1) { omY1 = om; insY1 = ins; ebitdaY1 = ebitda; }

    projectCF.push(pcf);
    equityCF.push(ecf);

    if (n <= p.tenor) {
      const dscr = annuity > 0 ? ebitda / annuity : 999;
      dscrSum   += dscr;
      minDscr    = Math.min(minDscr, dscr);
      if (n === 1) dscrY1 = dscr;
    }
    if (ecf > 0) eqInflows += ecf;
  }

  // Terminal year: salvage + WC return
  const salvageVal   = capex * SALV;
  const capGainsTax  = Math.max(0, salvageVal - wdv) * TAX;
  const terminalCF   = salvageVal - capGainsTax + wc;
  projectCF[LIFE]   += terminalCF;
  equityCF[LIFE]    += terminalCF;

  // IRR
  const projIrr = calculateIRR(projectCF) ?? 0;
  const eqIrr   = calculateIRR(equityCF)  ?? 0;
  const avgDscr = dscrSum / p.tenor;
  const roi     = equityWC > 0 ? (eqInflows / equityWC) * 100 : 0;

  // Payback: interpolated year where cumulative project CF > 0
  let cumPcf = 0;
  let payback = LIFE;
  for (let i = 0; i < projectCF.length; i++) {
    const prev = cumPcf;
    cumPcf += projectCF[i];
    if (cumPcf >= 0 && prev < 0) {
      payback = i - prev / (cumPcf - prev);
      break;
    }
  }

  const isBankable  = eqIrr >= 13 && avgDscr >= 1.30;
  const isMarginal  = eqIrr >= 11 && avgDscr >= 1.15;
  const verdict     = isBankable ? 'Bankable' : isMarginal ? 'Marginal' : 'Sub-bankable';
  const verdictClr  = isBankable ? 'text-[#4cc87a] border-[#4cc87a]/30 bg-[#4cc87a]/5'
                    : isMarginal ? 'text-[#ffb066] border-[#ffb066]/30 bg-[#ffb066]/5'
                                 : 'text-red-400 border-red-400/30 bg-red-400/5';

  return {
    capex, debtAmt, equityWC, annuity,
    revY1, omY1, insY1, ebitdaY1, dscrY1,
    projIrr, eqIrr, avgDscr, minDscr, roi, payback,
    verdict, verdictClr
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BankabilityCalc() {
  const [p, setP] = useState({ ...DEFAULTS });

  const set = useCallback((key: keyof typeof DEFAULTS) => (v: number) =>
    setP(prev => ({ ...prev, [key]: v })), []);

  const res = useMemo(() => runDcf(p), [p]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
          <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
          25-yr Bankability Calculator
        </div>
        <button
          onClick={() => setP({ ...DEFAULTS })}
          className="text-[9.5px] text-orange hover:underline uppercase tracking-[0.8px] font-bold"
        >
          Reset Defaults
        </button>
      </div>

      {/* ── Sliders (9 inputs) ── */}
      <div className="bg-[#0e1527] border border-[#1e2c44] rounded-xl p-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <Slider id="finSize"   label="Capacity"     value={p.size}   min={20}  max={1000} step={5}    unit="MW"     onChange={set('size')} />
        <Slider id="finTariff" label="Tariff"       value={p.tariff} min={2.5} max={6.5}  step={0.05} unit="₹/kWh" onChange={set('tariff')} />
        <Slider id="finPlf"    label="PLF"          value={p.plf}    min={16}  max={45}   step={0.5}  unit="%"      onChange={set('plf')} />
        <Slider id="finRate"   label="Interest Rate" value={p.rate}   min={7}   max={13}   step={0.1}  unit="% p.a." onChange={set('rate')} />
        <Slider id="finWtg"    label="WTG Cost"     value={p.wtg}    min={4.5} max={9.0}  step={0.05} unit="₹Cr/MW" onChange={set('wtg')} />
        <Slider id="finBop"    label="BoP Cost"     value={p.bop}    min={1.5} max={4.0}  step={0.05} unit="₹Cr/MW" onChange={set('bop')} />
        <Slider id="finDebt"   label="Debt %"       value={p.debt}   min={0}   max={85}   step={1}    unit="%"      onChange={set('debt')} />
        <Slider id="finTenor"  label="Debt Tenor"   value={p.tenor}  min={5}   max={20}   step={1}    unit="yrs"    onChange={set('tenor')} />
        <div className="col-span-2">
          <Slider id="finOm"   label="O&M Cost"     value={p.om}     min={5}   max={30}   step={0.1}  unit="₹L/MW/yr" onChange={set('om')} />
        </div>
      </div>

      {/* ── Derived inputs (4 tiles) ── */}
      <div>
        <div className="text-[9.5px] text-muted uppercase font-bold tracking-wide mb-2">Derived Inputs</div>
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Turnkey CapEx"      value={`₹${res.capex.toFixed(0)} Cr`}   sub={`${(p.wtg + p.bop).toFixed(2)} Cr/MW`} />
          <Tile label="Equity incl. WC"    value={`₹${res.equityWC.toFixed(0)} Cr`} />
          <Tile label="Debt"               value={`₹${res.debtAmt.toFixed(0)} Cr`}   sub={`${p.debt}% of CapEx`} />
          <Tile label="Annual Debt Service" value={`₹${res.annuity.toFixed(1)} Cr`}  sub="Equated annuity" />
        </div>
      </div>

      {/* ── Year-1 Run Rate (6 tiles) ── */}
      <div>
        <div className="text-[9.5px] text-muted uppercase font-bold tracking-wide mb-2">Year-1 Run Rate</div>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Generation"    value={`${(p.size * HOURS * p.plf / 100 * (1-AUX) / 1000).toFixed(1)} MU`} />
          <Tile label="Revenue"       value={`₹${res.revY1.toFixed(1)} Cr`} />
          <Tile label="O&M"           value={`₹${res.omY1.toFixed(1)} Cr`} />
          <Tile label="EBITDA Margin" value={`${res.revY1 > 0 ? ((res.ebitdaY1 / res.revY1) * 100).toFixed(1) : 0}%`} />
          <Tile label="EBITDA Y1"     value={`₹${res.ebitdaY1.toFixed(1)} Cr`} />
          <Tile label="DSCR Y1"       value={`${res.dscrY1.toFixed(2)}×`} sub={res.dscrY1 >= 1.30 ? '✓ Covenant met' : '✗ Below 1.30×'} />
        </div>
      </div>

      {/* ── Returns & Coverage (6 tiles) ── */}
      <div>
        <div className="text-[9.5px] text-muted uppercase font-bold tracking-wide mb-2">Returns & Coverage</div>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Project IRR"   value={`${res.projIrr.toFixed(1)}%`} />
          <Tile label="Equity IRR"    value={`${res.eqIrr.toFixed(1)}%`} sub={res.eqIrr >= 13 ? '✓ ≥ 13% threshold' : '✗ Below 13%'} />
          <Tile label="Payback"       value={`${res.payback.toFixed(1)} yrs`} />
          <Tile label="25-yr ROI"     value={`${res.roi.toFixed(0)}%`} />
          <Tile label="Avg DSCR"      value={`${res.avgDscr.toFixed(2)}×`} sub={res.avgDscr >= 1.30 ? '✓ Covenant met' : '✗ Below 1.30×'} />
          <Tile label="Min DSCR"      value={`${res.minDscr.toFixed(2)}×`} />
        </div>
      </div>

      {/* ── Bankability Verdict ── */}
      <div className={`p-4 rounded-xl border flex justify-between items-center ${res.verdictClr}`}>
        <div>
          <div className="text-[9px] uppercase font-extrabold tracking-[1.2px] opacity-70 mb-0.5">Bankability Verdict</div>
          <div className="text-lg font-black uppercase">{res.verdict}</div>
          <div className="text-[10px] opacity-60 mt-0.5">
            {res.verdict === 'Bankable'     ? 'Equity IRR ≥ 13% AND Avg DSCR ≥ 1.30×'
            : res.verdict === 'Marginal'    ? 'IRR ≥ 11% or DSCR ≥ 1.15× — review assumptions'
                                           : 'Fails IRR ≥ 13% or DSCR ≥ 1.30× — not financeable at current terms'}
          </div>
        </div>
        <div className="text-3xl">
          {res.verdict === 'Bankable' ? '✅' : res.verdict === 'Marginal' ? '⚠️' : '❌'}
        </div>
      </div>

      {/* ── Methodology disclosure ── */}
      <details className="group bg-[#0e1527] border border-[#1e2c44] rounded-xl overflow-hidden">
        <summary
          className="flex justify-between items-center px-4 py-3 cursor-pointer list-none text-[11px] font-bold text-muted hover:text-text transition-colors select-none"
        >
          Calculation Methodology (12 Steps)
          <span className="text-[10px] group-open:rotate-180 transition-transform duration-200">▼</span>
        </summary>
        <div className="px-4 pb-4 border-t border-[#1e2c44] pt-3 text-[10.5px] text-muted leading-relaxed flex flex-col gap-1.5">
          {[
            '1. Turnkey = WTG + BoP (₹ Cr/MW); TotalCapex = Capacity × Turnkey.',
            '2. Debt = TotalCapex × Debt%; EquityHard = TotalCapex − Debt.',
            '3. Annuity = Debt × r × (1+r)^N / ((1+r)^N − 1) — equated annual repayment.',
            '4. GrossGen_Y1 = Capacity × 8,760 × PLF/100 (MWh); NetGen_Y1 = GrossGen × (1 − 0.5% aux).',
            '5. Revenue_Y1 = NetGen × Tariff × 1,000 / 1Cr. Working Capital = Revenue_Y1 / 12.',
            '6. For each Year n=1..25: NetGen_Yn = GrossY1 × (1−AUX) × (1−0.5%)^(n−1).',
            '7. O&M_Yn = base O&M × (1+5%)^(n−1); Insurance_Yn = CapEx × 0.4% × (1+3%)^(n−1).',
            '8. Depreciation: WDV method at 40%/yr until WDV exhausted (~Year 10).',
            '9. Tax: TaxableUnlev = max(0, EBITDA − Dep); TaxLev = max(0, EBITDA − Dep − Interest). Rate 25.168%.',
            '10. ProjectCF_n = EBITDA − TaxUnlev; EquityCF_n = EBITDA − Annuity − TaxLev (post-tenor: no DS).',
            '11. Terminal: Salvage = CapEx × 5%; CapGainsTax = max(0, Salvage−WDV) × 25.168%; add WC return.',
            '12. IRR: Newton-Raphson (seed 10%, 100 iterations). Payback: interpolated cumulative CF = 0.',
          ].map((s, i) => <p key={i}>{s}</p>)}
        </div>
      </details>

      {/* ── Disclaimer ── */}
      <div className="p-3 rounded-xl bg-[#1a1008] border border-orange/20 text-[10.5px] text-muted leading-relaxed">
        <b className="text-orange block mb-1">⚠ Indicative model — not a bankability certificate</b>
        This calculator cannot see: mast data · terrain correction · P50/P75/P90 · offtaker credit risk ·
        evacuation feasibility · land title · environmental clearances · force majeure provisions.
        Always commission a bankability study before project finance.
      </div>
    </div>
  );
}
