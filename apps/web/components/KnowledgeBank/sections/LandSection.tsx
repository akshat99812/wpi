"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  HeadlineMetric, InfoCard, Prose, ChipRow,
  SectionHeader, SourceLinks,
} from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const SOURCES = [
  { label: 'MoEFCC Forest Clearance', url: 'https://parivesh.nic.in/' },
  { label: 'NIWE Land Suitability',   url: 'https://niwe.res.in/' },
  { label: 'State Wind Policies',     url: 'https://mnre.gov.in/state-policies' },
  { label: 'Supreme Court — Bustard order', url: 'https://main.sci.gov.in/' },
];

export default function LandSection({ bundle: _bundle }: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow="Land & Permitting"
        title="Land — Acquisition, Forest, Wildlife"
        delay={0}
      />

      {/* Headline benchmarks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric
          delay={60} emphasis accent="#ff8a1f"
          label="Land per MW"
          value="2.5 – 4.0 acres"
          caption="Utility-scale onshore (3–4 MW class · 150 m hub)"
        />
        <HeadlineMetric
          delay={120} emphasis accent="#7bc4e2"
          label="Project Footprint"
          value="~0.8 – 1.2%"
          caption="Of leased area; balance free for grazing/agri"
        />
        <HeadlineMetric
          delay={180} emphasis accent="#ffb066"
          label="Forest Clearance Time"
          value="9 – 24 months"
          caption="Stage-I + Stage-II under FCA 1980"
        />
      </div>

      {/* Quick framework chips */}
      <div
        className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-3.5"
        style={{ ['--wpi-delay' as string]: '240ms' }}
      >
        <span className="text-[9.5px] text-muted/55 uppercase tracking-[0.12em] font-bold">
          Land regimes
        </span>
        <ChipRow chips={[
          { label: 'Private',       value: 'Direct negotiation', accent: '#ff8a1f' },
          { label: 'Govt Wasteland',value: 'State pooling',      accent: '#4cc87a' },
          { label: 'Forest',        value: 'FCA 1980',           accent: '#ffb066' },
          { label: 'Eminent Domain',value: 'RFCTLARR 2013' },
          { label: 'Common Pool',   value: 'Community consent' },
        ]} />
      </div>

      {/* Land take */}
      <InfoCard
        title="Land take & footprint"
        delay={300}
        defaultOpen
        icon={<MapIcon />}
        accent="#ff8a1f"
      >
        <Prose>
          Modern 3–4 MW onshore turbines need <b className="text-[#ffd0a0]">2.5 – 4 acres of total
          leased land per MW</b>, but only ~0.8–1.2% is permanently
          built-up (turbine pad + access road + transformer yard). The rest
          remains under continued grazing or rain-fed agriculture, which
          underpins the standard 30-year lease model.
        </Prose>
        <Prose>
          Inter-turbine spacing follows a <b className="text-[#7bc4e2]">3D × 7D rule</b>
          (3 rotor-diameters across-wind, 7 along-wind) — a 150 m rotor
          therefore occupies a ~450 m × 1,050 m influence cell. Site layout
          is the dominant variable for net AEP (energy production) once
          micrositing is locked.
        </Prose>
        <ChipRow chips={[
          { label: 'Lease Tenor',     value: '30 yr (extendable)', accent: '#4cc87a' },
          { label: 'Lease Rate',      value: '₹15k – 50k/acre/yr' },
          { label: 'Permanent Use',   value: '0.8 – 1.2%' },
          { label: 'Spacing',         value: '3D × 7D' },
        ]} />
        <ViewSource href="https://niwe.res.in/" label="NIWE Land Suitability" accent="#ff8a1f" />
      </InfoCard>

      {/* Acquisition routes */}
      <InfoCard
        title="Acquisition routes"
        delay={360}
        icon={<RouteIcon />}
        accent="#4cc87a"
      >
        <Prose>
          Three mainstream acquisition routes:
        </Prose>

        <div className="flex flex-col gap-2 mt-1">
          <RouteItem
            color="#ff8a1f"
            heading="Private negotiation"
            body="Default for Gujarat, Tamil Nadu, Andhra. Aggregator-led parcel assembly via local intermediaries. Fastest path but exposes the developer to title-defect & ceiling-act risk; mitigated by 30-yr registered leases instead of sale."
          />
          <RouteItem
            color="#4cc87a"
            heading="State wasteland pooling"
            body="Rajasthan, Madhya Pradesh, Karnataka run pooled-allocation schemes — government identifies revenue-recorded wasteland, pools it under a state agency (RRECL, MPUVNL, KREDL), and allots blocks to developers via competitive process at notified rates."
          />
          <RouteItem
            color="#a5b4fc"
            heading="RFCTLARR 2013"
            body="Right to Fair Compensation & Transparency in Land Acquisition Act — invoked rarely for wind, mostly for transmission corridors. Triggers SIA, R&R requirements, and 4× rural / 2× urban compensation multipliers."
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://dolr.gov.in/" label="RFCTLARR — DoLR" accent="#4cc87a" />
          <ViewSource href="https://mnre.gov.in/state-policies" label="State Wind Policies" accent="#4cc87a" />
        </div>
      </InfoCard>

      {/* Forest clearance */}
      <InfoCard
        title="Forest land — FCA 1980"
        delay={420}
        icon={<TreeIcon />}
        accent="#ffb066"
      >
        <Prose>
          Diversion of forest land for wind requires <b className="text-[#ffb066]">Stage-I (in-principle)</b>
          and <b className="text-[#ffb066]">Stage-II (final)</b> clearance under
          the Forest (Conservation) Act 1980. The Parivesh portal (MoEFCC)
          is the single window. Compensatory afforestation at 1:1 ratio is
          mandatory; NPV recovery scales with forest density &amp; quality
          (₹4.4 – 14.6 lakh/ha).
        </Prose>
        <Prose>
          Recent doctrine: project linear elements (access roads, transmission
          lines) inside <b className="text-[#f87171]">notified protected
          forests</b> are increasingly being denied — pushing developers to
          underground HV cables or longer overhead routings around PA
          boundaries.
        </Prose>
        <ChipRow chips={[
          { label: 'Stage-I',    value: '6 – 12 m', accent: '#ffb066' },
          { label: 'Stage-II',   value: '3 – 12 m', accent: '#ffb066' },
          { label: 'CA Ratio',   value: '1 : 1' },
          { label: 'NPV Range',  value: '₹4.4 – 14.6 L/ha' },
        ]} />
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://parivesh.nic.in/" label="Parivesh — Single Window" accent="#ffb066" />
          <ViewSource href="https://moef.gov.in/" label="MoEFCC" accent="#ffb066" />
        </div>
      </InfoCard>

      {/* Wildlife & biodiversity */}
      <InfoCard
        title="Wildlife & biodiversity"
        delay={480}
        icon={<BirdIcon />}
        accent="#f87171"
      >
        <Prose>
          The defining wildlife issue is the <b className="text-[#f87171]">Great Indian Bustard
          (GIB)</b> — Schedule-I, IUCN Critically Endangered, ~150
          remaining. Following the Supreme Court&apos;s 2021 order in
          <i> M.K. Ranjitsinh v. Union of India</i>, ~13,000 sq km of
          GIB habitat in Rajasthan and Gujarat were designated &quot;priority&quot;
          (no overhead lines) or &quot;potential&quot; (lines must be
          undergrounded or fitted with bird-diverters). The 2024 SC
          modification narrowed the priority area but kept undergrounding
          and diverter rules.
        </Prose>
        <Prose>
          Other constraints: <b className="text-[#7bc4e2]">migratory bird
          corridors</b> in Kutch (flamingos, cranes), bat-fatality monitoring
          (NIWE protocol since 2018), and turbine-curtailment-on-detection
          schemes piloted at Suzlon&apos;s Kutch sites.
        </Prose>
        <ChipRow chips={[
          { label: 'GIB Priority',  value: '~6,400 sq km', accent: '#f87171' },
          { label: 'GIB Potential', value: '~6,600 sq km', accent: '#ffb066' },
          { label: 'OH lines',      value: 'Undergrounded' },
          { label: 'Bird Diverters',value: 'Mandatory',     accent: '#4cc87a' },
        ]} />
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://main.sci.gov.in/" label="SC — GIB Order" accent="#f87171" />
          <ViewSource href="https://wii.gov.in/" label="Wildlife Institute of India" accent="#f87171" />
        </div>
      </InfoCard>

      {/* State land regimes */}
      <InfoCard
        title="State-wise land regimes"
        delay={540}
        icon={<GridIcon />}
        accent="#a5b4fc"
      >
        <Prose>
          Each major wind state has its own land-allocation playbook for
          government-owned wasteland or non-forest revenue land. These
          shape acquisition timelines and project risk:
        </Prose>

        <div className="flex flex-col gap-2 mt-1">
          {[
            { state: 'Gujarat',     route: 'GUVNL Phase-V private + Bhuj pooling',         dt: '6–9 m',  accent: '#ff8a1f' },
            { state: 'Tamil Nadu',  route: 'Private (TN Wind Policy 2024 simplification)', dt: '3–6 m',  accent: '#4cc87a' },
            { state: 'Karnataka',   route: 'KREDL pooled allotment',                       dt: '9–12 m', accent: '#7bc4e2' },
            { state: 'Rajasthan',   route: 'RRECL allotment + GIB overlay',                dt: '12–18 m',accent: '#f87171' },
            { state: 'Maharashtra', route: 'Private + MEDA pooling',                       dt: '6–12 m', accent: '#ffb066' },
            { state: 'Madhya Pr.',  route: 'MPUVNL Wasteland scheme',                      dt: '6–9 m',  accent: '#a5b4fc' },
          ].map(s => (
            <div key={s.state} className="flex items-center justify-between gap-3 bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-2.5 hover:border-orange/40 transition-colors">
              <span className="text-[12px] font-bold text-text/90 w-[90px] flex-shrink-0">{s.state}</span>
              <span className="text-[11px] text-muted/75 flex-1 min-w-0 truncate">{s.route}</span>
              <span
                className="text-[10px] font-mono font-bold tabular-nums px-2 py-0.5 rounded-md flex-shrink-0"
                style={{
                  color: s.accent,
                  backgroundColor: `${s.accent}15`,
                  border: `1px solid ${s.accent}30`,
                }}
              >
                {s.dt}
              </span>
            </div>
          ))}
        </div>
        <span className="text-[9.5px] text-muted/50 italic mt-2">
          Typical land-acquisition + clearance timeline.
        </span>
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://rrecl.com/" label="RRECL — Rajasthan" accent="#a5b4fc" />
          <ViewSource href="https://kredl.kar.nic.in/" label="KREDL — Karnataka" accent="#a5b4fc" />
          <ViewSource href="https://mnre.gov.in/state-policies" label="All State Policies" accent="#a5b4fc" />
        </div>
      </InfoCard>

      <SourceLinks sources={SOURCES} delay={600} />
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────
const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

function ViewSource({ href, label, accent = '#ff8a1f' }: { href: string; label: string; accent?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity"
      style={{ color: accent }}
    >
      {label}
      <ExternalLinkIcon />
    </a>
  );
}

// Reusable inner-card item for the "Acquisition routes" section.
function RouteItem({
  color, heading, body,
}: { color: string; heading: string; body: string }) {
  return (
    <div className="bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3 hover:border-orange/40 transition-colors flex gap-3">
      <span
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}55` }}
      />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[12px] font-bold" style={{ color }}>{heading}</span>
        <span className="text-[11.5px] text-text/80 leading-relaxed">{body}</span>
      </div>
    </div>
  );
}

const MapIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3z M9 3v15 M15 6v15" />
  </svg>
);
const RouteIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="5" r="3" />
    <path d="M6 16V8a4 4 0 0 1 4-4h4M18 8v8a4 4 0 0 1-4 4h-4" />
  </svg>
);
const TreeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22V12 M9 14l-3-3 3-3M15 14l3-3-3-3M12 4a4 4 0 0 0-4 4 4 4 0 0 0 0 8h8a4 4 0 0 0 0-8 4 4 0 0 0-4-4z" />
  </svg>
);
const BirdIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 7h.01M3 19c0-3 5-7 9-7 6 0 8-4 8-7-1 2-3 3-5 3M3 19l3-1 4-3M3 19h6 M16 13l3 6" />
  </svg>
);
const GridIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);
