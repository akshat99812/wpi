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

      {/* ── Contact CECL for Bankable Reports ──────────────────────────
          Sits below the indicative-model disclaimer. Full contact card
          with title, agency name, contact grid (emails / phones /
          registered office) and CTA. */}
      <div className="rounded-xl border border-orange/30 overflow-hidden
                      bg-gradient-to-br from-[#1a140a] via-[#0e1422] to-[#090d18]
                      relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full
                     bg-orange/15 blur-3xl"
        />
        <div className="relative p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 grid place-items-center h-11 w-11 rounded-xl
                            bg-gradient-to-br from-orange/30 to-orange/10
                            border border-orange/45 text-orange">
              <BriefcaseIcon />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-orange/90">
                CECL Advisory
              </div>
              <h3 className="mt-1 text-[15px] font-black text-text leading-tight">
                Contact CECL for bankable reports
              </h3>
              <div className="mt-1 text-[10px] uppercase tracking-[0.1em] font-bold text-muted/80">
                Consolidated Energy Consultants Limited
              </div>
            </div>
          </div>

          {/* Contact grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ContactRow
              icon={<MailIcon />}
              label="Email"
              value="info@cecl.in"
              href="mailto:info@cecl.in?subject=Bankable%20Report%20Enquiry"
            />
            <ContactRow
              icon={<MailIcon />}
              label="Alt. Email"
              value="conenergy@gmail.com"
              href="mailto:conenergy@gmail.com?subject=Bankable%20Report%20Enquiry"
            />
            <ContactRow
              icon={<PhoneIcon />}
              label="Phone"
              value="+91-0755-2600241"
              href="tel:+9107552600241"
            />
            <ContactRow
              icon={<PhoneIcon />}
              label="Phone"
              value="+91-0755-4058931"
              href="tel:+9107554058931"
            />
            <ContactRow
              icon={<PinIcon />}
              label="Registered Office"
              value="‘Energy Tower’, 64-B Sector, Kasturba Nagar, Bhopal 462023, Madhya Pradesh, India"
              wide
            />
          </div>

          {/* CTA */}
          <a
            href="mailto:info@cecl.in?cc=conenergy@gmail.com&subject=Bankable%20Report%20Enquiry&body=Project%20name%3A%0ACapacity%20%28MW%29%3A%0AState%20%2F%20site%3A%0AStage%20%28pre-FID%20%2F%20FID%20%2F%20construction%29%3A%0AOfftake%20type%3A%0A"
            className="self-start inline-flex items-center gap-2
                       rounded-lg bg-gradient-to-r from-orange to-[#ffb066]
                       text-[#0a0e18] px-4 py-2.5
                       text-[11.5px] font-black uppercase tracking-[0.6px]
                       hover:opacity-95 transition-opacity"
          >
            Request bankability study
            <span className="text-[14px] leading-none">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Contact row used in the CECL Advisory card ────────────────────────────
function ContactRow({
  icon, label, value, href, wide,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  wide?: boolean;
}) {
  const inner = (
    <div className="flex items-start gap-2.5 rounded-lg
                    border border-[#1f2740] bg-[#0a0e18]/70 px-3 py-2
                    group-hover:border-orange/40 transition-colors h-full">
      <span className="text-orange/85 flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted/65">
          {label}
        </span>
        <span className={`text-[11.5px] font-bold text-text/95 ${wide ? 'leading-snug' : 'truncate'}`}>
          {value}
        </span>
      </div>
    </div>
  );
  const wrapClass = `group ${wide ? 'sm:col-span-2' : ''}`;
  return href ? (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      className={wrapClass}
    >
      {inner}
    </a>
  ) : (
    <div className={wrapClass}>{inner}</div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────
function BriefcaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M2 13h20" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92V20a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3.08a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.35a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

