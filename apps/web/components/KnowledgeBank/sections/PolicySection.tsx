"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import { InfoCard, SectionHeader, SourceLinks } from '../WindCards';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const SOURCES = [
  { label: 'MNRE Policies', url: 'https://mnre.gov.in/policies' },
  { label: 'MoP Notifications', url: 'https://powermin.gov.in/' },
  { label: 'CERC Orders', url: 'https://cercind.gov.in/' },
  { label: 'PIB Press Releases', url: 'https://pib.gov.in/' },
];

// ── Curated link directory ─────────────────────────────────────────────────
// Grouped by issuing body. Each link gets a year tag so users can see what
// is current vs. legacy at a glance.
interface PolicyLink { year: string; label: string; url: string }
interface PolicyGroup { issuer: string; accent: string; site: string; links: PolicyLink[] }

const POLICY_LINKS_BY_ISSUER: PolicyGroup[] = [
  {
    issuer: 'Ministry of New & Renewable Energy (MNRE)',
    accent: '#ff8a1f',
    site:   'https://mnre.gov.in/',
    links: [
      { year: '2022',      label: 'Draft National Repowering & Life-Extension Policy for Wind Projects', url: 'https://mnre.gov.in/wind-energy/' },
      { year: '2018',      label: 'National Wind-Solar Hybrid Policy',                                   url: 'https://mnre.gov.in/hybrid-energy/' },
      { year: '2015/2024', label: 'National Offshore Wind Energy Policy',                                url: 'https://mnre.gov.in/offshore-wind-energy/' },
      { year: 'Ongoing',   label: 'MNRE Wind Schemes & Guidelines index',                                url: 'https://mnre.gov.in/wind-energy/' },
      { year: 'Ongoing',   label: 'MNRE Physical Progress dashboards',                                   url: 'https://mnre.gov.in/physical-progress/' },
    ],
  },
  {
    issuer: 'Ministry of Power (MoP)',
    accent: '#4cc87a',
    site:   'https://powermin.gov.in/',
    links: [
      { year: '2022',    label: 'Green Energy Open Access Rules (amended 2023, 2025)',                       url: 'https://powermin.gov.in/en/content/green-energy-open-access-rules-2022' },
      { year: 'Ongoing', label: 'Waiver of ISTS charges for RE generation — notifications',                  url: 'https://powermin.gov.in/en/content/inter-state-transmission-charges-and-losses' },
    ],
  },
  {
    issuer: 'Central Electricity Regulatory Commission (CERC)',
    accent: '#ffb066',
    site:   'https://cercind.gov.in/',
    links: [
      { year: 'Ongoing', label: 'CERC Terms & Conditions for Tariff Regulations (RE)',                       url: 'https://cercind.gov.in/Regulations/regulations.html' },
      { year: 'Ongoing', label: 'Generic tariff orders for wind (CERC RE Tariff Regulations)',               url: 'https://cercind.gov.in/Regulations/regulations.html' },
    ],
  },
  {
    issuer: 'Solar Energy Corporation of India (SECI)',
    accent: '#7bc4e2',
    site:   'https://seci.co.in/',
    links: [
      { year: 'Ongoing', label: 'SECI ISTS Wind & FDRE / Hybrid tender notices',                             url: 'https://seci.co.in/show-tenders' },
      { year: '2024',    label: 'SECI 500 MW Offshore Wind RfS (Gulf of Kutch / Dhanushkodi)',               url: 'https://seci.co.in/show-tenders' },
    ],
  },
  {
    issuer: 'Central Electricity Authority (CEA)',
    accent: '#a5b4fc',
    site:   'https://cea.nic.in/',
    links: [
      { year: 'Ongoing', label: 'National Electricity Plan — Volume II (Transmission)',                      url: 'https://cea.nic.in/national-electricity-plan/' },
      { year: 'Ongoing', label: 'CEA Transmission GIS (substation & line atlas)',                            url: 'https://cea.nic.in/transmission-projects/' },
    ],
  },
];

