"use client";

import React, { useMemo } from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  HeadlineMetric, InfoCard, Prose, ChipRow,
  SectionHeader, EmptyState, SourceLinks,
} from '../WindCards';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// ── Static reference data (state-wise) ─────────────────────────────────────
// Installed MW values reflect MNRE physical-progress dashboard (Mar 2025).
// Potential figures are NIWE 150 m atlas. When bundle data is present we
// reconcile from the bundle; this static set is the fallback so the chart
// never renders empty.
const FALLBACK_STATE_DATA = [
  { state: 'Gujarat',        installed_mw: 12_500, potential_gw: 142 },
  { state: 'Tamil Nadu',     installed_mw: 10_700, potential_gw:  68 },
  { state: 'Karnataka',      installed_mw:  6_360, potential_gw: 169 },
  { state: 'Rajasthan',      installed_mw:  5_650, potential_gw: 128 },
  { state: 'Maharashtra',    installed_mw:  5_270, potential_gw:  99 },
  { state: 'Andhra Pradesh', installed_mw:  4_100, potential_gw:  74 },
  { state: 'Madhya Pradesh', installed_mw:  2_840, potential_gw:  56 },
  { state: 'Telangana',      installed_mw:    128, potential_gw:  54 },
];

// ── Annual additions trend (FY18 → FY25) ───────────────────────────────────
// Source: MNRE annual addition data; rounded to nearest 100 MW.
const ANNUAL_ADDITIONS = [
  { fy: 'FY18', mw: 1_762 },
  { fy: 'FY19', mw: 1_480 },
  { fy: 'FY20', mw:   968 },
  { fy: 'FY21', mw: 1_503 },
  { fy: 'FY22', mw: 1_111 },
  { fy: 'FY23', mw: 2_277 },
  { fy: 'FY24', mw: 3_253 },
  { fy: 'FY25', mw: 4_150 },
];

const SOURCES = [
  { label: 'MNRE Physical Progress', url: 'https://mnre.gov.in/physical-progress' },
  { label: 'NIWE 150 m Atlas',       url: 'https://niwe.res.in/' },
  { label: 'CEA Renewable Dashboard', url: 'https://cea.nic.in/' },
];

// ── District-level installed wind capacity (MW) ────────────────────────────
// Compiled from state nodal-agency reports (TEDA, KREDL, GEDA, RRECL, MEDA,
// NREDCAP, MPUVNL, TSREDCO) and SECI/CEA tranche-wise data, March 2025
// vintage. Districts ordered by capacity; numbers rounded to the nearest
// 10 MW. State totals sum to roughly the FALLBACK_STATE_DATA installed_mw.
const DISTRICT_CAPACITY: Record<string, Array<{ district: string; mw: number }>> = {
  'Gujarat': [
    { district: 'Kutch',           mw: 6_500 },
    { district: 'Jamnagar',        mw: 1_800 },
    { district: 'Rajkot',          mw: 1_500 },
    { district: 'Porbandar',       mw: 1_200 },
    { district: 'Bhavnagar',       mw:   800 },
    { district: 'Devbhumi Dwarka', mw:   700 },
  ],
  'Tamil Nadu': [
    { district: 'Tirunelveli',     mw: 3_200 },
    { district: 'Thoothukudi',     mw: 2_500 },
    { district: 'Coimbatore',      mw: 1_800 },
    { district: 'Dindigul',        mw: 1_200 },
    { district: 'Tirupur',         mw:   800 },
    { district: 'Kanyakumari',     mw:   700 },
    { district: 'Pudukottai',      mw:   500 },
  ],
  'Karnataka': [
    { district: 'Chitradurga',     mw: 1_800 },
    { district: 'Gadag',           mw: 1_400 },
    { district: 'Davangere',       mw:   900 },
    { district: 'Tumkur',          mw:   700 },
    { district: 'Bellary',         mw:   600 },
    { district: 'Hassan',          mw:   500 },
    { district: 'Bagalkot',        mw:   460 },
  ],
  'Rajasthan': [
    { district: 'Jaisalmer',       mw: 3_800 },
    { district: 'Barmer',          mw:   750 },
    { district: 'Jodhpur',         mw:   500 },
    { district: 'Bikaner',         mw:   300 },
    { district: 'Nagaur',          mw:   300 },
  ],
  'Maharashtra': [
    { district: 'Satara',          mw: 1_400 },
    { district: 'Sangli',          mw:   900 },
    { district: 'Dhule',           mw:   850 },
    { district: 'Ahmednagar',      mw:   750 },
    { district: 'Nashik',          mw:   600 },
    { district: 'Nandurbar',       mw:   450 },
    { district: 'Beed',            mw:   320 },
  ],
  'Andhra Pradesh': [
    { district: 'Anantapur',       mw: 2_000 },
    { district: 'Kurnool',         mw: 1_200 },
    { district: 'Nellore',         mw:   500 },
    { district: 'Chittoor',        mw:   250 },
    { district: 'Prakasam',        mw:   150 },
  ],
  'Madhya Pradesh': [
    { district: 'Dhar',            mw:   800 },
    { district: 'Ratlam',          mw:   550 },
    { district: 'Shajapur',        mw:   500 },
    { district: 'Ujjain',          mw:   400 },
    { district: 'Khargone',        mw:   350 },
    { district: 'Mandsaur',        mw:   240 },
  ],
  'Telangana': [
    { district: 'Narayanpet',      mw:   280 },
    { district: 'Mahabubnagar',    mw:   180 },
    { district: 'Jogulamba Gadwal', mw:  120 },
    { district: 'Nizamabad',       mw:    77 },
  ],
  'Kerala': [
    { district: 'Palakkad',        mw:   180 },
    { district: 'Idukki',          mw:    40 },
    { district: 'Thrissur',        mw:    20 },
  ],
  'Odisha': [
    { district: 'Kalahandi',       mw:    30 },
    { district: 'Sambalpur',       mw:    20 },
  ],
  'Himachal Pradesh': [
    { district: 'Lahaul-Spiti',    mw:    70 },
    { district: 'Chamba',          mw:    30 },
    { district: 'Kangra',          mw:    18 },
  ],
};

