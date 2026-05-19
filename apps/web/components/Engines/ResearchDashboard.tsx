import React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DataRow { label: string; value: string }
interface ResearchSection {
  title: string;
  chips: string[];
  narrative: string;
  data: DataRow[];
  source: string;
}

// ─── All 11 research sections per BUILD_PROMPT spec ──────────────────────────
function buildSections(potentialGw: number): ResearchSection[] {
  const potentialLabel = `${Math.round(potentialGw).toLocaleString()} GW`;
  return [
  {
    title: '1. Resource & Wind Regime',
    chips: ['@150m potential', 'offshore', 'Class I speed', 'P50→P90'],
    narrative: `India's wind resource at 150m hub height reveals ${potentialLabel} of technically exploitable capacity — nearly 7× current installed base. The resource is concentrated in 7 states, with Gujarat, Tamil Nadu, Rajasthan, Karnataka and Andhra Pradesh accounting for 80%+ of Class I potential.`,
    data: [
      { label: '@150m Potential (Tech. Exploitable)', value: potentialLabel },
      { label: '@120m Potential',                      value: '695 GW' },
      { label: 'Offshore Potential (MNRE est.)',        value: '~70 GW' },
      { label: 'Class I Wind Speed (best sites)',       value: '≥ 8.4 m/s' },
      { label: 'Top-site Wind Power Density',           value: '≥ 400 W/m²' },
      { label: 'Air Density (avg. inland)',             value: '1.18 kg/m³' },
      { label: 'P50 → P90 Spread (typical)',            value: '8 – 12%' },
      { label: 'Offshore Distance (Gujarat)',           value: '10 – 30 km' },
    ],
    source: 'NIWE Wind Atlas 2023 / Global Wind Atlas v3.3 / MNRE'
  },
  {
    title: '2. Technology Benchmark — Turbines',
    chips: ['ALMM-II', 'OEM share', 'specific power', 'localisation'],
    narrative: 'India\'s WTG market is rapidly consolidating around 3.0–4.5 MW platforms with hub heights of 140–160m, optimised for IEC Class II-III low-wind regimes. Suzlon commands ~33% market share; Inox Wind and GE account for a further 40% combined.',
    data: [
      { label: 'Avg New Install Rating (FY25)',  value: '3.4 MW' },
      { label: 'Largest Commissioned (India)',   value: 'GE 5.3 MW Cypress' },
      { label: 'Typical Hub Height',            value: '140 – 160 m' },
      { label: 'Typical Rotor Diameter',        value: '160 – 172 m' },
      { label: 'Specific Power (W/m²)',          value: '200 – 260 W/m²' },
      { label: 'Top OEM Share (Suzlon)',         value: '~33%' },
      { label: 'ALMM-II Listed OEMs',           value: 'Suzlon, Inox, Windworld' },
      { label: 'Localisation Depth',            value: '~70% by value' },
    ],
    source: 'JMK Research Q4 2024 / MNRE ALMM-II List / CECL Internal'
  },
  {
    title: '3. Policy & Regulatory Stack',
    chips: ['Repowering Policy', 'Offshore', 'RGO 2024', 'RPO', 'ALMM-II', 'Sec 115BAA'],
    narrative: 'India\'s wind policy framework has matured significantly since 2022, with the Repowering Policy, FDRE framework, and ALMM-II forming the three pillars of near-term capacity growth.',
    data: [
      { label: 'Hybrid Policy (2018)',           value: 'Wind+Solar co-location' },
      { label: 'Repowering Policy (2016 rev.)',  value: 'Pre-2000 MW eligible' },
      { label: 'RGO 2024',                      value: 'Renewable Generation Obligation' },
      { label: 'RPO Trajectory',                value: '43.33% by FY30' },
      { label: 'Offshore Wind Strategy',        value: '37 GW by FY30 (MNRE)' },
      { label: 'ALMM-II (WTG)',                 value: 'Notified; effective 2025' },
      { label: 'Sec 115BAA + Sec 32(1)',        value: 'CIT 25.168% + WDV 40%' },
    ],
    source: 'MNRE / MoP / CEA / PIB'
  },
  {
    title: '4. Tariff History & Auctions',
    chips: ['SECI tariff', 'FDRE', 'captive', 'state PPA'],
    narrative: 'Wind tariff discovery has followed a sharp compression from ₹5.5/kWh (FY14 SERC) to a sub-₹3.15/kWh SECI floor by FY25. FDRE/RTC blended bids command a ₹1.10–1.45/kWh premium for firm supply.',
    data: [
      { label: 'SECI Tranche I (2017)',        value: '₹3.46/kWh' },
      { label: 'SECI Tranche V (2019)',        value: '₹2.77/kWh (floor)' },
      { label: 'SECI Tranche XIV (FY25)',      value: '₹3.15/kWh' },
      { label: 'State DISCOM (GERC FY25)',     value: '₹3.78/kWh' },
      { label: 'FDRE RTC (SECI FDRE-II)',      value: '₹4.45/kWh' },
      { label: 'Wind + Solar + BESS',          value: '₹4.40 – ₹4.65/kWh' },
      { label: 'Captive C&I (group)',          value: '₹4.20 – ₹5.00/kWh' },
      { label: 'Group Captive Uplift',         value: '+15 – 20% vs. IPP' },
    ],
    source: 'SECI / MNRE / CERC / State SERC Orders'
  },
  {
    title: '5. Grid Integration & Curtailment',
    chips: ['DSM', 'InSTS', 'scheduling', 'GNA'],
    narrative: 'India\'s grid has improved wind integration with POSOCO scheduling reforms. National curtailment is ~2%, but localised events in Tamil Nadu can hit 8–12% in high-output months.',
    data: [
      { label: 'Scheduling Threshold',         value: '±15% of declared' },
      { label: 'Deviation Band (wind)',         value: '±50 paise/kWh' },
      { label: 'National Curtailment %',        value: '~2% (avg FY25)' },
      { label: 'TN Peak Curtailment',          value: '8 – 12%' },
      { label: 'Forecast Resolution',          value: '15-min block' },
      { label: 'InSTS Charges',               value: '₹0 for renewables' },
      { label: 'GNA Framework',               value: 'Effective Nov 2023' },
      { label: 'Wind LCOE Shadow (CERC)',       value: '~₹2.80 – ₹3.20/kWh' },
    ],
    source: 'POSOCO / CERC / NLDC Daily Reports'
  },
  {
    title: '6. Repowering Opportunity',
    chips: ['sub-2MW', 'energy uplift', 'permit cycle', 'site reuse'],
    narrative: 'India has ~10 GW of sub-2MW turbines (pre-2005) eligible for repowering. Replacing these with 3.0–4.5 MW machines at the same sites could yield 1.6–2.4× energy uplift at ~60% of greenfield CapEx.',
    data: [
      { label: 'Sub-2MW Fleet (eligible)',      value: '~10 GW (est.)' },
      { label: 'Average Fleet Age',             value: '18 – 25 yrs' },
      { label: 'Existing Site PLF (avg.)',       value: '18 – 22%' },
      { label: 'Post-Repower PLF (est.)',        value: '30 – 38%' },
      { label: 'Energy Uplift Factor',           value: '1.6 – 2.4×' },
      { label: 'Repower CapEx vs. Greenfield',   value: '~60 – 65%' },
      { label: 'Site Reuse Ratio',              value: '100% (no new land)' },
      { label: 'Permit Cycle',                  value: '12 – 18 months' },
    ],
    source: 'MNRE Repowering Policy / JMK Research / CECL Due Diligence'
  },
  {
    title: '7. Offshore Wind Program',
    chips: ['floating', 'VGF', 'LiDAR', 'Gujarat'],
    narrative: 'India\'s offshore program targets 37 GW by FY30, anchored in Gujarat (potential: 70 GW) and Tamil Nadu. First auction blockage resolved; VGF support framework under MNRE being finalised.',
    data: [
      { label: 'Total Offshore Potential',      value: '~70 GW (MNRE)' },
      { label: 'FY30 Target',                  value: '37 GW' },
      { label: 'First Auction Timeline',        value: 'FY26 (est.)' },
      { label: 'VGF Support (draft)',           value: '₹1.50 Cr/MW' },
      { label: 'Offshore LiDAR Buoys',         value: 'Active (Gujarat coast)' },
      { label: 'Seabed Lease Term',            value: '30 yrs' },
      { label: 'Min Water Depth',              value: '10 – 50 m' },
      { label: 'Tariff Range (est.)',           value: '₹6.5 – ₹9.0/kWh' },
    ],
    source: 'MNRE Offshore Wind Strategy 2023 / CEA'
  },
  {
    title: '8. Hybrid + Storage (RTC / FDRE)',
    chips: ['BESS sizing', 'CUF', 'FDRE', 'round-trip efficiency'],
    narrative: 'Round-the-clock (RTC) and Firm Dispatchable Renewable Energy (FDRE) bids are the fastest-growing auction segment in India. SECI FDRE-II cleared at ₹4.45/kWh; BESS costs have fallen 40% since FY22.',
    data: [
      { label: 'RTC Clearing History',          value: '₹3.99 – ₹4.65/kWh' },
      { label: 'FDRE Peak Block',              value: 'Sunrise to Sunset' },
      { label: 'Min Annual CUF',               value: '≥ 70%' },
      { label: 'Wind Allocation (FDRE)',        value: '50 – 60% of capacity' },
      { label: 'BESS Sizing (typical)',        value: '2–4 hrs storage' },
      { label: 'Li-ion BESS Cost (FY25)',       value: '₹2.5 – ₹3.2 Cr/MWh' },
      { label: 'Round-Trip Efficiency',        value: '~85%' },
      { label: 'Hybrid Inverter Trial (MNRE)',  value: 'Piloted in Rajasthan' },
    ],
    source: 'SECI FDRE Tender Docs / JMK Research / MNRE'
  },
  {
    title: '9. ESG, Community & Environment',
    chips: ['CO₂ payback', 'blade recycling', 'land per MW'],
    narrative: 'Wind energy\'s ESG profile is strong: ~4–6 month CO₂ payback, low water usage, and minimal land occupation. Community engagement remains the key social challenge for greenfield projects.',
    data: [
      { label: 'Land per MW (total footprint)', value: '~0.02 km²/MW' },
      { label: 'CO₂ Payback Period',           value: '4 – 6 months' },
      { label: 'Lifecycle CO₂ (g/kWh)',        value: '7 – 10 g CO₂/kWh' },
      { label: 'Avian Mortality (risk)',        value: 'Low–Mod (site specific)' },
      { label: 'Decommissioning Fund',         value: 'Not mandated (India)' },
      { label: 'Blade Recycling Status',       value: 'Pilot stage (Suzlon)' },
      { label: 'Women in Workforce',           value: '~12% (industry avg.)' },
      { label: 'Noise Setback (typical)',       value: '500 m residential' },
    ],
    source: 'GWEC / IRENA / CECL ESG Diligence'
  },
  {
    title: '10. R&D Frontier',
    chips: ['floating LCOE', 'digital twin', 'green H₂', 'AWE'],
    narrative: 'Next-gen wind technologies — floating offshore, airborne wind energy (AWE), and digital-twin micrositing — are at various TRL stages. Green hydrogen from dedicated wind shows sub-₹220/kg potential by FY35.',
    data: [
      { label: 'Floating Offshore LCOE (est.)', value: '₹8 – ₹12/kWh (FY30)' },
      { label: 'Digital-Twin O&M Savings',      value: '8 – 15%' },
      { label: 'Green H₂ from Wind (est.)',      value: '₹180 – ₹220/kg (FY35)' },
      { label: 'NGHM Outlay (MNRE)',            value: '₹19,744 Cr (PLI)' },
      { label: 'AWE TRL (best-in-class)',        value: 'TRL 5 – 6' },
      { label: 'CFD Micrositing Accuracy',       value: '±5% P50 (100m res.)' },
      { label: 'LiDAR Adoption (India)',         value: '~35% new projects' },
      { label: 'Hybrid Inverter Field Trial',    value: 'Rajasthan (MNRE pilot)' },
    ],
    source: 'IRENA / NREL / CECL R&D Watch'
  },
  {
    title: '11. State Comparator',
    chips: ['installed GW', 'avg PLF', 'best WPD', 'tariff'],
    narrative: 'Six states account for 90% of India\'s installed wind capacity. Gujarat leads additions in FY25 with 3.4 GW, while Tamil Nadu has the highest historical fleet.',
    data: [
      { label: 'Gujarat — Installed',     value: '11.0 GW | PLF 26% | ₹3.78/kWh' },
      { label: 'Tamil Nadu — Installed',  value: '9.5 GW  | PLF 29% | ₹3.95/kWh' },
      { label: 'Karnataka — Installed',   value: '6.1 GW  | PLF 28% | ₹4.05/kWh' },
      { label: 'Rajasthan — Installed',   value: '7.1 GW  | PLF 32% | ₹3.62/kWh' },
      { label: 'Andhra Pradesh',          value: '4.2 GW  | PLF 27% | ₹3.85/kWh' },
      { label: 'Maharashtra',             value: '3.8 GW  | PLF 23% | ₹4.12/kWh' },
    ],
    source: 'MNRE Physical Progress / State SERC Orders / NIWE'
  }
  ];
}

