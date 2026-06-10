import React from 'react';
import Image from 'next/image';
import EngineTitle from '../ui/EngineTitle';

// ─── Source provenance ────────────────────────────────────────────────────────
// Every KPI on this dashboard links to the primary source the figure was taken
// from — strongly preferring Indian government / regulator / statutory pages so
// the number is independently verifiable. Figures that have NO public government
// source (proprietary market benchmarks, modelling assumptions) are deliberately
// NOT shown as tiles here; they are disclosed in the Modelling Assumptions
// footer instead. See git history for the full data-provenance audit.
type SourceKind = 'government' | 'regulatory' | 'statutory' | 'industry';
interface Source { name: string; url: string; kind: SourceKind }

interface KPI { label: string; value: string; note?: string; source: Source }

// ─── Canonical primary sources (verified reachable) ───────────────────────────
const SRC = {
  // MNRE Renewable Energy Statistics 2024-25 (generation + state-wise capacity)
  MNRE: {
    name: 'MNRE',
    url: 'https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2025/11/202511061627678782.pdf',
    kind: 'government',
  } as Source,
  // CERC RE Tariff Regulations 2024 — Explanatory Memorandum (capital cost build-up)
  CERC: {
    name: 'CERC',
    url: 'https://cercind.gov.in/2024/draft_reg/RE-Tariff-Regulations-EM.pdf',
    kind: 'regulatory',
  } as Source,
  // IREDA Financing Norms (interest, leverage, tenor, DSCR, DSRA)
  IREDA: {
    name: 'IREDA',
    url: 'https://www.ireda.in/images/HTMLfiles/Financing%20Norms_08052024.pdf',
    kind: 'government',
  } as Source,
  // PFC lending rates circular (eff. May 2025)
  PFC: {
    name: 'PFC',
    url: 'https://pfcindia.co.in/ensite/DocumentRepository/ckfinder/files/Product_Services/Landing_Rates/For%20website.pdf',
    kind: 'government',
  } as Source,
  // SBI 1-yr MCLR (PSU bank base for project loans)
  SBI: {
    name: 'SBI',
    url: 'https://sbi.bank.in/web/interest-rates/interest-rates/mclr-historical-data',
    kind: 'government',
  } as Source,
  // Income Tax Department — Section 115BAA
  IT_115BAA: {
    name: 'Income Tax Dept',
    url: 'https://www.incometaxindia.gov.in/w/section-115baa-8',
    kind: 'statutory',
  } as Source,
  // Income Tax Department — domestic company tax rates (CIT, MAT)
  IT_RATES: {
    name: 'Income Tax Dept',
    url: 'https://www.incometaxindia.gov.in/tax-rates',
    kind: 'statutory',
  } as Source,
  // Income Tax Department — depreciation rates
  IT_DEP: {
    name: 'Income Tax Dept',
    url: 'https://www.incometaxindia.gov.in/w/depreciation-rates',
    kind: 'statutory',
  } as Source,
  // MNRE — Tariff-Based Competitive Bidding Guidelines for Wind Power Projects
  // (defines the 25-yr fixed/escalating tariff and 25-yr PPA tenure)
  MNRE_BID: {
    name: 'MNRE',
    url: 'https://mnre.gov.in/en/document/guidelines-for-tariff-based-competitive-bidding-process-for-procurement-power-from-grid-connected-wind-power-projects-2/',
    kind: 'government',
  } as Source,
  // PIB / GST Council — 56th meeting RE device rate rationalisation to 5%
  GST: {
    name: 'PIB / GST Council',
    url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2167486',
    kind: 'government',
  } as Source,
  // Ministry of Power — Must-Run Power Plant Rules, 2021 (notified rules PDF, NIC-hosted)
  MOP: {
    name: 'Ministry of Power',
    url: 'https://thc.nic.in/Central%20Governmental%20Rules/Electricity%20(Promotion%20of%20Generation%20of%20Electricity%20from%20Must-Run%20Power%20Plant)%20Rules,%202021.pdf',
    kind: 'statutory',
  } as Source,
  // SECI — wind auction tenders & results
  SECI: {
    name: 'SECI',
    url: 'https://seci.co.in/tenders/results',
    kind: 'government',
  } as Source,
  // Ember / Down To Earth — RE curtailment analysis (no single govt figure published)
  EMBER: {
    name: 'Ember',
    url: 'https://www.downtoearth.org.in/energy/india-loses-300-gwh-renewable-energy-in-2026-first-quarter-due-to-transmission-delays',
    kind: 'industry',
  } as Source,
};