// ── State-specific policy stacks ─────────────────────────────────────────
// Each state shows ONLY its own wind / RE policies, nodal-agency portal,
// and state SERC. Central / MNRE / SECI / CERC stack is intentionally
// hidden in state view per product spec.
const STATE_POLICY_LINKS: Record<string, PolicyGroup[]> = {
  'Andhra Pradesh': [
    {
      issuer: 'Andhra Pradesh — State Wind Policy',
      accent: '#ff8a1f',
      site:   'https://www.nredcap.in/',
      links: [
        { year: '2018',    label: 'AP Wind Power Policy 2018', url: 'https://www.nredcap.in/Policies.aspx' },
        { year: '2020',    label: 'AP Renewable Energy Export Policy', url: 'https://www.nredcap.in/Policies.aspx' },
        { year: 'Ongoing', label: 'NREDCAP — RE single-window portal', url: 'https://www.nredcap.in/' },
        { year: 'Ongoing', label: 'APERC — Tariff & open-access orders', url: 'https://aperc.gov.in/' },
      ],
    },
  ],
  'Gujarat': [
    {
      issuer: 'Gujarat — State Wind Policy',
      accent: '#ff8a1f',
      site:   'https://geda.gujarat.gov.in/',
      links: [
        { year: '2016', label: 'Gujarat Wind Power Policy 2016',                  url: 'https://geda.gujarat.gov.in/policies.php' },
        { year: '2018', label: 'Gujarat Wind-Solar Hybrid Power Policy 2018',     url: 'https://geda.gujarat.gov.in/policies.php' },
        { year: '2023', label: 'Gujarat Renewable Energy Policy 2023',            url: 'https://geda.gujarat.gov.in/policies.php' },
        { year: 'Ongoing', label: 'GEDA — Clearances & developer portal',         url: 'https://geda.gujarat.gov.in/' },
        { year: 'Ongoing', label: 'GERC — Wind tariff & GUVNL procurement orders', url: 'https://gercin.org/' },
      ],
    },
  ],
  'Himachal Pradesh': [
    {
      issuer: 'Himachal Pradesh — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://himurja.hp.gov.in/',
      links: [
        { year: '2021',    label: 'HP Renewable Energy Policy 2021 (1 GW wind target by 2027)', url: 'https://himurja.hp.gov.in/' },
        { year: 'Ongoing', label: 'HIMURJA — RE nodal agency portal', url: 'https://himurja.hp.gov.in/' },
        { year: 'Ongoing', label: 'HPERC — Tariff & open-access orders', url: 'https://hperc.org/' },
      ],
    },
  ],
  'Karnataka': [
    {
      issuer: 'Karnataka — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://kredl.karnataka.gov.in/',
      links: [
        { year: '2022–2027', label: 'Karnataka Renewable Energy Policy 2022–27 (10 GW wind target)', url: 'https://kredl.karnataka.gov.in/info-2/Policies/en' },
        { year: '2023',      label: 'KERC Banking & Wheeling Charges Order (Wind / Solar)',          url: 'https://www.karnataka.gov.in/kerc/english' },
        { year: 'Ongoing',   label: 'KREDL — Allotments & PPA portal',                               url: 'https://kredl.karnataka.gov.in/' },
        { year: 'Ongoing',   label: 'KERC — Wind tariff & banking orders',                           url: 'https://www.karnataka.gov.in/kerc/english' },
      ],
    },
  ],
  'Kerala': [
    {
      issuer: 'Kerala — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://anert.gov.in/',
      links: [
        { year: '2002 / 2023', label: 'Kerala State Energy Policy (RE & wind chapter)',             url: 'https://anert.gov.in/' },
        { year: 'Ongoing',     label: 'ANERT — Small Wind / Solar-Wind Hybrid Scheme',              url: 'https://anert.gov.in/' },
        { year: 'Ongoing',     label: 'KSERC — Generic wind tariff & open-access orders',           url: 'https://erckerala.org/' },
        { year: 'Ongoing',     label: 'KSEBL — APPC notifications for wind purchase',               url: 'https://www.kseb.in/' },
      ],
    },
  ],
  'Madhya Pradesh': [
    {
      issuer: 'Madhya Pradesh — State Wind Policy',
      accent: '#ff8a1f',
      site:   'https://mprenewable.nic.in/',
      links: [
        { year: '2012 / 2024', label: 'MP Wind Energy Policy 2012 (with 2024 amendments)',          url: 'https://mprenewable.nic.in/' },
        { year: '2022',        label: 'MP Renewable Energy Policy 2022',                            url: 'https://mprenewable.nic.in/' },
        { year: 'Ongoing',     label: 'MPUVNL — RE nodal agency & single-window portal',            url: 'https://mprenewable.nic.in/' },
        { year: 'Ongoing',     label: 'MPERC — Wind tariff & MPPMCL procurement orders',            url: 'https://www.mperc.in/' },
      ],
    },
  ],
  'Maharashtra': [
    {
      issuer: 'Maharashtra — State Wind Policy',
      accent: '#ff8a1f',
      site:   'https://www.mahaurja.com/',
      links: [
        { year: '2020',    label: 'Maharashtra Unconventional Energy Generation Policy 2020',       url: 'https://www.mahaurja.com/' },
        { year: '2024',    label: 'Maharashtra RE Policy 2024 (FDRE & Wind-BESS focus)',            url: 'https://www.mahaurja.com/' },
        { year: 'Ongoing', label: 'MEDA — Allotments & EIA portal',                                 url: 'https://www.mahaurja.com/' },
        { year: 'Ongoing', label: 'MERC — Tariff & open-access orders',                             url: 'https://merc.gov.in/' },
      ],
    },
  ],
  'Odisha': [
    {
      issuer: 'Odisha — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://www.oredaodisha.com/',
      links: [
        { year: '2022',    label: 'Odisha Renewable Energy Policy 2022',                            url: 'https://www.oredaodisha.com/' },
        { year: 'Ongoing', label: 'OREDA — RE nodal agency portal',                                 url: 'https://www.oredaodisha.com/' },
        { year: 'Ongoing', label: 'OERC — Tariff & open-access orders',                             url: 'https://www.oerc.gov.in/' },
      ],
    },
  ],
  'Rajasthan': [
    {
      issuer: 'Rajasthan — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://energy.rajasthan.gov.in/rrec',
      links: [
        { year: '2019',    label: 'Rajasthan Wind & Hybrid Energy Policy 2019',                     url: 'https://energy.rajasthan.gov.in/rrec' },
        { year: '2023',    label: 'Rajasthan Renewable Energy Policy 2023 (single-window, 50 GW target)', url: 'https://energy.rajasthan.gov.in/rrec' },
        { year: 'Ongoing', label: 'RRECL — Allotments & RPO portal',                                url: 'https://energy.rajasthan.gov.in/rrec' },
        { year: 'Ongoing', label: 'RERC — Wind tariff & banking orders',                            url: 'https://rerc.rajasthan.gov.in/' },
      ],
    },
  ],
  'Tamil Nadu': [
    {
      issuer: 'Tamil Nadu — State Wind Policy',
      accent: '#ff8a1f',
      site:   'https://teda.in/',
      links: [
        { year: '2020',    label: 'TN Wind Energy Policy 2020',                                     url: 'https://teda.in/' },
        { year: '2023',    label: 'TN Repowering Policy for Wind Energy Projects 2023',             url: 'https://teda.in/' },
        { year: 'Ongoing', label: 'TEDA — Clearances & allotments portal',                          url: 'https://teda.in/' },
        { year: 'Ongoing', label: 'TNERC — Wind tariff, banking & open-access orders',              url: 'https://www.tnerc.gov.in/' },
      ],
    },
  ],
  'Telangana': [
    {
      issuer: 'Telangana — State RE Policy',
      accent: '#ff8a1f',
      site:   'https://tsredco.telangana.gov.in/',
      links: [
        { year: '2025',    label: 'Telangana Clean & Green Energy Policy 2025 (TGECA-2025)',         url: 'https://tsredco.telangana.gov.in/' },
        { year: 'Ongoing', label: 'TSREDCO — RE nodal agency portal',                                url: 'https://tsredco.telangana.gov.in/' },
        { year: 'Ongoing', label: 'TSERC — Tariff & open-access orders',                             url: 'https://tserc.gov.in/' },
      ],
    },
  ],
};

