"use client";

import React, { useMemo } from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  InfoCard, Prose, SectionHeader, SourceLinks, HeadlineMetric,
} from '../WindCards';
import {
  TURBINE_OEMS, ORIGIN_META, SUPPLY_CHAIN_AS_OF, OEM_WATCHLIST,
  type TurbineOem, type OemStatus,
} from '../data/turbineSupplyChain';
import {
  MFG_BRANCHES, MFG_TOTAL_CAPACITY_MW, MFG_TOTAL_BRANCHES,
  COMPONENT_META, MFG_CAPACITY_AS_OF, type MfgBranch,
} from '../data/mfgCapacity';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const SOURCES = [
  { label: 'MNRE ALMM / RLMM (Wind)', url: 'https://mnre.gov.in/en/wind-manufacturing/' },
  { label: 'NIWE — Type Certification', url: 'https://niwe.res.in/' },
];

const ALMM_PDF_URL =
  'https://mnre.gov.in/wp-content/uploads/2024/04/Revised-List-1-of-Models-and-Manufacturers-of-Wind-Turbines-RLMM.pdf';

const STATUS_COLOR: Record<OemStatus, string> = {
  Major: '#ff8a1f',
  Established: '#7bc4e2',
  Emerging: '#5ec26a',
  Exited: '#7a8699',
};