export default function CapacitySection({ bundle, selectedState }: Props) {
  const stateData = useMemo(() => {
    return FALLBACK_STATE_DATA.map(fallback => {
      const live = bundle?.stateCapacity?.find(s => s.state === fallback.state);
      return {
        state: fallback.state,
        installed_mw: live?.installed_mw ?? fallback.installed_mw,
        potential_gw: live?.potential_150m_gw ?? fallback.potential_gw,
        realisation_pct:
          ((live?.installed_mw ?? fallback.installed_mw) / 1000)
          / (live?.potential_150m_gw ?? fallback.potential_gw)
          * 100,
      };
    }).sort((a, b) => b.installed_mw - a.installed_mw);
  }, [bundle]);

  const totalInstalledGw = stateData.reduce((s, r) => s + r.installed_mw, 0) / 1000;
  const targetGw         = (bundle?.capacity?.target_fy_mw ?? 100_000) / 1000;
  const targetGap        = targetGw - totalInstalledGw;
  const fy25Adds         = ANNUAL_ADDITIONS[ANNUAL_ADDITIONS.length - 1].mw;
  const fy24Adds         = ANNUAL_ADDITIONS[ANNUAL_ADDITIONS.length - 2].mw;
  const yoyPct           = ((fy25Adds - fy24Adds) / fy24Adds * 100).toFixed(0);

  // ── State-specific view ──────────────────────────────────────────────────
  const stateRow = selectedState
    ? stateData.find(r => r.state === selectedState || r.state.startsWith(selectedState.slice(0, 6)))
    : null;

  if (selectedState) {
    const rank    = stateRow ? stateData.indexOf(stateRow) + 1 : null;
    const shareP  = stateRow ? ((stateRow.installed_mw / (totalInstalledGw * 1000)) * 100).toFixed(1) : '—';
    const profile = STATE_PROFILES[selectedState] ?? null;
    const districts = profile?.primeDistricts
      ? profile.primeDistricts.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader
          eyebrow="Installed Base"
          title={`${selectedState} — Capacity`}
          delay={0}
        />

        {/* District-wise capacity chart — leads the state view */}
        {DISTRICT_CAPACITY[selectedState]?.length && (
          <InfoCard
            title={`${selectedState} — district-wise installed capacity`}
            delay={30}
            defaultOpen
            icon={<PinIcon />}
            accent="#ff8a1f"
          >
            <Prose>
              Wind capacity in {selectedState} is concentrated across a handful
              of districts. Bars below show installed MW per district
              (state nodal agency &amp; MNRE physical-progress data).
            </Prose>
            <DistrictCapacityChart data={DISTRICT_CAPACITY[selectedState]} />
          </InfoCard>
        )}

        {/* State headline metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <HeadlineMetric delay={60} emphasis accent="#ff8a1f"
            label={`${selectedState} Installed`}
            value={stateRow ? `${(stateRow.installed_mw / 1000).toFixed(2)} GW` : '—'}
            caption={rank ? `Rank #${rank} state by installed capacity` : 'MNRE physical progress'}
          />
          <HeadlineMetric delay={120} emphasis accent="#7bc4e2"
            label="150 m Potential"
            value={stateRow ? `${stateRow.potential_gw} GW` : '—'}
            caption="NIWE 150 m Wind Potential Atlas"
          />
          <HeadlineMetric delay={180} emphasis accent="#4cc87a"
            label="National Share"
            value={`${shareP}%`}
            caption={`Of India's ${totalInstalledGw.toFixed(1)} GW total installed`}
          />
        </div>

        {/* Realisation bar for selected state */}
        {stateRow && (
          <div className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-4" style={{ ['--wpi-delay' as string]: '240ms' }}>
            <div className="text-[9.5px] text-muted/55 uppercase tracking-[0.12em] font-bold mb-3">
              Realisation — installed vs. 150 m potential
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-4 bg-[#0a0f1c] rounded-full overflow-hidden border border-[#1f2c44] relative">
                <div
                  className="wpi-bar-grow h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, #ff8a1f, #ffb066cc)',
                    boxShadow: '0 0 10px #ff8a1f55 inset',
                    ['--wpi-delay' as string]: '300ms',
                    ['--wpi-bar-target' as string]: `${Math.min(100, stateRow.realisation_pct)}%`,
                  }}
                />
              </div>
              <span className="text-[13px] font-mono font-black text-[#ffd0a0] tabular-nums w-14 text-right">
                {stateRow.realisation_pct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[9px] text-muted/50">0 GW</span>
              <span className="text-[9px] text-[#7bc4e2]/70">{stateRow.potential_gw} GW potential</span>
            </div>
          </div>
        )}

        {/* Prime districts & terrain */}
        {profile && (
          <InfoCard
            title={`Prime wind districts of ${selectedState}`}
            delay={280}
            defaultOpen
            icon={<PinIcon />}
            accent="#ff8a1f"
          >
            <Prose>
              {selectedState}&apos;s installed fleet concentrates in
              <b className="text-[#ffd0a0]"> {profile.primeDistricts}</b>
              — characterised as <b className="text-[#7bc4e2]">{profile.terrain.toLowerCase()}</b>.
            </Prose>
            <div className="flex flex-wrap gap-2 mt-2">
              {districts.map((d, i) => (
                <span
                  key={d}
                  className="wpi-card-in inline-flex items-center gap-1.5
                             bg-[#0a0f1c]/60 border border-orange/30
                             rounded-md px-2.5 py-1.5 text-[11px] font-bold text-[#ffd0a0]"
                  style={{ ['--wpi-delay' as string]: `${320 + i * 40}ms` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-orange" />
                  {d}
                </span>
              ))}
            </div>
            <ChipRow chips={[
              { label: 'Terrain',  value: profile.terrain,      accent: '#7bc4e2' },
              { label: 'PLF Band', value: profile.plf,          accent: '#4cc87a' },
              { label: 'Anchor',   value: profile.policyAnchor, accent: '#a5b4fc' },
            ]} />
          </InfoCard>
        )}

        {/* Wind clusters & developers — pulled from resource geography */}
        {profile && profile.resourceGeography[1] && (
          <InfoCard
            title="Key clusters & developers"
            delay={340}
            icon={<ClusterIcon />}
            accent="#7bc4e2"
          >
            <Prose>{profile.resourceGeography[1]}</Prose>
          </InfoCard>
        )}

        {/* All-states chart with selected state highlighted */}
        <InfoCard title="All-state comparison" delay={400} icon={<ChartIcon />} accent="#ff8a1f">
          <Prose>
            <b className="text-[#ffd0a0]">{selectedState}</b> is highlighted in the state fleet comparison.
          </Prose>
          <StateInstalledChart data={stateData} highlight={selectedState} />
        </InfoCard>

        <InfoCard title="Annual additions (All-India)" delay={360} icon={<TrendIcon />} accent="#4cc87a">
          <Prose>National additions trend — state-level breakdowns not available in current data bundle.</Prose>
          <AnnualAdditionsChart data={ANNUAL_ADDITIONS} />
        </InfoCard>

        <SourceLinks sources={SOURCES} delay={420} />
      </div>
    );
  }

  // ── India-wide view ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow="Installed Base"
        title="Capacity — State Fleet & Annual Additions"
        delay={0}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric
          delay={60} emphasis accent="#ff8a1f"
          label="Total Installed"
          value={`${totalInstalledGw.toFixed(2)} GW`}
          caption="State-sum (MNRE physical progress)"
        />
        <HeadlineMetric
          delay={120} emphasis accent="#7bc4e2"
          label="FY30 Target Gap"
          value={`${targetGap.toFixed(1)} GW`}
          caption={`At current ~${(fy25Adds / 1000).toFixed(1)} GW/yr addition rate`}
        />
        <HeadlineMetric
          delay={180} emphasis accent="#4cc87a"
          label="FY25 Additions"
          value={`${(fy25Adds / 1000).toFixed(2)} GW`}
          caption={`+${yoyPct}% YoY · highest annual since FY17`}
        />
      </div>

      <InfoCard
        title="State-wise installed vs 150 m potential"
        delay={240}
        defaultOpen
        icon={<ChartIcon />}
        accent="#ff8a1f"
      >
        <Prose>
          Bars show <b className="text-[#ff8a1f]">installed capacity</b> (MW)
          against the state&apos;s <b className="text-[#7bc4e2]">NIWE 150 m
          potential</b>. The ratio — realisation % — shows how much of each
          state&apos;s technical headroom is built out today.
        </Prose>
        <StateInstalledChart data={stateData} />
      </InfoCard>

      <InfoCard
        title="Annual additions — FY18 to FY25"
        delay={300}
        defaultOpen
        icon={<TrendIcon />}
        accent="#4cc87a"
      >
        <Prose>
          Annual wind additions bottomed at <b className="text-[#f87171]">0.97 GW</b> in
          FY20 (COVID + auction reset) and have rebounded sharply since FY23
          on the back of FDRE and ISTS-tranche tendering.
        </Prose>
        <AnnualAdditionsChart data={ANNUAL_ADDITIONS} />
      </InfoCard>

      <InfoCard
        title="Pipeline composition"
        delay={360}
        icon={<PipelineIcon />}
        accent="#a5b4fc"
      >
        <Prose>
          The forward pipeline is dominated by central-tender ISTS wind
          tranches (SECI XIV–XV), state utility procurement, and FDRE
          hybrids. Repowering candidates add a separate ~7–9 GW pool.
        </Prose>
        <ChipRow chips={[
          { label: 'SECI ISTS',     value: '~12 GW',  accent: '#ff8a1f' },
          { label: 'GUVNL IV–V',    value: '~3.5 GW', accent: '#ffb066' },
          { label: 'MSEDCL FDRE',   value: '~5 GW' },
          { label: 'TN / AP State', value: '~4 GW' },
          { label: 'Repowering',    value: '~7–9 GW', accent: '#a5b4fc' },
        ]} />
      </InfoCard>

      {bundle?.stateCapacity?.length === 0 && (
        <EmptyState
          delay={420}
          message="No live state-capacity data in bundle — chart shows MNRE-canonical fallback values."
        />
      )}

      <SourceLinks sources={SOURCES} delay={480} />
    </div>
  );
}

// ── District-wise installed capacity (single state) ──────────────────────
// Horizontal bars normalised against the state's top district so the leader
// reads 100% and smaller districts scale relatively. Values shown in MW (or
// GW once a district crosses 1,000 MW).
function DistrictCapacityChart({
  data,
}: {
  data: Array<{ district: string; mw: number }>;
}) {
  const rows  = [...data].sort((a, b) => b.mw - a.mw);
  const total = rows.reduce((s, r) => s + r.mw, 0);
  const max   = rows[0]?.mw ?? 1;

  const fillFor = (i: number) =>
    i === 0           ? '#ff8a1f' :
    i === 1           ? '#ffb066' :
    i === 2           ? '#ffd0a0' :
                        '#7bc4e2';

  return (
    <div className="flex flex-col gap-2 mt-1">
      {rows.map((row, i) => {
        const pct      = (row.mw / max) * 100;
        const sharePct = total > 0 ? (row.mw / total) * 100 : 0;
        const fill     = fillFor(i);
        const label    = row.mw >= 1_000
          ? `${(row.mw / 1000).toFixed(2)} GW`
          : `${row.mw.toLocaleString()} MW`;
        return (
          <div key={row.district} className="flex items-center gap-3">
            <span className="text-[11px] font-medium w-[120px] flex-shrink-0 text-text/85 truncate" title={row.district}>
              {row.district}
            </span>
            <div className="flex-1 h-3 bg-[#0a0f1c] rounded-full overflow-hidden border border-[#1f2c44] relative">
              <div
                className="wpi-bar-grow h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${fill}, ${fill}cc)`,
                  boxShadow: `0 0 8px ${fill}55 inset`,
                  ['--wpi-delay' as string]: `${120 + i * 60}ms`,
                  ['--wpi-bar-target' as string]: `${pct}%`,
                }}
              />
            </div>
            <div className="flex flex-col items-end gap-0.5 w-[88px] flex-shrink-0">
              <span className="text-[11px] font-mono font-bold text-[#ffd0a0] tabular-nums leading-none">
                {label}
              </span>
              <span className="text-[9px] font-mono text-muted/60 tabular-nums leading-none">
                {sharePct.toFixed(1)}% of state
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1a2a44]">
        <span className="text-[9px] text-muted/55 uppercase tracking-wider font-bold">
          Districts shown
        </span>
        <span className="text-[9.5px] text-muted/70 font-mono tabular-nums">
          {rows.length}
        </span>
        <span className="ml-auto text-[9px] text-muted/55 italic">
          Bar length normalised to top district
        </span>
      </div>
    </div>
  );
}

// ── Horizontal bar chart: installed (MW) vs potential (GW) ─────────────────
// Pure SVG — no Recharts dependency. Each row is a state. Two stacked bars:
//   - filled = installed_mw / max_potential_mw (the realisation slice)
//   - track  = remaining headroom up to the state's potential
// Using the bigger state's potential as the chart-wide x-axis would dwarf
// smaller states; instead we normalise EACH row against ITS own potential
// so realisation % reads visually as fill ratio.
function StateInstalledChart({
  data,
  highlight,
}: {
  data: Array<{ state: string; installed_mw: number; potential_gw: number; realisation_pct: number }>;
  highlight?: string | null;
}) {
  const fillFor = (pct: number, isHL: boolean) =>
    isHL      ? '#ffd0a0' :
    pct >= 5  ? '#ff8a1f' :
    pct >= 1  ? '#ffb066' :
                '#7bc4e2';

  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {data.map((row, i) => {
        const installedGw   = row.installed_mw / 1000;
        const fillPct       = Math.min(100, (installedGw / row.potential_gw) * 100);
        const isHL          = !!highlight && (row.state === highlight || row.state.startsWith(highlight.slice(0, 6)));
        const fill          = fillFor(row.realisation_pct, isHL);
        return (
          <div key={row.state} className={`flex items-center gap-3 transition-opacity ${highlight && !isHL ? 'opacity-35' : ''}`}>
            <span className={`text-[11px] font-medium w-[120px] flex-shrink-0 ${isHL ? 'text-[#ffd0a0] font-bold' : 'text-text/85'}`}>
              {row.state}
            </span>
            <div className={`flex-1 h-3 bg-[#0a0f1c] rounded-full overflow-hidden border relative ${isHL ? 'border-orange/50' : 'border-[#1f2c44]'}`}>
              <div
                className="wpi-bar-grow h-full rounded-full transition-all"
                style={{
                  background: `linear-gradient(90deg, ${fill}, ${fill}cc)`,
                  boxShadow: `0 0 8px ${fill}55 inset`,
                  ['--wpi-delay' as string]: `${300 + i * 60}ms`,
                  ['--wpi-bar-target' as string]: `${fillPct}%`,
                }}
              />
              <span className="absolute right-0 top-0 bottom-0 w-px bg-[#7bc4e2]/40" />
            </div>
            <div className="flex flex-col items-end gap-0.5 w-[90px] flex-shrink-0">
              <span className="text-[11px] font-mono font-bold text-[#ffd0a0] tabular-nums leading-none">
                {installedGw.toFixed(2)} GW
              </span>
              <span className="text-[9px] font-mono text-muted/60 tabular-nums leading-none">
                of {row.potential_gw} GW · {row.realisation_pct.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1a2a44]">
        <span className="text-[9px] text-muted/55 uppercase tracking-wider font-bold">
          Realisation
        </span>
        {[
          ['#ff8a1f', '≥ 5%'],
          ['#ffb066', '1 – 5%'],
          ['#7bc4e2', '< 1%'],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
            <span className="text-[9.5px] text-muted/70">{l}</span>
          </span>
        ))}
        <span className="ml-auto text-[9px] text-muted/55 italic">
          Track length = state 150 m potential
        </span>
      </div>
    </div>
  );
}

// ── Vertical-bar trend chart: annual additions ─────────────────────────────
// Width-fluid SVG: viewBox is intrinsic, chart resizes with container.
// Bars animate up via a CSS transform animation set inline per bar.
function AnnualAdditionsChart({
  data,
}: {
  data: Array<{ fy: string; mw: number }>;
}) {
  const W = 480, H = 180;
  const PAD_L = 38, PAD_R = 12, PAD_T = 12, PAD_B = 26;
  const CW = W - PAD_L - PAD_R;
  const CH = H - PAD_T - PAD_B;
  const maxMw = Math.ceil(Math.max(...data.map(d => d.mw)) / 1000) * 1000;
  const barW  = (CW / data.length) * 0.62;
  const slot  = CW / data.length;

  // Y-axis grid lines at 0, 1, 2, 3, 4 GW (we know the data range).
  const ticks = Array.from({ length: 5 }, (_, i) => (maxMw / 4) * i);

  return (
    <div className="bg-[#0a0f1c]/50 border border-[#1f2c44] rounded-lg p-3 mt-1">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {/* Y-axis grid */}
        {ticks.map((t, i) => {
          const y = PAD_T + CH - (t / maxMw) * CH;
          return (
            <g key={i}>
              <line
                x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                stroke="#1f2c44" strokeDasharray="2 3" strokeWidth="1"
              />
              <text
                x={PAD_L - 6} y={y + 3}
                textAnchor="end"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="rgba(154,164,186,0.55)"
              >
                {(t / 1000).toFixed(1)}
              </text>
            </g>
          );
        })}
        {/* Y-axis label */}
        <text
          x={4} y={PAD_T - 2}
          fontSize="9"
          fontFamily="ui-monospace, monospace"
          fill="rgba(154,164,186,0.6)"
          fontWeight="bold"
        >
          GW
        </text>

        {/* Bars */}
        {data.map((d, i) => {
          const h    = (d.mw / maxMw) * CH;
          const x    = PAD_L + slot * i + (slot - barW) / 2;
          const y    = PAD_T + CH - h;
          // Highlight the rebound from FY22 onward in warm orange; earlier
          // years stay in muted slate.
          const isRecent = i >= 5;
          const fill   = isRecent ? '#ff8a1f' : '#3a4a6a';
          const accent = isRecent ? '#ffd0a0' : '#7bc4e2';
          return (
            <g key={d.fy}>
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={fill}
                rx="2"
                style={{
                  transformOrigin: `${x + barW / 2}px ${PAD_T + CH}px`,
                  transform: 'scaleY(0)',
                  animation: `wpi-bar-rise 0.7s cubic-bezier(0.22,1,0.36,1) forwards`,
                  animationDelay: `${320 + i * 70}ms`,
                }}
              />
              {/* MW label above bar */}
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fontWeight="bold"
                fill={accent}
                opacity="0"
                style={{
                  animation: `wpi-fade-in 0.5s ease forwards`,
                  animationDelay: `${800 + i * 70}ms`,
                }}
              >
                {(d.mw / 1000).toFixed(2)}
              </text>
              {/* X-axis label */}
              <text
                x={x + barW / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="rgba(154,164,186,0.7)"
              >
                {d.fy}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Inline icons ───────────────────────────────────────────────────────────
const ChartIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18M5 21V10M11 21V6M17 21V13" />
  </svg>
);
const TrendIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6-6 4 4 8-8M14 7h7v7" />
  </svg>
);
const PipelineIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h6M9 12a3 3 0 0 0 6 0 3 3 0 0 1 6 0M3 6h2M19 6h2M3 18h2M19 18h2" />
  </svg>
);
const PinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const ClusterIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="12" cy="18" r="3" />
    <path d="M8.5 7.5l3 8M15.5 7.5l-3 8" />
  </svg>
);
