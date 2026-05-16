"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  HeadlineMetric, InfoCard, Prose, ChipRow,
  PotentialBar, ProTeaser, SourceLinks, SectionHeader, EmptyState,
} from '../WindCards';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// ── India-wide reference data ──────────────────────────────────────────────
const STATE_POTENTIAL_150M = [
  { state: 'Karnataka',   gw: 169.5 },
  { state: 'Gujarat',     gw: 142.6 },
  { state: 'Rajasthan',   gw: 127.8 },
  { state: 'Maharashtra', gw:  99.2 },
  { state: 'Andhra Pr.',  gw:  74.1 },
  { state: 'Tamil Nadu',  gw:  68.0 },
  { state: 'Madhya Pr.',  gw:  15.4 },
  { state: 'Telangana',   gw:   9.8 },
];

const INDIA_SOURCES = [
  { label: 'NIWE Wind Resource Assessment', url: 'https://niwe.res.in/' },
  { label: 'MNRE Wind — Current Status',    url: 'https://mnre.gov.in/wind' },
  { label: 'Global Wind Atlas (India)',     url: 'https://globalwindatlas.info/area/India' },
];

// ── Icons ──────────────────────────────────────────────────────────────────
const Globe    = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/></svg>;
const Cloud    = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13a4 4 0 0 1 4-4 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 18 17H7a4 4 0 0 1-2-7.5"/></svg>;
const Factory  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V10l5 3V10l5 3V8l8 5v8z"/></svg>;
const Anchor   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="2"/><path d="M12 8v13M5 17a7 7 0 0 0 14 0M8 11h8"/></svg>;
const Refresh  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 0 1 14-5.3L21 9M21 4v5h-5M20 12a8 8 0 0 1-14 5.3L3 15M3 20v-5h5"/></svg>;
const Scroll   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h10a2 2 0 0 1 2 2v3h-3M8 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3H8"/></svg>;
const TrendUp  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8M14 7h7v7"/></svg>;