export default function TechnologySection({ bundle: _bundle }: Props) {
  const stats = useMemo(() => {
    const active = TURBINE_OEMS.filter((o) => o.status !== 'Exited');
    const originCounts: Record<string, number> = {};
    for (const o of active) originCounts[o.origin] = (originCounts[o.origin] ?? 0) + 1;
    const originRows = Object.entries(originCounts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
    const indiaHq = active.filter((o) => o.origin === 'India').length;
    const makesInIndia = active.filter(
      (o) => o.presence === 'Indigenous' || o.presence === 'Local manufacturing',
    ).length;
    const licensedForeign = active.filter((o) => o.techOrigin);
    return {
      active,
      originRows,
      maxCount: Math.max(1, ...originRows.map((r) => r.count)),
      indiaHq,
      foreignHq: active.length - indiaHq,
      makesInIndia,
      importers: active.length - makesInIndia,
      licensedForeign,
    };
  }, []);

  const mfg = useMemo(() => {
    const facilities = [...MFG_BRANCHES].sort(
      (a, b) => b.mfgCapacity - a.mfgCapacity,
    );
    const states = new Set(facilities.map((f) => f.state));
    const maxCapacity = Math.max(1, ...facilities.map((f) => f.mfgCapacity));
    // Capacity rolled up per component (a facility can list several).
    const byComponent: Record<string, number> = {};
    for (const f of facilities) {
      for (const c of f.componentMfg) {
        byComponent[c] = (byComponent[c] ?? 0) + f.mfgCapacity;
      }
    }
    const componentRows = Object.entries(byComponent)
      .map(([component, capacity]) => ({ component, capacity }))
      .sort((a, b) => b.capacity - a.capacity);
    return {
      facilities,
      stateCount: states.size,
      maxCapacity,
      componentRows,
    };
  }, []);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow="OEM & Technology"
        title="Turbine supply chain"
        delay={0}
      />

      <Prose>
        Wind-turbine makers <b className="text-[#ffd0a0]">currently offering products in India</b> and
        where they come from — by corporate HQ and, where it differs, the turbine
        design&apos;s country of origin. Sourced from MNRE RLMM/ALMM and company
        filings ({SUPPLY_CHAIN_AS_OF}).
      </Prose>

      {/* ── Manufacturing footprint ── */}
      <InfoCard
        title="Manufacturing footprint"
        delay={20}
        defaultOpen
        icon={<FactoryIcon />}
        accent="#5ec26a"
      >
        <Prose>
          Where India&apos;s turbine components are actually built — facility-level
          {' '}<b className="text-[#bdf0c8]">annual manufacturing capacity</b> by state and
          component, from MNRE ALMM / RLMM filings ({MFG_CAPACITY_AS_OF}).
        </Prose>

        <div className="grid grid-cols-3 gap-2.5 mt-1">
          <HeadlineMetric
            label="Total Capacity"
            value={`${MFG_TOTAL_CAPACITY_MW.toLocaleString('en-IN')} MW`}
            accent="#5ec26a"
            delay={40}
          />
          <HeadlineMetric label="Facilities" value={String(MFG_TOTAL_BRANCHES)} accent="#7bc4e2" delay={70} />
          <HeadlineMetric label="States / UTs" value={String(mfg.stateCount)} accent="#ff8a1f" delay={100} />
        </div>

        {/* Capacity by component */}
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted/55 mt-3.5 mb-1.5">
          Capacity by component (MW)
        </p>
        <div className="flex flex-col gap-2">
          {mfg.componentRows.map((r, i) => (
            <ComponentBar
              key={r.component}
              component={r.component}
              capacity={r.capacity}
              max={MFG_TOTAL_CAPACITY_MW}
              delay={i * 50}
            />
          ))}
        </div>

        {/* Facility list */}
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted/55 mt-4 mb-1.5">
          Facilities by capacity
        </p>
        <div className="flex flex-col gap-1.5">
          {mfg.facilities.map((f, i) => (
            <MfgFacilityRow
              key={`${f.state}-${f.district}-${f.componentMfg.join('')}`}
              branch={f}
              max={mfg.maxCapacity}
              delay={i * 30}
            />
          ))}
        </div>

        <p className="text-[10px] text-muted/55 leading-relaxed mt-3 pt-2.5 border-t border-[#1f2c44]">
          All {MFG_TOTAL_BRANCHES} facilities operated by <b className="text-[#bdf0c8]">Suzlon Energy Limited</b>,
          {' '}India&apos;s largest turbine OEM. Capacities are annual manufacturing
          capacity per facility in MW.
        </p>
      </InfoCard>

      <div className="grid grid-cols-3 gap-2.5">
        <HeadlineMetric label="Active OEMs" value={String(stats.active.length)} accent="#ff8a1f" delay={40} />
        <HeadlineMetric label="India-HQ" value={String(stats.indiaHq)} accent="#5ec26a" delay={70} />
        <HeadlineMetric label="Foreign-HQ" value={String(stats.foreignHq)} accent="#7bc4e2" delay={100} />
      </div>

      {/* ── Where the turbines come from ── */}
      <InfoCard
        title="Where the turbines come from"
        delay={130}
        defaultOpen
        icon={<GlobeIcon />}
        accent="#7bc4e2"
      >
        <Prose>
          OEMs active in India, by <b className="text-[#cfe7f4]">corporate HQ / parent nationality</b>.
        </Prose>
        <div className="flex flex-col gap-2 mt-1">
          {stats.originRows.map((r, i) => (
            <OriginBar
              key={r.country}
              country={r.country}
              count={r.count}
              max={stats.maxCount}
              delay={i * 50}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted/55 leading-relaxed mt-2.5">
          {stats.makesInIndia} of {stats.active.length} manufacture or assemble in India;
          {' '}{stats.importers} supply mainly by import.
        </p>
      </InfoCard>

      {/* ── Tech-lineage nuance ── */}
      <InfoCard
        title="Made in India ≠ designed in India"
        delay={170}
        icon={<ChipIcon />}
        accent="#b06be0"
      >
        <Prose>
          {stats.licensedForeign.length} of the active OEMs build on
          {' '}<b className="text-[#e3c8f5]">licensed foreign turbine designs</b> — so the
          corporate flag and the technology origin can differ. The clearest case:
          {' '}<b className="text-[#e3c8f5]">Venwind Refex</b> is an Indian company, but its
          turbine is licensed from Vensys (Germany), ~70% owned by China&apos;s Goldwind.
        </Prose>
        <div className="flex flex-col gap-1.5 mt-1">
          {stats.licensedForeign.map((o) => (
            <div
              key={o.name}
              className="flex items-center justify-between gap-2 bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-md px-2.5 py-1.5"
            >
              <span className="text-[11.5px] font-bold text-text/90">
                {ORIGIN_META[o.origin]?.flag} {o.name}
              </span>
              <span className="text-[10px] text-muted/70 font-mono">
                design&nbsp;→&nbsp;<span className="text-[#e3c8f5]">{o.techOrigin}</span>
              </span>
            </div>
          ))}
        </div>
      </InfoCard>

      {/* ── Manufacturer table ── */}
      <InfoCard
        title="Manufacturers & origin"
        delay={210}
        defaultOpen
        icon={<FactoryIcon />}
        accent="#ff8a1f"
      >
        <div className="flex flex-col">
          {TURBINE_OEMS.map((o, i) => (
            <OemRow key={o.name} oem={o} dim={o.status === 'Exited'} delay={i * 18} />
          ))}
        </div>
        <p className="text-[10px] text-muted/55 leading-relaxed mt-3 pt-2.5 border-t border-[#1f2c44]">
          {OEM_WATCHLIST}
        </p>
      </InfoCard>

      {/* ── MNRE ALMM (existing) ── */}
      <InfoCard
        title="MNRE ALMM (Wind) — official roster"
        delay={250}
        icon={<CertificateIcon />}
        accent="#ff8a1f"
      >
        <Prose>
          The <b className="text-[#ffd0a0]">MNRE Approved List of Models &amp; Manufacturers (ALMM)</b> is
          the authoritative list of approved wind-turbine models and OEMs eligible
          for deployment under India&apos;s central schemes — the source of record
          for the roster above.
        </Prose>
        <a
          href={ALMM_PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-1 self-start
                     bg-gradient-to-r from-orange/20 to-orange/5
                     hover:from-orange/30 hover:to-orange/10
                     border border-orange/40 hover:border-orange/60
                     rounded-lg px-3.5 py-2 transition-all"
        >
          <PdfIcon />
          <span className="text-[11.5px] font-bold text-[#ffd0a0]">
            Open MNRE ALMM (Wind) — PDF
          </span>
          <ExternalLinkIcon />
        </a>
      </InfoCard>

      <SourceLinks sources={SOURCES} delay={330} />
    </div>
  );
}

// ── Origin bar (animated) ───────────────────────────────────────────────────
function OriginBar({
  country, count, max, delay,
}: { country: string; count: number; max: number; delay: number }) {
  const meta = ORIGIN_META[country];
  const color = meta?.color ?? '#7a8699';
  const pct = Math.min(100, (count / max) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] text-muted/85 w-[112px] flex-shrink-0 truncate">
        {meta?.flag} {country}
      </span>
      <div className="flex-1 h-1.5 bg-[#0a0f1c] rounded-full overflow-hidden">
        <div
          className="wpi-bar-grow h-full rounded-full"
          style={{
            backgroundColor: color,
            ['--wpi-delay' as string]: `${delay}ms`,
            ['--wpi-bar-target' as string]: `${pct}%`,
          }}
        />
      </div>
      <span className="text-[11px] font-mono text-text/85 w-[22px] text-right tabular-nums">
        {count}
      </span>
    </div>
  );
}

// ── Component capacity bar (animated) ───────────────────────────────────────
function ComponentBar({
  component, capacity, max, delay,
}: { component: string; capacity: number; max: number; delay: number }) {
  const meta = COMPONENT_META[component];
  const color = meta?.color ?? '#7a8699';
  const pct = Math.min(100, (capacity / max) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] text-muted/85 w-[64px] flex-shrink-0 truncate">
        {meta?.label ?? component}
      </span>
      <div className="flex-1 h-1.5 bg-[#0a0f1c] rounded-full overflow-hidden">
        <div
          className="wpi-bar-grow h-full rounded-full"
          style={{
            backgroundColor: color,
            ['--wpi-delay' as string]: `${delay}ms`,
            ['--wpi-bar-target' as string]: `${pct}%`,
          }}
        />
      </div>
      <span className="text-[11px] font-mono text-text/85 w-[44px] text-right tabular-nums">
        {capacity.toFixed(2)}
      </span>
    </div>
  );
}

// ── Manufacturing facility row ──────────────────────────────────────────────
function MfgFacilityRow({
  branch, max, delay,
}: { branch: MfgBranch; max: number; delay: number }) {
  const pct = Math.min(100, (branch.mfgCapacity / max) * 100);
  return (
    <div
      className="wpi-card-in bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg px-3 py-2.5 flex flex-col gap-2"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
      title={branch.branchAddress.replace(/\r\n/g, ', ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[12px] font-bold text-text/90 truncate">
            {branch.state}
          </span>
          <span className="block text-[10px] text-muted/65 leading-snug mt-0.5">
            {branch.district}
          </span>
        </div>
        <span className="text-[12.5px] font-black font-mono tabular-nums text-[#bdf0c8] flex-shrink-0">
          {branch.mfgCapacity.toFixed(2)}
          <span className="text-[9px] text-muted/55 font-bold ml-0.5">MW</span>
        </span>
      </div>

      <div className="h-1.5 bg-[#0a0f1c] rounded-full overflow-hidden">
        <div
          className="wpi-bar-grow h-full rounded-full"
          style={{
            backgroundColor: COMPONENT_META[branch.componentMfg[0]]?.color ?? '#5ec26a',
            ['--wpi-delay' as string]: `${delay + 80}ms`,
            ['--wpi-bar-target' as string]: `${pct}%`,
          }}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {branch.componentMfg.map((c) => {
          const color = COMPONENT_META[c]?.color ?? '#7a8699';
          return (
            <span
              key={c}
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded-full"
              style={{
                color,
                backgroundColor: `${color}1f`,
                border: `1px solid ${color}55`,
              }}
            >
              {COMPONENT_META[c]?.label ?? c}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Manufacturer row ────────────────────────────────────────────────────────
function OemRow({ oem, dim, delay }: { oem: TurbineOem; dim: boolean; delay: number }) {
  const meta = ORIGIN_META[oem.origin];
  return (
    <a
      href={oem.source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={oem.note ?? oem.source.title}
      className={
        'group flex items-start gap-2.5 py-2 transition-colors hover:bg-white/[0.03] rounded-md px-1 ' +
        (dim ? 'opacity-55' : '')
      }
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <span className="text-[13px] leading-none mt-0.5 w-[18px] flex-shrink-0 text-center">
        {meta?.flag ?? '🏳️'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-bold text-text/90 group-hover:text-[#cfe7f4] transition-colors">
            {oem.name}
          </span>
          {oem.techOrigin && (
            <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 py-[1px] rounded
                             bg-[#b06be0]/15 text-[#d3a6f0] border border-[#b06be0]/30">
              tech: {oem.techOrigin}
            </span>
          )}
        </span>
        <span className="block text-[10.5px] text-muted/65 leading-snug mt-0.5">
          {oem.origin} · {oem.presence}{oem.models ? ` · ${oem.models}` : ''}
        </span>
      </span>
      <span
        className="text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded-full flex-shrink-0 mt-0.5"
        style={{
          color: STATUS_COLOR[oem.status],
          backgroundColor: `${STATUS_COLOR[oem.status]}1f`,
          border: `1px solid ${STATUS_COLOR[oem.status]}55`,
        }}
      >
        {oem.status}
      </span>
    </a>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────
const GlobeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
  </svg>
);
const ChipIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
  </svg>
);
const FactoryIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 20h20M4 20V10l5 3V10l5 3V10l5 3v7" />
  </svg>
);
const CertificateIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5" />
  </svg>
);
const PdfIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange flex-shrink-0">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
    <line x1="9" y1="18" x2="13" y2="18" />
  </svg>
);
const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted/55 flex-shrink-0">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
