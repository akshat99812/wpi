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
const Globe   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/></svg>;
const Cloud   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13a4 4 0 0 1 4-4 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 18 17H7a4 4 0 0 1-2-7.5"/></svg>;
const Factory = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V10l5 3V10l5 3V8l8 5v8z"/></svg>;
const Anchor  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="2"/><path d="M12 8v13M5 17a7 7 0 0 0 14 0M8 11h8"/></svg>;
const Refresh = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 0 1 14-5.3L21 9M21 4v5h-5M20 12a8 8 0 0 1-14 5.3L3 15M3 20v-5h5"/></svg>;
const GridIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>;
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

    return (
      <div className="flex flex-col gap-3.5">
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

        {/* Grid & transmission */}
        <InfoCard title="Grid & transmission" delay={300} icon={<GridIcon />} accent="#a5b4fc">
          <Prose>{profile.gridTransmission}</Prose>
        </InfoCard>

        {/* Near-term outlook */}
        <InfoCard title="Near-term outlook" delay={360} icon={<TrendUp />} accent="#4cc87a">
          <Prose>{profile.nearTermOutlook}</Prose>
        </InfoCard>

        <SourceLinks sources={profile.sources} delay={420} />
        <ProTeaser delay={480} />
      </div>
    );
  }

  // ── India-wide view ──────────────────────────────────────────────────────
  const installedMw  = bundle?.capacity?.installed_mw ?? 49_601;
  const installedGw  = (installedMw / 1000).toFixed(2);
  const potentialGw  = 1163.86;
  const realisation  = ((installedMw / 1000) / potentialGw * 100).toFixed(2);
  const maxStateGw   = Math.max(...STATE_POTENTIAL_150M.map(s => s.gw));

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader eyebrow="India Overview" title="India — National Wind Snapshot" delay={0} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric delay={60} emphasis accent="#ff8a1f"
          label="Installed (All-India)"
          value={`${installedGw} GW`}
          caption="State-sum MNRE (31 Mar 2025; AP 30 Jun 2025; MP Apr 2025)"
        />
        <HeadlineMetric delay={120} emphasis accent="#7bc4e2"
          label="Onshore 150 m Potential"
          value={`${potentialGw.toLocaleString()} GW`}
          caption="NIWE 150 m Wind Potential Atlas"
        />
        <HeadlineMetric delay={180} emphasis accent="#4cc87a"
          label="Realisation"
          value={`${realisation}%`}
          caption="Installed ÷ 150 m potential · computed live"
        />
      </div>

      <div
        className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-3.5"
        style={{ ['--wpi-delay' as string]: '240ms' }}
      >
        <span className="text-[9.5px] text-muted/55 uppercase tracking-[0.12em] font-bold">At a glance</span>
        <ChipRow chips={[
          { label: 'Hub Height',  value: '120–150 m' },
          { label: 'FY30 Target', value: '~100 GW' },
          { label: 'Top States',  value: 'GJ · TN · KA · RJ · MH', accent: '#ff8a1f' },
          { label: 'Offshore',    value: 'Kutch · Dhanushkodi',      accent: '#7bc4e2' },
          { label: 'Fleet OEMs',  value: '5 (Suzlon · Envision · Vestas · SGRE · Inox)' },
        ]} />
      </div>

      <InfoCard title="Wind-resource geography" delay={300} defaultOpen icon={<Globe />} accent="#ff8a1f">
        <Prose>
          India&apos;s onshore wind resource concentrates in the Thar arid belt
          (Jaisalmer–Barmer), the Kutch–Saurashtra coast, the Chitradurga–Gadag
          plateau, the rain-shadow Anantapur–Kurnool belt, the Palghat-gap
          funnel, the leeward Western Ghats of Maharashtra, the Malwa plateau
          ridges, and Odisha–Telangana pockets.
        </Prose>
        <Prose>
          NIWE&apos;s 2021 atlas revised the national onshore resource upward
          from ~302 GW at 100 m to <b className="text-[#ffd0a0]">1,163.86 GW at 150 m</b> —
          a ~5× jump driven by taller towers, higher wind shear, and smoothed
          seasonal profiles at hub height.
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
          Generation is monsoon-driven. The south-west monsoon (Jun–Sep)
          produces the strongest, most consistent flows across peninsular
          sites; Tamil Nadu and Karnataka routinely see CUFs of 40–55%
          during monsoon months, falling to 10–20% in winter. Rajasthan
          and Gujarat are less monsoon-dependent and sustain generation
          through pre-monsoon summer via thermal-low circulation.
        </Prose>
        <ChipRow chips={[
          { label: 'A-grade PLF', value: '28 – 38%', accent: '#4cc87a' },
          { label: 'Tier-2 PLF',  value: '22 – 28%' },
          { label: 'Monsoon CUF', value: '40 – 55%', accent: '#7bc4e2' },
          { label: 'Winter CUF',  value: '10 – 20%', accent: '#f87171' },
        ]} />
      </InfoCard>

      <InfoCard title="Sector profile — fleet, pipeline, OEMs" delay={420} icon={<Factory />} accent="#ffb066">
        <Prose>
          India closed FY25 at roughly <b className="text-[#ffd0a0]">50 GW installed</b>.
          Annual additions of 4–5 GW are now the norm, supported by SECI ISTS
          wind tranches (XIV, XV), GUVNL Phase IV–V, MSEDCL FDRE rounds, and
          state procurement by Tamil Nadu &amp; Andhra Pradesh.
        </Prose>
        <Prose>
          Five OEMs account for the bulk of the WTG fleet — Suzlon, Envision,
          Vestas, Siemens Gamesa, Inox Wind. New manufacturing lines are pushing
          annual nameplate output toward 8–10 GW/yr.
        </Prose>
        <ChipRow chips={[
          { label: 'New WTG Class', value: '3.x – 4.x MW' },
          { label: 'Hub',           value: '150 m+' },
          { label: 'Rotor',         value: '150 – 170 m' },
          { label: 'Annual Adds',   value: '4 – 5 GW',     accent: '#4cc87a' },
          { label: 'Mfg Capacity',  value: '8 – 10 GW/yr' },
        ]} />
      </InfoCard>

      <InfoCard title="Offshore outlook" delay={480} icon={<Anchor />} accent="#7bc4e2">
        <Prose>
          The offshore programme concentrates in two zones — the Gulf of
          Kutch (Gujarat) and Dhanushkodi / Gulf of Mannar (Tamil Nadu).
          SECI floated a <b className="text-[#ffd0a0]">500 MW offshore RfS</b> for
          Gulf of Kutch (Nov 2024) with Cabinet-backed VGF support.
          PGCIL is evaluating HVAC/HVDC transmission for both landing zones.
        </Prose>
      </InfoCard>

      <InfoCard title="Repowering & life extension" delay={540} icon={<Refresh />} accent="#a5b4fc">
        <Prose>
          Roughly <b className="text-[#ffd0a0]">7–9 GW</b> of the legacy
          500–1000 kW fleet (installed pre-2010) is a candidate for repowering.
          MNRE&apos;s draft National Repowering &amp; Life-Extension Policy (2022)
          provides the framework; Tamil Nadu eased TANGEDCO-connected norms in 2024.
        </Prose>
      </InfoCard>

      <SourceLinks sources={INDIA_SOURCES} delay={600} />
      <ProTeaser delay={660} />
    </div>
  );
}
