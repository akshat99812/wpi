import React from 'react';

// ─── Helper Types ─────────────────────────────────────────────────────────────
interface KPI { label: string; value: string; note?: string }

// ─── Reusable KPI card ────────────────────────────────────────────────────────
function KpiCard({ kpi }: { kpi: KPI }) {
  return (
    <div className="bg-[#0d1220] border border-[#1e2c44] rounded-lg p-2.5 flex flex-col gap-0.5">
      <span className="text-[9.5px] text-[#7a8599] uppercase tracking-[0.55px] font-bold leading-tight">{kpi.label}</span>
      <b className="text-[13px] text-[#ffd0a0] font-mono leading-snug">{kpi.value}</b>
      {kpi.note && <span className="text-[9px] text-[#5a6678] leading-tight">{kpi.note}</span>}
    </div>
  );
}

// ─── Accordion section ────────────────────────────────────────────────────────
function Section({ title, kpis, cols = 2, defaultOpen = false }: {
  title: string; kpis: KPI[]; cols?: number; defaultOpen?: boolean
}) {
  return (
    <details className="group border-t border-[#192033]" open={defaultOpen}>
      <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
        {title}
        <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
      </summary>
      <div className={`pb-4 grid gap-2`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {kpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi} />)}
      </div>
    </details>
  );
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
function HBarChart({ items }: { items: { label: string; value: number; unit: string }[] }) {
  const max = Math.max(...items.map(i => i.value));
  return (
    <div className="flex flex-col gap-2 pb-4">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="text-[10px] text-muted w-28 shrink-0">{item.label}</span>
          <div className="flex-1 bg-[#0b0f19] rounded-full h-2 relative overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-orange to-[#ffb066]"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-orange-200 w-16 text-right shrink-0">{item.value} {item.unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Bullet list ─────────────────────────────────────────────────────────────
function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 pb-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-xs text-muted leading-relaxed">
          <span className="text-orange mt-0.5 shrink-0">›</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FinanceDashboard() {
  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold mb-1">
        <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
        Finance Dashboard
      </div>
      <p className="text-[11px] text-muted leading-relaxed mb-3">
        Proprietary macro parameters and operational benchmarks for India wind project finance. Updated FY2024-25.
      </p>

      {/* ── 1. Tariff Regime ── */}
      <Section title="1. Tariff Regime" defaultOpen kpis={[
        { label: 'SECI Auction Band',    value: '₹3.15 – ₹3.45/kWh', note: 'Tranche XI–XIV' },
        { label: 'State PPA Pool',       value: '₹3.62 – ₹4.15/kWh', note: 'GERC → TNERC range' },
        { label: 'FDRE / RTC Premium',   value: '+₹1.10 – ₹1.45/kWh', note: 'Wind+Solar+BESS' },
        { label: 'Hybrid RTC',           value: '₹4.40 – ₹4.65/kWh', note: 'Firm dispatchable' },
        { label: 'C&I Captive',          value: '₹3.85 – ₹4.80/kWh', note: 'Group captive uplift' },
        { label: 'Tariff Escalation',    value: 'Flat / Nil',         note: '25-yr fixed, no indexation' },
        { label: 'Must-Run Status',       value: 'Yes',               note: 'EA 2003 s.86(1)(e)' },
        { label: 'Curtailment Risk',      value: 'Low–Med',           note: '~2% national avg' },
      ]} />

      {/* ── 2. CapEx Structure ── */}
      <Section title="2. CapEx Structure (Turnkey)" kpis={[
        { label: 'Turnkey CapEx',        value: '₹7.5 – ₹8.5 Cr/MW',  note: 'FY25 all-in' },
        { label: 'WTG Package',          value: '₹4.8 – ₹6.0 Cr/MW',  note: 'Supply + E&C' },
        { label: 'BoP All-in',           value: '₹2.0 – ₹2.8 Cr/MW',  note: 'Civil + Elec' },
        { label: 'Land & ROW',           value: '₹0.15 – ₹0.30 Cr/MW', note: 'Per MW footprint' },
        { label: 'Evacuation Infra',     value: '₹0.25 – ₹0.50 Cr/MW', note: 'Line + substation' },
        { label: 'Civil & Foundation',   value: '₹0.55 – ₹0.85 Cr/MW', note: 'Rock anchor basis' },
        { label: 'IDC + Pre-op',         value: '₹0.20 – ₹0.35 Cr/MW', note: '~3% of debt' },
        { label: 'Repowering CapEx',     value: '₹4.2 – ₹5.5 Cr/MW',  note: '~60–65% of greenfield' },
        { label: 'Hub-height Premium',   value: '+₹0.15 – ₹0.25/m',   note: 'Above 120m reference' },
        { label: 'SCADA & Electricals',  value: '₹0.20 – ₹0.35 Cr/MW', note: 'Incl. grid protection' },
      ]} />

      {/* ── 3. Debt & Leverage ── */}
      <Section title="3. Debt & Leverage" kpis={[
        { label: 'IREDA Rate (FY25)',     value: '9.40% p.a.',           note: 'Floating, MCLR-linked' },
        { label: 'REC / PFC Rate',        value: '9.65 – 9.85% p.a.',   note: 'Long-term project loan' },
        { label: 'PSU Bank Rate',         value: '10.20 – 10.50% p.a.', note: 'SBI / PNB Wind loans' },
        { label: 'Leverage Band',         value: '70 – 80% D:E',        note: 'Bankable range' },
        { label: 'Debt Tenor',            value: '15 – 20 yrs',         note: 'Incl. moratorium' },
        { label: 'DSCR Covenant',         value: '≥ 1.30×',             note: 'Minimum average DSCR' },
        { label: 'DSRA',                  value: '2 quarters',          note: 'Debt service reserve' },
        { label: 'Refinance Window',      value: 'Y3 – Y5',             note: 'Post-stabilisation' },
      ]} />

      {/* ── 4. Taxation & Depreciation ── */}
      <Section title="4. Taxation & Depreciation" kpis={[
        { label: 'Sec 115BAA Effective',  value: '25.168%',   note: 'Base 22% + surcharge + cess' },
        { label: 'Standard CIT',          value: '30%',       note: 'Pre-115BAA rate' },
        { label: 'MAT',                   value: '15%',       note: 'Not applicable under 115BAA' },
        { label: 'Wind WDV (SLM)',        value: '40% / yr',  note: 'Accelerated depreciation' },
        { label: 'Acc-Dep First Year',    value: '40%',       note: 'Full-year basis' },
        { label: 'Dep Exhausted',         value: '~Year 10',  note: 'WDV < 5% by Y10' },
        { label: 'Cap-Gains on Salvage',  value: '25.168%',   note: 'On salvage − WDV' },
        { label: 'GST on WTG',            value: '12%',       note: 'As per HSN 8502.31' },
      ]} />

      {/* ── 5. Cashflow Parameters ── */}
      <Section title="5. Cashflow Parameters" kpis={[
        { label: 'Tariff Escalation',     value: '0% / yr',    note: 'Flat 25-yr PPA' },
        { label: 'O&M Escalation',        value: '5% / yr',    note: 'CECL benchmark' },
        { label: 'Insurance',             value: '0.40% CapEx', note: 'All-risk policy' },
        { label: 'Insurance Escalation',  value: '3% / yr',    note: 'CPI-linked' },
        { label: 'Generation Degradation',value: '0.5% / yr',  note: 'Post Y1' },
        { label: 'Auxiliary Load',        value: '0.5%',       note: 'Transformer + SCADA' },
        { label: 'Working Capital',       value: '1 month rev', note: 'Receivables cover' },
        { label: 'Salvage Value',         value: '5% CapEx',   note: 'End of 25-yr life' },
      ]} />

      {/* ── 6. Operating Benchmarks ── */}
      <Section title="6. Operating Benchmarks" kpis={[
        { label: 'National Avg PLF',      value: '~24%',       note: 'All-India fleet FY25' },
        { label: 'Top-Quartile PLF',      value: '32 – 38%',   note: 'Rajasthan / Gujarat' },
        { label: 'Best-in-Class PLF',     value: '40%+',       note: 'Select coastal sites' },
        { label: 'Project Life',          value: '25 yrs PPA', note: 'Standard PPA tenure' },
        { label: 'Useful Life',           value: '30 yrs',     note: 'IEC / OEM design life' },
        { label: 'O&M Run-Rate',          value: '₹7 – ₹9 L/MW/yr', note: 'AMC + spares' },
        { label: 'Bankable IRR Floor',    value: '≥ 13% (post-tax eq.)', note: 'CECL threshold' },
        { label: 'Min DSCR Target',       value: '≥ 1.30×',   note: 'Lender covenant' },
      ]} />

      {/* ── 7. FY24-25 Capacity Additions ── */}
      <details className="group border-t border-[#192033]">
        <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
          7. FY24-25 Capacity Additions
          <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
        </summary>
        <HBarChart items={[
          { label: 'Gujarat',        value: 3.4, unit: 'GW' },
          { label: 'Tamil Nadu',     value: 2.1, unit: 'GW' },
          { label: 'Karnataka',      value: 1.7, unit: 'GW' },
          { label: 'Rajasthan',      value: 1.4, unit: 'GW' },
          { label: 'Maharashtra',    value: 0.8, unit: 'GW' },
        ]} />
      </details>

      {/* ── 8. Wind Finance Macro Signals ── */}
      <details className="group border-t border-[#192033]">
        <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
          8. Wind Finance Macro Signals
          <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
        </summary>
        <BulletList items={[
          'SECI auction trajectory: 10 GW annual target from FY26; tranche sizes rising to 2-3 GW.',
          'Project debt: IREDA disbursals up 38% YoY; tenor extending to 20 yrs post-CoD.',
          'Sec 115BAA + WDV 40%: Post-tax equity IRR premium of ~1.8–2.2% vs old CIT regime.',
          'FDRE premium (₹1.10–1.45/kWh): Inflating wind allocations in blended hybrid bids.',
          'Repowering pipeline: ~10 GW sub-2 MW fleet eligible; CapEx ~60% of greenfield.',
          'ALMM-II notification: Limits WTG sourcing post-2025; OEM pricing power rising.',
          'Group captive uplift (15–20%): C&I offtake at ₹4.2–₹5.0/kWh driving private bids.',
        ]} />
      </details>

      {/* Assumptions & CECL Pro teaser */}
      <div className="mt-4 p-3.5 rounded-xl bg-[#0d1524] border border-[#1e2c44] text-[10.5px] text-muted leading-relaxed">
        <b className="text-[#c8d4e8] block mb-1">Modelling Assumptions</b>
        All figures are CECL benchmarks derived from 350+ projects across India. Tariff band reflects latest SECI/state PPA discoveries.
        IRR uses Sec 115BAA at 25.168%. O&M escalation at 5%/yr. WDV 40% for first 10 years.
        Salvage 5% of CapEx at Year 25. Working capital = 1 month revenue.
      </div>

      <div className="mt-2 p-4 rounded-xl bg-gradient-to-br from-[#1a1208] to-[#0d0d0d] border border-orange/25 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <div className="text-[9.5px] text-orange font-extrabold uppercase tracking-[1px] mb-0.5">CECL Pro — Finance Suite</div>
          <div className="text-[13px] sm:text-sm font-bold text-text">25-yr model export · Sensitivity tables · DSCR waterfalls</div>
        </div>
        <button className="self-start sm:self-auto bg-gradient-to-r from-orange to-[#ffb066] text-[#0a0e18] px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap">
          Unlock Pro
        </button>
      </div>
    </div>
  );
}
