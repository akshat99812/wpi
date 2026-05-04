"use client";

import React, { useState, useMemo, useCallback } from 'react';
import { calculateIRR } from '@/lib/math';
import MethodologyPanel from '../KnowledgeBank/MethodologyPanel';
import FinancialSliders from '../ui/Animatedsliders';

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
      <FinancialSliders p={p} set={set} />

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
       {/* ── Methodology ── */}
        <div className="mt-8">
          <MethodologyPanel />
        </div>
      

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