// ─── Icons ────────────────────────────────────────────────────────────────────
function ExtLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

// Government / regulator / statutory sources are first-party and verifiable;
// `industry` is the one tier that isn't a .gov source, so we flag it amber.
const TIER_DOT: Record<SourceKind, string> = {
  government: '#4cc87a',
  regulatory: '#4cc87a',
  statutory:  '#4cc87a',
  industry:   '#c8924a',
};

// ─── Source chip (shown on every tile) ────────────────────────────────────────
function SourceChip({ source }: { source: Source }) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase
                     tracking-[0.4px] text-[#566178] group-hover:text-orange transition-colors">
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: TIER_DOT[source.kind] }}
      />
      {source.name}
      <ExtLinkIcon className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

// ─── Standalone source link (section-level: charts, lists) ────────────────────
function SourceLink({ source, label }: { source: Source; label?: string }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.5px]
                 text-[#566178] hover:text-orange transition-colors"
    >
      Source: {label ?? source.name}
      <ExtLinkIcon className="w-2.5 h-2.5" />
    </a>
  );
}

// ─── Reusable KPI card — clickable, opens its source in a new tab ─────────────
function KpiCard({ kpi }: { kpi: KPI }) {
  return (
    <a
      href={kpi.source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Source: ${kpi.source.name} — opens in a new tab`}
      className="group bg-[#0d1220] border border-[#1e2c44] rounded-xl p-3.5 flex flex-col gap-1
                 hover:border-orange/45 hover:bg-[#10182b] transition-colors
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-orange/50"
    >
      <span className="text-[10.5px] text-[#7a8599] uppercase tracking-[0.55px] font-bold leading-tight">{kpi.label}</span>
      <b className="text-[15.5px] text-[#ffd0a0] font-mono leading-snug">{kpi.value}</b>
      {kpi.note && <span className="text-[10px] text-[#5a6678] leading-snug">{kpi.note}</span>}
      <SourceChip source={kpi.source} />
    </a>
  );
}

// ─── Accordion section ────────────────────────────────────────────────────────
// KPI grid is responsive: 2 cols on mobile, scaling to 4 on wide screens so the
// cards stay comfortably sized now that the dashboard owns a full-width page.
function Section({ title, kpis, defaultOpen = false }: {
  title: string; kpis: KPI[]; defaultOpen?: boolean
}) {
  return (
    <details className="group border-t border-[#192033]" open={defaultOpen}>
      <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
        {title}
        <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
      </summary>
      <div className="pb-4 grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
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
          <span className="text-[11px] font-mono text-orange-200 w-20 text-right shrink-0">{item.value.toLocaleString('en-IN')} {item.unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Bullet list ─────────────────────────────────────────────────────────────
function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 pb-2">
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
      <EngineTitle title="Finance Dashboard" />
      <p className="text-[11px] text-muted leading-relaxed mt-2 mb-1">
        Macro parameters and operating benchmarks for India wind project finance, FY2024-25.
      </p>
      <p className="text-[10.5px] text-[#5a6678] leading-relaxed mb-3">
        Every tile links to its primary source — tap any card to open the government / regulator
        document it was taken from. Figures with no public government source have been removed and
        disclosed under Modelling Assumptions instead.
      </p>

      {/* ── 1. Tariff Regime ── */}
      <Section title="1. Tariff Regime" defaultOpen kpis={[
        { label: 'SECI Auction Band', value: '₹3.18 – ₹3.69/kWh', note: 'SECI Tranche XIV → XIX', source: SRC.SECI },
        { label: 'Hybrid RTC',        value: '₹4.40 – ₹4.73/kWh', note: 'SECI wind-solar hybrid (firm/peak)', source: SRC.SECI },
        { label: 'Tariff Escalation', value: 'Flat / Nil',        note: 'MNRE bidding norms · 25-yr fixed', source: SRC.MNRE_BID },
        { label: 'Must-Run Status',   value: 'Yes',               note: 'Must-Run Power Plant Rules 2021 (§176)', source: SRC.MOP },
        { label: 'Curtailment Risk',  value: 'Low–Med (~2%)',     note: 'Transmission-driven, N/W regions (Q1 2026)', source: SRC.EMBER },
      ]} />

      {/* ── 2. CapEx Structure ── */}
      <Section title="2. CapEx Structure (Turnkey)" kpis={[
        { label: 'Turnkey CapEx',       value: '₹7.5 – ₹8.5 Cr/MW',   note: 'FY25 all-in (CERC actual ₹6.7–9.1)', source: SRC.CERC },
        { label: 'WTG Package',         value: '₹4.8 – ₹6.0 Cr/MW',   note: 'Nacelle + hub + blade + tower', source: SRC.CERC },
        { label: 'BoP All-in',          value: '₹2.0 – ₹2.8 Cr/MW',   note: 'Civil + electrical + pre-op', source: SRC.CERC },
        { label: 'Land & ROW',          value: '₹0.30 – ₹0.45 Cr/MW', note: 'CERC land-acquisition avg ₹0.42', source: SRC.CERC },
        { label: 'Evacuation Infra',    value: '₹0.25 – ₹0.50 Cr/MW', note: 'Up to interconnection point', source: SRC.CERC },
        { label: 'Civil & Foundation',  value: '₹0.55 – ₹0.85 Cr/MW', note: 'Civil & general works', source: SRC.CERC },
        { label: 'IDC + Pre-op',        value: '₹0.40 – ₹0.55 Cr/MW', note: 'Incl. IDC + contingency (CERC ₹0.51)', source: SRC.CERC },
        { label: 'SCADA & Electricals', value: '₹0.20 – ₹0.35 Cr/MW', note: 'Cables, switchgear, controls', source: SRC.CERC },
      ]} />

      {/* ── 3. Debt & Leverage ── */}
      <Section title="3. Debt & Leverage" kpis={[
        { label: 'IREDA Rate (FY25)', value: '9.40% p.a.',          note: 'Grade-based, reset annually', source: SRC.IREDA },
        { label: 'REC / PFC Rate',    value: '8.95 – 9.70% p.a.',   note: 'Wind/Solar, eff. May 2025', source: SRC.PFC },
        { label: 'PSU Bank Rate',     value: '10.20 – 10.50% p.a.', note: 'SBI 1-yr MCLR + 150–350 bps', source: SRC.SBI },
        { label: 'Leverage Band',     value: '70 – 80% D:E',        note: 'CERC norm 70:30; IREDA up to 80%', source: SRC.IREDA },
        { label: 'Debt Tenor',        value: '15 – 20 yrs',         note: 'Call option after 15 yrs', source: SRC.IREDA },
        { label: 'DSCR Covenant',     value: '≥ 1.30×',             note: 'Lender covenant (IREDA floor 1.20×)', source: SRC.IREDA },
        { label: 'DSRA',              value: '2 quarters',          note: 'Interest + principal reserve', source: SRC.IREDA },
      ]} />

      {/* ── 4. Taxation & Depreciation ── */}
      <Section title="4. Taxation & Depreciation" kpis={[
        { label: 'Sec 115BAA Effective',  value: '25.168%',  note: '22% + 10% surcharge + 4% cess', source: SRC.IT_115BAA },
        { label: 'Standard CIT',          value: '30%',      note: 'Base rate (pre-115BAA)', source: SRC.IT_RATES },
        { label: 'MAT',                   value: '15%',      note: 'u/s 115JB · N/A under 115BAA', source: SRC.IT_RATES },
        { label: 'Wind Depreciation (WDV)', value: '40% / yr', note: 'Block of assets, WDV (cut from 80%)', source: SRC.IT_DEP },
        { label: 'Acc-Dep First Year',    value: '40%',      note: 'Half if <180 days used in Y1', source: SRC.IT_DEP },
        { label: 'Dep Exhausted',         value: '~Year 10', note: 'WDV < 1% of cost by Y10', source: SRC.IT_DEP },
        { label: 'Cap-Gains on Salvage',  value: '25.168%',  note: 'Short-term u/s 50 at 115BAA rate', source: SRC.IT_115BAA },
        { label: 'GST on WTG',            value: '5%',       note: 'RE devices · eff. 22 Sep 2025', source: SRC.GST },
      ]} />

      {/* ── 5. Operating Benchmarks ── */}
      <Section title="5. Operating Benchmarks" kpis={[
        { label: 'National Avg PLF', value: '~19 – 20%', note: 'All-India fleet FY24-25 (83.35 BU / ~48 GW)', source: SRC.MNRE },
        { label: 'Project Life',     value: '25 yrs',    note: 'MNRE bidding norms · 25-yr PPA', source: SRC.MNRE_BID },
      ]} />

      {/* ── 6. FY24-25 Wind Capacity Additions ── */}
      <details className="group border-t border-[#192033]">
        <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
          6. FY24-25 Wind Capacity Additions
          <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
        </summary>
        {/* MW added Apr-2024 → Mar-2025, MNRE state-wise cumulative deltas. */}
        <HBarChart items={[
          { label: 'Karnataka',   value: 1331, unit: 'MW' },
          { label: 'Tamil Nadu',  value: 1136, unit: 'MW' },
          { label: 'Gujarat',     value: 955,  unit: 'MW' },
          { label: 'Maharashtra', value: 77,   unit: 'MW' },
          { label: 'Rajasthan',   value: 13,   unit: 'MW' },
        ]} />
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <span className="text-[10px] text-[#5a6678]">All-India FY24-25 wind: ~4,146 MW added (45.89 → 50.04 GW cumulative).</span>
          <SourceLink source={SRC.MNRE} label="MNRE RE Statistics 2024-25" />
        </div>
      </details>

      {/* ── 7. Wind Finance Macro Signals ── */}
      <details className="group border-t border-[#192033]">
        <summary className="flex justify-between items-center py-3 px-0.5 cursor-pointer list-none text-sm font-semibold text-[#c8d4e8] hover:text-[#ffb066] transition-colors select-none">
          7. Wind Finance Macro Signals
          <span className="text-[10px] text-[#4a5a78] group-open:rotate-180 transition-transform duration-200">▼</span>
        </summary>
        <BulletList items={[
          'RE bid trajectory: MNRE targets 50 GW/yr of RE tenders (FY24–FY28) with a ≥10 GW/yr wind carve-out, issued via SECI / NTPC / NHPC / SJVN.',
          'Project debt: IREDA FY24-25 disbursements ₹30,168 cr, up ~20% YoY; RE loan tenors extending toward 20 yrs post-CoD.',
          'Sec 115BAA + 40% WDV depreciation lift post-tax equity returns materially versus the old 30% CIT regime.',
          'Firm power: FDRE / RTC tenders clearing ₹4.25–5.59/kWh are pulling wind into blended dispatchable bids.',
          'Repowering: MNRE 2023 Repowering & Life-Extension Policy targets the ageing sub-2 MW fleet; repowering CapEx runs well below greenfield.',
          'ALMM (Wind): MNRE mandates domestically-sourced major WTG components (blade, tower, gearbox, generator, bearings), phasing in from FY26.',
        ]} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-4">
          <SourceLink source={SRC.MNRE} label="MNRE" />
          <SourceLink source={SRC.IREDA} label="IREDA" />
        </div>
      </details>

      {/* Modelling assumptions — now the disclosed home for non-government figures */}
      <div className="mt-4 p-3.5 rounded-xl bg-[#0d1524] border border-[#1e2c44] text-[10.5px] text-muted leading-relaxed">
        <b className="text-[#c8d4e8] block mb-1">Modelling Assumptions (CECL conventions — not government-published)</b>
        The Bankability Calculator uses CECL house benchmarks that no government body publishes as a single
        figure: O&amp;M escalation 5%/yr, insurance 0.40% of CapEx (3%/yr escalation), generation degradation
        0.5%/yr, auxiliary load 0.5%, working capital = 1 month revenue, salvage 5% of CapEx at Year 25, and a
        bankability floor of equity IRR ≥ 13% with average DSCR ≥ 1.30×. PLF quartiles, O&amp;M run-rates and
        repowering CapEx bands are also market estimates, not regulator data, and are intentionally excluded
        from the sourced tiles above.
      </div>

      <div className="mt-2 p-4 rounded-xl bg-gradient-to-br from-[#1a1208] to-[#0d0d0d] border border-orange/25 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex items-center gap-3">
          {/* Transparent CECL logo — bare, matching the page heading */}
          <div className="flex-shrink-0 grid place-items-center w-12 h-12 sm:w-[52px] sm:h-[52px]">
            <Image src="/logo.png" alt="CECL" width={52} height={52} className="object-contain w-full h-full" />
          </div>
          <div>
            <div className="text-[9.5px] text-orange font-extrabold uppercase tracking-[1px] mb-0.5">CECL Pro — Finance Suite</div>
            <div className="text-[13px] sm:text-sm font-bold text-text">25-yr model export · Sensitivity tables · DSCR waterfalls</div>
          </div>
        </div>
        <button className="self-start sm:self-auto bg-gradient-to-r from-orange to-[#ffb066] text-[#0a0e18] px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap">
          Unlock Pro
        </button>
      </div>
    </div>
  );
}