export default function WindSection({ bundle, selectedState }: Props) {

  // ── State-specific view ──────────────────────────────────────────────────
  if (selectedState) {
    const profile = STATE_PROFILES[selectedState];

    if (!profile) {
      return (
        <EmptyState
          delay={0}
          message={`Detailed wind profile for ${selectedState} is not yet available.`}
        />
      );
    }

    // Pull the GWA source out of the profile's source list so we can
    // surface it as a prominent CTA at the top instead of burying it in
    // the bottom SourceLinks row.
    const gwaSource       = profile.sources.find(s => /globalwindatlas/i.test(s.url));
    const filteredSources = profile.sources.filter(s => !/globalwindatlas/i.test(s.url));

    return (
      <div className="flex flex-col gap-3.5">
        {/* Featured CTA — open this state on Global Wind Atlas */}
        {gwaSource && (
          <a
            href={gwaSource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group wpi-card-in relative overflow-hidden rounded-xl
                       border border-[#7bc4e2]/30 bg-gradient-to-r
                       from-[#7bc4e2]/12 via-[#7bc4e2]/5 to-transparent
                       p-3.5 flex items-center gap-3
                       hover:border-[#7bc4e2]/60 hover:from-[#7bc4e2]/20
                       hover:-translate-y-px transition-all duration-200"
            style={{ ['--wpi-delay' as string]: '0ms' }}
          >
            {/* Glow accent */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full
                         bg-[#7bc4e2]/20 blur-3xl
                         group-hover:bg-[#7bc4e2]/30 transition-colors"
            />

            {/* Icon medallion */}
            <span
              className="flex-shrink-0 grid place-items-center h-10 w-10 rounded-lg
                         bg-[#7bc4e2]/15 border border-[#7bc4e2]/35 text-[#7bc4e2]"
            >
              <Globe />
            </span>

            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#7bc4e2]/85">
                Wind Resource Atlas
              </span>
              <span className="text-[13px] font-bold text-text leading-snug">
                View {selectedState} on Global Wind Atlas
              </span>
              <span className="text-[10.5px] text-muted/70 leading-snug mt-0.5">
                Independent DTU / IFC wind resource layer · interactive map
              </span>
            </div>

            <span
              className="flex-shrink-0 inline-flex items-center gap-1.5
                         text-[10.5px] font-bold uppercase tracking-wider
                         text-[#7bc4e2] group-hover:text-[#aedaef]
                         transition-colors"
            >
              Open
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </span>
          </a>
        )}

        {/* Intro */}
        {profile.intro.split('\n\n').map((para, i) => (
          <Prose key={i}>{para}</Prose>
        ))}

        {/* Quick-fact chips */}
        <div
          className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-3.5"
          style={{ ['--wpi-delay' as string]: '80ms' }}
        >
          <ChipRow chips={[
            { label: 'PLF @150 m (typ.)', value: profile.plf,            accent: '#4cc87a' },
            { label: 'Prime districts',   value: profile.primeDistricts               },
            { label: 'Terrain',           value: profile.terrain                      },
            { label: 'Policy anchor',     value: profile.policyAnchor,  accent: '#ff8a1f' },
          ]} />
        </div>

        {/* Resource geography */}
        <InfoCard title="Resource geography" delay={120} defaultOpen icon={<Globe />} accent="#ff8a1f">
          {profile.resourceGeography.map((para, i) => (
            <Prose key={i}>{para}</Prose>
          ))}
        </InfoCard>

        {/* Wind regime */}
        <InfoCard title="Wind regime" delay={180} icon={<Cloud />} accent="#7bc4e2">
          <Prose>{profile.windRegime}</Prose>
        </InfoCard>

        {/* Sector profile */}
        <InfoCard title="Sector profile" delay={240} icon={<Factory />} accent="#ffb066">
          {profile.sectorProfile.map((para, i) => (
            <Prose key={i}>{para}</Prose>
          ))}
        </InfoCard>

        {/* Near-term outlook */}
        <InfoCard title="Near-term outlook" delay={360} icon={<TrendUp />} accent="#4cc87a">
          <Prose>{profile.nearTermOutlook}</Prose>
        </InfoCard>

        <SourceLinks sources={filteredSources} delay={420} />
        <ProTeaser delay={480} />
      </div>
    );
  }

  // ── India-wide view ──────────────────────────────────────────────────────
  // Default falls back to the latest MNRE physical-progress total
  // (56,437 MW, 30 Apr 2026 — first month of FY27) when the live bundle
  // is unavailable. FY26 close was 56,090 MW.
  const installedMw  = bundle?.capacity?.installed_mw ?? 56_437;
  const installedGw  = Math.round(installedMw / 1000).toString();
  const potentialGw  = 1163.9;
  const potentialGwDisplay = Math.round(potentialGw).toLocaleString();
  const realisation  = ((installedMw / 1000) / potentialGw * 100).toFixed(2);
  const maxStateGw   = Math.max(...STATE_POTENTIAL_150M.map(s => s.gw));

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader eyebrow="India Overview" title="India — National Wind Snapshot" delay={0} />

      {/* Opening intro */}
      <div
        className="wpi-card-in flex flex-col gap-2.5 bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-4"
        style={{ ['--wpi-delay' as string]: '30ms' }}
      >
        <Prose>
          India&apos;s onshore wind resource is concentrated in nine states
          along the southern peninsula, the western coast, the Thar desert,
          and the Malwa plateau. The south-west monsoon (Jun–Sep) drives
          the highest seasonal CUFs; coastal and Western Ghats-leeward
          belts see channelled flow.
        </Prose>
        <Prose>
          NIWE&apos;s <b className="text-[#ffd0a0]">150 m assessment (2021)</b>{' '}
          revised the national onshore wind potential upward to{' '}
          <b className="text-[#ffd0a0]">1,163.9 GW</b> — a ~5× increase over
          the earlier 100 m estimate.
        </Prose>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric delay={60} emphasis accent="#ff8a1f"
          label="Installed (All-India)"
          value={`${installedGw} GW`}
          caption="MNRE physical progress · 30 Apr 2026 · +6 GW added in FY26"
        />
        <HeadlineMetric delay={120} emphasis accent="#7bc4e2"
          label="Onshore 150 m Potential"
          value={`${potentialGwDisplay} GW`}
          caption="NIWE 150 m Wind Potential Atlas"
        />
        <HeadlineMetric delay={180} emphasis accent="#4cc87a"
          label="Realisation"
          value={`${realisation}%`}
          caption="Installed ÷ 150 m potential · computed live"
        />
      </div>

      <InfoCard title="Wind-resource geography" delay={300} defaultOpen icon={<Globe />} accent="#ff8a1f">
        <Prose>
          India&apos;s onshore wind resource is concentrated in a small set
          of wind-rich geographies: the <b className="text-[#ffd0a0]">Thar
          arid belt</b> of Rajasthan (Jaisalmer–Barmer), the{' '}
          <b className="text-[#ffd0a0]">Kutch–Saurashtra coast</b> of
          Gujarat, the <b className="text-[#ffd0a0]">Chitradurga–Gadag
          plateau</b> of Karnataka, the rain-shadow{' '}
          <b className="text-[#ffd0a0]">Anantapur–Kurnool belt</b> in Andhra
          Pradesh, the <b className="text-[#ffd0a0]">Palghat-gap funnel</b>{' '}
          between Kerala and Tamil Nadu, the{' '}
          <b className="text-[#ffd0a0]">leeward Western Ghats</b> of
          Maharashtra, the <b className="text-[#ffd0a0]">Malwa plateau
          ridges</b> in Madhya Pradesh, and the{' '}
          <b className="text-[#ffd0a0]">Odisha–Telangana pockets</b>.
        </Prose>
        <Prose>
          NIWE&apos;s 2021 150 m Wind Potential Atlas revised the national
          onshore resource upward from roughly{' '}
          <b className="text-[#ffd0a0]">302 GW at 100 m</b> to{' '}
          <b className="text-[#ffd0a0]">1,163.9 GW at 150 m</b> — a ~5×
          jump driven by taller towers, higher wind shear, and smoothed
          seasonal profiles at hub height. Gujarat (~142 GW), Rajasthan
          (~128 GW), Maharashtra (~99 GW) and Karnataka (~169 GW) lead
          the state-wise 150 m potential.
        </Prose>
        <div className="mt-1 flex flex-col gap-2">
          <span className="text-[9.5px] text-muted/60 uppercase tracking-wider font-bold">
            State 150 m potential (GW)
          </span>
          <div className="flex flex-col gap-2">
            {STATE_POTENTIAL_150M.map((s, i) => (
              <PotentialBar key={s.state} state={s.state} gw={s.gw} max={maxStateGw} delay={400 + i * 60} />
            ))}
          </div>
        </div>
      </InfoCard>

      <InfoCard title="Climatology & seasonal regime" delay={360} icon={<Cloud />} accent="#7bc4e2">
        <Prose>
          Generation is monsoon-driven. The south-west monsoon (June–September)
          produces the strongest and most consistent flows across peninsular
          sites; Tamil Nadu and Karnataka routinely see CUFs of{' '}
          <b className="text-[#ffd0a0]">40–55%</b> during monsoon months,
          falling to <b className="text-[#ffd0a0]">10–20%</b> in winter.
          Rajasthan and Gujarat are less monsoon-dependent and sustain
          generation through the pre-monsoon summer via thermal-low
          circulation over the Thar desert.
        </Prose>
        <Prose>
          Plant Load Factors at 150 m hub height typically span{' '}
          <b className="text-[#ffd0a0]">28–38%</b> for A-grade sites
          (Jaisalmer, Kutch, Muppandal, Chitradurga) and{' '}
          <b className="text-[#ffd0a0]">22–28%</b> for tier-2 sites (Malwa,
          Telangana, Kadapa).
        </Prose>
        <Prose>
          Seasonal variability is the single largest generation risk;{' '}
          <b className="text-[#ffd0a0]">Firm &amp; Dispatchable Renewable
          Energy (FDRE)</b> tenders issued since 2023 explicitly price this
          risk via hybrid + storage configurations.
        </Prose>
        <ChipRow chips={[
          { label: 'A-grade PLF', value: '28 – 38%', accent: '#4cc87a' },
          { label: 'Tier-2 PLF',  value: '22 – 28%' },
          { label: 'Monsoon CUF', value: '40 – 55%', accent: '#7bc4e2' },
          { label: 'Winter CUF',  value: '10 – 20%', accent: '#f87171' },
          { label: 'FDRE Since',  value: '2023',     accent: '#a5b4fc' },
        ]} />
      </InfoCard>

      <InfoCard title="Sector profile — installed base, pipeline, OEMs" delay={420} icon={<Factory />} accent="#ffb066">
        <Prose>
          India finished FY26 at{' '}
          <b className="text-[#ffd0a0]">56 GW</b> of installed wind capacity
          (MNRE physical-progress dashboard, 31 Mar 2026 close), with a{' '}
          <b className="text-[#4cc87a]">record 6 GW added in FY26</b> alone.
          The 4–6 GW/yr cadence — up from ~2 GW in 2022 — is now the norm,
          supported by SECI&apos;s ISTS wind tranches (Tranche XIV, XV),
          GUVNL Phase IV–V, MSEDCL FDRE rounds, and state-led procurement by
          Tamil Nadu and Andhra Pradesh.
        </Prose>
        <Prose>
          Five OEMs account for the bulk of India&apos;s WTG fleet:{' '}
          <b className="text-[#ffd0a0]">Suzlon, Envision, Vestas, Siemens
          Gamesa (SGRE), and Inox Wind</b>. New manufacturing lines — Inox&apos;s
          Karnataka plant and Suzlon&apos;s Daman/Pondicherry upgrades — are
          lifting annual nameplate output toward{' '}
          <b className="text-[#ffd0a0]">8–10 GW/year</b>.
        </Prose>
        <Prose>
          Turbine sizes at new sites are now{' '}
          <b className="text-[#ffd0a0]">3.x–4.x MW</b> with 150 m+ hubs and
          rotors of 150–170 m, a sharp jump from the 80 m/100 m legacy fleet.
          This is the main reason NIWE&apos;s 150 m atlas has translated
          into real-world project viability.
        </Prose>
        <ChipRow chips={[
          { label: 'FY26 Installed', value: '~56 GW',       accent: '#ff8a1f' },
          { label: 'FY26 Adds',      value: '6 GW · record', accent: '#4cc87a' },
          { label: '2022 Pace',      value: '~2 GW/yr' },
          { label: 'New WTG Class',  value: '3.x – 4.x MW' },
          { label: 'Hub',            value: '150 m+' },
          { label: 'Rotor',          value: '150 – 170 m' },
          { label: 'Mfg Capacity',   value: '8 – 10 GW/yr' },
          { label: 'Legacy Hub',     value: '80 / 100 m' },
        ]} />
      </InfoCard>

      <InfoCard title="Offshore outlook" delay={480} icon={<Anchor />} accent="#7bc4e2">
        <Prose>
          India&apos;s offshore programme is concentrated in two zones: the{' '}
          <b className="text-[#ffd0a0]">Gulf of Kutch</b> (Gujarat) and off{' '}
          <b className="text-[#ffd0a0]">Dhanushkodi / Gulf of Mannar</b>{' '}
          (Tamil Nadu). MNRE, NIWE and NIOT have run LiDAR campaigns at
          both sites; SECI floated a{' '}
          <b className="text-[#ffd0a0]">500 MW offshore RfS</b> for Gulf of
          Kutch (Nov 2024 onward) with viability-gap funding support from
          the Cabinet. A new tender round is under preparation for
          additional Gulf-of-Kutch blocks.
        </Prose>
        <Prose>
          Transmission to onshore points of connection is being coordinated
          by PGCIL — <b className="text-[#ffd0a0]">Khavda</b> landing in
          Gujarat and <b className="text-[#ffd0a0]">Kayathar</b> in Tamil
          Nadu — including undersea HVAC/HVDC feasibility studies.
        </Prose>
        <ChipRow chips={[
          { label: 'Zone 1',     value: 'Gulf of Kutch (GJ)',         accent: '#ff8a1f' },
          { label: 'Zone 2',     value: 'Dhanushkodi (TN)',            accent: '#ff8a1f' },
          { label: 'LiDAR by',   value: 'MNRE · NIWE · NIOT' },
          { label: 'First RfS',  value: '500 MW · Nov 2024',           accent: '#4cc87a' },
          { label: 'Support',    value: 'Cabinet VGF' },
          { label: 'Landing',    value: 'Khavda · Kayathar' },
          { label: 'Tx Studies', value: 'PGCIL HVAC/HVDC' },
        ]} />
      </InfoCard>

      <InfoCard title="Repowering & life extension" delay={540} icon={<Refresh />} accent="#a5b4fc">
        <Prose>
          Roughly <b className="text-[#ffd0a0]">7–9 GW</b> of India&apos;s
          legacy 500–1000 kW fleet (installed pre-2010) is a candidate for
          repowering — replacing older sub-MW turbines at high-CUF sites
          with <b className="text-[#ffd0a0]">3–4 MW class</b> machines.
          MNRE&apos;s draft National Repowering &amp; Life-Extension Policy
          (2022) provides the framework; Tamil Nadu tweaked its own wind
          policy in 2024 to ease repowering and life-extension norms at
          TANGEDCO-connected sites. Rajasthan, Maharashtra and Gujarat
          also have active repowering pipelines.
        </Prose>
        <Prose>
          The commercial challenge is that many legacy PPAs were signed at
          very low feed-in tariffs; repowering economics depend on{' '}
          <b className="text-[#ffd0a0]">open-access</b>,{' '}
          <b className="text-[#ffd0a0]">C&amp;I offtake</b> and CERC/SERC
          guidance on PPA renegotiation for the re-built capacity.
        </Prose>
        <ChipRow chips={[
          { label: 'Candidate Fleet', value: '7 – 9 GW',          accent: '#ff8a1f' },
          { label: 'Legacy Class',    value: '500 – 1000 kW' },
          { label: 'Replacement',     value: '3 – 4 MW',          accent: '#4cc87a' },
          { label: 'Policy Draft',    value: 'MNRE 2022' },
          { label: 'TN Update',       value: '2024 · TANGEDCO' },
          { label: 'Active States',   value: 'TN · RJ · MH · GJ' },
        ]} />
      </InfoCard>

      <InfoCard title="Policy & market levers" delay={600} icon={<Scroll />} accent="#ffd0a0">
        <Prose>
          The central policy stack includes <b className="text-[#ffd0a0]">MNRE&apos;s
          wind policy and guidelines</b>, the{' '}
          <b className="text-[#ffd0a0]">National Wind-Solar Hybrid Policy
          (2018)</b>, the <b className="text-[#ffd0a0]">National Offshore
          Wind Energy Policy (2015, updated 2024)</b>,{' '}
          <b className="text-[#ffd0a0]">MoP&apos;s Green Energy Open Access
          Rules (2022, amended 2023, 2025)</b>, CERC&apos;s RE tariff
          regulations and <b className="text-[#ffd0a0]">ISTS-waiver</b>{' '}
          notifications. State policies layer on banking, wheeling,
          captive / open-access terms and concessional stamp duty.
        </Prose>
        <Prose>
          Tender design is shifting from vanilla ISTS wind to{' '}
          <b className="text-[#ffd0a0]">FDRE</b> and{' '}
          <b className="text-[#ffd0a0]">hybrid</b> structures that bundle
          wind with solar and BESS — MSEDCL&apos;s 5 GW FDRE round and
          SECI&apos;s Tranche XII–XV set the benchmark tariff band at{' '}
          <b className="text-[#ffd0a0]">₹2.83 – ₹3.24 / kWh</b>.
        </Prose>
        <ChipRow chips={[
          { label: 'Hybrid Policy',     value: '2018',                  accent: '#7bc4e2' },
          { label: 'Offshore Policy',   value: '2015 · upd 2024',       accent: '#7bc4e2' },
          { label: 'GEOA Rules',        value: '2022 · 2023 · 2025' },
          { label: 'CERC',              value: 'RE Tariff · ISTS waiver' },
          { label: 'MSEDCL FDRE',       value: '5 GW',                  accent: '#4cc87a' },
          { label: 'SECI Tranches',     value: 'XII – XV' },
          { label: 'Benchmark Tariff',  value: '₹2.83 – 3.24 / kWh',    accent: '#ff8a1f' },
          { label: 'State Levers',      value: 'banking · wheeling · OA · stamp duty' },
        ]} />
      </InfoCard>

      <SourceLinks sources={INDIA_SOURCES} delay={660} />
      <ProTeaser delay={720} />
    </div>
  );
}