// ─── KPI row ──────────────────────────────────────────────────────────────────
function DataRow({ label, value }: DataRow) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-3 bg-[#0b0f19] border border-[#1a2138] px-3 py-2 rounded-lg">
      <span className="text-[10px] text-[#7a8599] leading-snug">{label}</span>
      <span className="text-[11px] font-mono font-bold text-[#ffd0a0] sm:text-right leading-snug break-words">{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ResearchDashboard({ potentialGw }: { potentialGw?: number } = {}) {
  const effectivePotentialGw = potentialGw ?? 1163.9;
  const potentialLabel = `${Math.round(effectivePotentialGw).toLocaleString()} GW`;
  const SECTIONS = buildSections(effectivePotentialGw);
  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
        <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
        Research Bench
      </div>

      {/* Top KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: 'Installed Wind',    value: '48.2 GW' },
          { label: 'FY30 Target',       value: '140 GW' },
          { label: 'Potential @150m',   value: potentialLabel },
          { label: 'FY25 Auction Low',  value: '₹3.15/kWh' },
          { label: 'National Avg PLF',  value: '~24%' },
          { label: 'Top-Decile PLF',    value: '38 – 42%' },
        ].map((kpi, idx) => (
          <div key={idx} className="bg-[#131826] border border-[#1e2c44] p-2.5 rounded-xl flex flex-col gap-0.5">
            <div className="text-[9px] text-muted uppercase font-bold tracking-wide">{kpi.label}</div>
            <div className="text-[13px] font-bold text-text">{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* 11 Collapsible Sections */}
      <div className="flex flex-col gap-2">
        {SECTIONS.map((sec, i) => (
          <details key={i} className="group border border-[#1a2138] rounded-xl overflow-hidden bg-[#0d1220]">
            <summary className="flex justify-between items-center gap-3 px-3 sm:px-4 py-3 cursor-pointer list-none hover:bg-[#151e30] transition-colors select-none">
              <span className="text-[13px] sm:text-sm font-bold text-[#c8d4e8] min-w-0">{sec.title}</span>
              <span className="text-[10px] text-muted shrink-0 group-open:rotate-180 transition-transform duration-200">▼</span>
            </summary>
            <div className="px-3 sm:px-4 pb-4 border-t border-[#1a2138] flex flex-col gap-3 pt-3">
              {/* Tag chips */}
              <div className="flex flex-wrap gap-1.5">
                {sec.chips.map(chip => (
                  <span key={chip} className="px-2 py-0.5 bg-[#1a2133] border border-[#27324a] rounded text-[9.5px] text-orange-200 font-medium">
                    #{chip}
                  </span>
                ))}
              </div>
              {/* Narrative */}
              <p className="text-[11px] text-muted leading-relaxed">{sec.narrative}</p>
              {/* Data rows */}
              <div className="grid grid-cols-1 gap-1.5">
                {sec.data.map(d => <DataRow key={d.label} {...d} />)}
              </div>
              {/* Source */}
              <div className="text-[9px] text-muted/40 italic text-right">Source: {sec.source}</div>
            </div>
          </details>
        ))}
      </div>

      {/* Directory of Indian Windpower 2025 — purchase CTA */}
      <a
        href="https://www.amazon.in/Directory-Indian-Windpower-2025-Jubilee/dp/B0FVFY1ZHW"
        target="_blank"
        rel="noopener noreferrer"
        className="group relative overflow-hidden mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4
                   rounded-xl border border-orange/30
                   bg-gradient-to-br from-[#1a140a] via-[#0f1424] to-[#0a0e18]
                   px-4 py-3.5
                   hover:border-orange/55 transition-colors"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full
                     bg-orange/15 blur-3xl"
        />

        <div className="flex items-center gap-3 sm:gap-3.5 relative min-w-0">
          {/* Book spine glyph — inline SVG so we don't pull an icon lib */}
          <div className="shrink-0 w-9 h-11 rounded-[3px] bg-gradient-to-b from-orange to-[#c25e10]
                          shadow-[0_4px_12px_-4px_rgba(255,138,31,0.55)] flex items-center justify-center
                          border-l-[3px] border-l-[#7d3a08]">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0a0e18" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
              <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 18.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-orange/85 font-bold">
              Reference · Print Edition
            </div>
            <div className="text-[12.5px] sm:text-[13px] font-bold text-text leading-tight mt-0.5">
              Directory of Indian Windpower 2025
            </div>
            <div className="text-[10.5px] text-muted leading-snug mt-0.5">
              CECL Silver Jubilee edition · OEMs, IPPs, EPCs, consultants
            </div>
          </div>
        </div>

        <span className="relative self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg
                         bg-gradient-to-r from-orange to-[#ffb066]
                         text-[#0a0e18] px-3.5 py-2
                         text-[11.5px] font-bold tracking-tight whitespace-nowrap
                         shadow-[0_8px_20px_-8px_rgba(255,138,31,0.55)]
                         group-hover:shadow-[0_12px_28px_-8px_rgba(255,138,31,0.70)]
                         transition-shadow">
          Buy on Amazon
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">↗</span>
        </span>
      </a>

      {/* CECL Pro teaser */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-[#0f1a0d] to-[#0d0d0d] border border-[#2a4020] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-2">
        <div>
          <div className="text-[9.5px] text-[#6ecf80] font-extrabold uppercase tracking-[1px] mb-0.5">CECL Pro — Research Suite</div>
          <div className="text-[13px] sm:text-sm font-bold text-text">Full report access · State deep-dives · NIWE API</div>
        </div>
        <button className="self-start sm:self-auto bg-gradient-to-r from-[#4cc87a] to-[#2da85a] text-[#0a0e18] px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap">
          Unlock Pro
        </button>
      </div>
    </div>
  );
}