// ── State-view link categorisation ───────────────────────────────────────
type LinkKind = 'policy' | 'agency' | 'regulator';
const KIND_META: Record<LinkKind, { label: string; accent: string; icon: React.ReactNode }> = {
  policy:    { label: 'POLICY',    accent: '#ff8a1f', icon: <DocIcon /> },
  agency:    { label: 'AGENCY',    accent: '#4cc87a', icon: <BuildingIcon /> },
  regulator: { label: 'REGULATOR', accent: '#a5b4fc', icon: <GavelIcon /> },
};
function classifyLink(url: string): LinkKind {
  const u = url.toLowerCase();
  if (/(nredcap|geda|kredl|teda|rrecl|mahaurja|mprenewable|tsredco|anert|himurja|oredaodisha|kseb\.in)/.test(u)) return 'agency';
  if (/(aperc|gercin|erckerala|mperc|merc\.gov|oerc\.gov|rerc\.rajasthan|tnerc|tserc|karnataka.*kerc|hperc)/.test(u)) return 'regulator';
  return 'policy';
}

export default function PolicySection({ bundle: _bundle, selectedState }: Props) {
  // ── India view (unchanged) ───────────────────────────────────────────
  if (!selectedState) {
    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader
          eyebrow="Central Government"
          title="Policy — Central Stack"
          delay={0}
        />

        <InfoCard
          title="Official policy & regulatory links"
          delay={30}
          defaultOpen
          icon={<DocIcon />}
          accent="#ffd0a0"
        >
          <div className="flex flex-col gap-4">
            {POLICY_LINKS_BY_ISSUER.map(group => (
              <div key={group.issuer} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span
                    className="text-[11.5px] font-black uppercase tracking-[0.08em]"
                    style={{ color: group.accent }}
                  >
                    {group.issuer}
                  </span>
                  <a
                    href={group.site}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70 hover:text-orange transition-colors"
                  >
                    open site
                    <ExternalLinkIcon />
                  </a>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {group.links.map(link => (
                    <li key={link.label}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-md px-3 py-2 hover:border-orange/40 hover:bg-[#0a0f1c]/85 transition-colors"
                      >
                        <span
                          className="text-[9.5px] font-mono font-bold uppercase tracking-wider w-[78px] flex-shrink-0"
                          style={{ color: group.accent }}
                        >
                          {link.year}
                        </span>
                        <span className="text-[11.5px] text-text/85 font-medium flex-1 leading-snug">
                          {link.label}
                        </span>
                        <span className="text-muted/55 flex-shrink-0">
                          <ExternalLinkIcon />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </InfoCard>

        <SourceLinks sources={SOURCES} delay={90} />
      </div>
    );
  }

  // ── State view (redesigned) ──────────────────────────────────────────
  const groups: PolicyGroup[] = STATE_POLICY_LINKS[selectedState] ?? [];
  const profile = STATE_PROFILES[selectedState] ?? null;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader
          eyebrow={`${selectedState} · State Policy`}
          title={`Policy — ${selectedState}`}
          delay={0}
        />
        <div className="wpi-card-in rounded-xl border border-dashed border-[#1f2c44] bg-[#0a0f1c]/60 p-4 text-[11.5px] text-muted/70">
          State-specific wind / RE policy stack for <b>{selectedState}</b> is
          not yet curated. Refer to the state nodal agency / SERC portal.
        </div>
      </div>
    );
  }

  // Flatten + classify all links from the (single) state group.
  type ClassifiedLink = PolicyLink & { kind: LinkKind };
  const allLinks: ClassifiedLink[] = groups.flatMap(g =>
    g.links.map(l => ({ ...l, kind: classifyLink(l.url) })),
  );
  const byKind: Record<LinkKind, ClassifiedLink[]> = {
    policy:    allLinks.filter(l => l.kind === 'policy'),
    agency:    allLinks.filter(l => l.kind === 'agency'),
    regulator: allLinks.filter(l => l.kind === 'regulator'),
  };
  const stateGroup = groups[0]!;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={`${selectedState} · State Policy`}
        title={`Policy — ${selectedState}`}
        delay={0}
      />

      {/* Hero card — state policy anchor + counts */}
      <div
        className="wpi-card-in relative overflow-hidden rounded-2xl border border-[#1f2c44]
                   bg-gradient-to-br from-[#1a1228] via-[#0f1424] to-[#0a0f1c] p-5"
        style={{ ['--wpi-delay' as string]: '60ms' }}
      >
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full
                     bg-orange/10 blur-3xl"
        />
        <div className="relative flex items-start gap-3">
          <div
            className="flex-shrink-0 grid place-items-center h-10 w-10 rounded-lg
                       bg-orange/12 border border-orange/25 text-orange"
          >
            <DocIcon />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-orange/85">
              {selectedState} · State Policy Stack
            </div>
            <h3 className="mt-1 text-[15px] font-black text-[#ffd0a0] leading-tight">
              {stateGroup.issuer}
            </h3>
            {profile?.policyAnchor && (
              <p className="mt-2 text-[12px] leading-relaxed text-text/80">
                <span className="text-muted/65 font-bold">Policy anchor: </span>
                {profile.policyAnchor}
              </p>
            )}
          </div>
        </div>

        {/* Mini counter strip */}
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <CounterChip kind="policy"    count={byKind.policy.length} />
          <CounterChip kind="agency"    count={byKind.agency.length} />
          <CounterChip kind="regulator" count={byKind.regulator.length} />
        </div>
      </div>

      {/* Per-kind clusters of richer link cards */}
      {(['policy', 'agency', 'regulator'] as const).map((kind, ki) => {
        const links = byKind[kind];
        if (links.length === 0) return null;
        const meta = KIND_META[kind];
        return (
          <div
            key={kind}
            className="wpi-card-in"
            style={{ ['--wpi-delay' as string]: `${120 + ki * 80}ms` }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
              <span
                className="text-[9.5px] uppercase tracking-[0.16em] font-bold"
                style={{ color: meta.accent }}
              >
                {meta.label} · {links.length}
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {links.map((link, i) => (
                <PolicyLinkCard
                  key={link.label}
                  link={link}
                  delay={i * 40}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Open nodal agency site at the bottom */}
      <a
        href={stateGroup.site}
        target="_blank"
        rel="noopener noreferrer"
        className="wpi-card-in self-start inline-flex items-center gap-1.5
                   text-[10.5px] font-bold uppercase tracking-[0.12em]
                   text-muted/70 hover:text-orange transition-colors pt-1"
        style={{ ['--wpi-delay' as string]: '420ms' }}
      >
        Open {selectedState} nodal portal
        <ExternalLinkIcon />
      </a>
    </div>
  );
}

// ── Small counter chip used in the state hero card ───────────────────────
function CounterChip({ kind, count }: { kind: LinkKind; count: number }) {
  const meta = KIND_META[kind];
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5
                 bg-[#0a0f1c]/70 border"
      style={{
        borderColor: `${meta.accent}33`,
        backgroundColor: `${meta.accent}0c`,
      }}
    >
      <span style={{ color: meta.accent }}>{meta.icon}</span>
      <span className="flex flex-col leading-none gap-0.5">
        <span
          className="text-[14px] font-mono font-black tabular-nums leading-none"
          style={{ color: meta.accent }}
        >
          {count}
        </span>
        <span className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted/65">
          {meta.label}
        </span>
      </span>
    </div>
  );
}

// ── Single state-policy link card ────────────────────────────────────────
function PolicyLinkCard({
  link, delay,
}: { link: PolicyLink & { kind: LinkKind }; delay: number }) {
  const meta = KIND_META[link.kind];
  const isOngoing = /ongoing/i.test(link.year);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group wpi-card-in relative flex items-start gap-3 rounded-xl
                 border border-[#1f2c44] bg-[#0a0f1c]/70 p-3
                 hover:bg-[#0f1424] hover:-translate-y-px
                 transition-all duration-200"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full opacity-70
                   group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: meta.accent }}
      />
      <div className="flex-shrink-0 grid place-items-center h-8 w-8 rounded-md"
        style={{
          backgroundColor: `${meta.accent}14`,
          color: meta.accent,
          border: `1px solid ${meta.accent}33`,
        }}
      >
        {meta.icon}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.14em] self-start
                     px-1.5 py-0.5 rounded"
          style={{
            color: isOngoing ? '#9aa4ba' : meta.accent,
            backgroundColor: isOngoing ? '#1f2c4444' : `${meta.accent}15`,
            border: `1px solid ${isOngoing ? '#1f2c44aa' : `${meta.accent}33`}`,
          }}
        >
          {link.year}
        </span>
        <span className="text-[12px] font-bold text-text/95 leading-snug">
          {link.label}
        </span>
      </div>
      <span className="flex-shrink-0 text-muted/55 group-hover:text-text/85 transition-colors mt-1">
        <ExternalLinkIcon />
      </span>
    </a>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
    </svg>
  );
}
function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2" />
    </svg>
  );
}
function GavelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4l6 6M9 9l6 6M3 21l6-6M11 5l4-1 5 5-1 4z" />
    </svg>
  );
}
