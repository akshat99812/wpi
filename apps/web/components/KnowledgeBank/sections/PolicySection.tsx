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
    site:   'https://mnre.gov.in/en/',
    links: [
      { year: '2023',    label: 'National Repowering & Life-Extension Policy for Wind Power Projects (notified 7 Dec 2023)',  url: 'https://mnre.gov.in/en/wind-policy-and-guidelines/' },
      { year: '2022',    label: 'Draft Repowering Policy (Oct 2022) — full text (PRS India archive)',                           url: 'https://prsindia.org/files/parliamentry-announcement/2022-11-01/Draft%20National%20Repowering%20Policy%20for%20Wind%20Power%20Projects.pdf' },
      { year: '2018',    label: 'National Wind-Solar Hybrid Policy (14 May 2018, amended 13 Aug 2018)',                         url: 'https://mnre.gov.in/en/wind-policy-and-guidelines/' },
      { year: '2018',    label: 'National Wind-Solar Hybrid Policy — consolidated text (CBIP archive)',                          url: 'https://www.cbip.org/policies2019/PD_07_Dec_2018_Policies/1_MNRE/1-Wind%20Solar/3%20Consolidated%20Wind_Solar%20_Hybrid.pdf' },
      { year: '2015',    label: 'National Offshore Wind Energy Policy (6 Oct 2015) + Strategy 2023 / VGF Sept 2024',             url: 'https://mnre.gov.in/en/off-shore-wind/' },
      { year: 'Ongoing', label: 'MNRE Wind landing page (programmes, R&D, statistics)',                                          url: 'https://mnre.gov.in/en/wind/' },
      { year: 'Ongoing', label: 'MNRE Wind Schemes & Guidelines — document index',                                               url: 'https://mnre.gov.in/en/document-category/wind-schemes-guidelines/' },
      { year: '2023-24', label: 'Renewable Energy Statistics 2023-24 (PDF)',                                                     url: 'https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2024/10/20241029512325464.pdf' },
      { year: 'Ongoing', label: 'MNRE Documents library (monthly progress reports etc.)',                                        url: 'https://mnre.gov.in/en/documents/' },
    ],
  },
  {
    issuer: 'Ministry of Power (MoP)',
    accent: '#4cc87a',
    site:   'https://powermin.gov.in/',
    links: [
      { year: '2023',    label: 'Green Energy Open Access — Amendment Rules 2023',                                              url: 'https://powermin.gov.in/en/content/electricity-promoting-renewable-energy-through-green-energy-open-access-amendment-rules-2023' },
      { year: '2023',    label: 'Determination of Green Tariff under GEOA Rules 2022 (May 2023 implementation order, PDF)',     url: 'https://powermin.gov.in/sites/default/files/Determination_of_Green_Tariff_under_Electricity_Promoting_Renewable_Energy_Through_Green_Energy_Open_Access_Rules_2022_and_Implementation_of_the_Rules.pdf' },
      { year: 'Ongoing', label: 'Green Open Access — single-window registry (operational portal)',                              url: 'https://greenopenaccess.in/' },
      { year: 'Ongoing', label: 'ISTS charges & losses — CERC 4th Amendment Sharing Regulations (graded waiver through 2028)',  url: 'https://cercind.gov.in/Current_reg.html' },
      { year: '2025',    label: 'MoP order on ISTS waiver for Hydro PSP & co-located BESS (extension to Jun 2028) — MoP Documents', url: 'https://powermin.gov.in/' },
    ],
  },
  {
    issuer: 'Central Electricity Regulatory Commission (CERC)',
    accent: '#ffb066',
    site:   'https://cercind.gov.in/',
    links: [
      { year: 'Ongoing', label: 'CERC current regulations index (RE Tariff Regs, amendments, generic tariff orders)', url: 'https://cercind.gov.in/Current_reg.html' },
      { year: '2024',    label: 'Draft RE Tariff Regulations 2024 — Explanatory Memorandum (PDF)',                     url: 'https://cercind.gov.in/2024/draft_reg/RE-Tariff-Regulations-EM.pdf' },
      { year: 'Ongoing', label: 'CERC Regulations homepage',                                                            url: 'https://cercind.gov.in/' },
    ],
  },
  {
    issuer: 'Solar Energy Corporation of India (SECI)',
    accent: '#7bc4e2',
    site:   'https://www.seci.co.in/',
    links: [
      { year: 'Ongoing', label: 'SECI tenders — ISTS Wind, FDRE, Hybrid, Offshore',                                  url: 'https://www.seci.co.in/tenders' },
      { year: '2024',    label: 'SECI 500 MW Offshore Wind RfS — Gulf of Khambhat, Gujarat (issued 13 Sep 2024)',     url: 'https://www.seci.co.in/Upload/Tender/SECI000188-1526005-RfSfor500MWOffshoreWind-Gujarat-finalupload.pdf' },
      { year: '2024',    label: 'SECI 500 MW Offshore Wind — official announcement page',                             url: 'https://www.seci.co.in/whats-new-detail/2799' },
    ],
  },
  {
    issuer: 'Central Electricity Authority (CEA)',
    accent: '#a5b4fc',
    site:   'https://cea.nic.in/',
    links: [
      { year: '2024',    label: 'National Electricity Plan Vol-II (Transmission), 2022-32 — notified 23 Oct 2024',     url: 'https://cea.nic.in/power-system-planning-appraisal-ii-division/?lang=en' },
      { year: '2017-22', label: 'National Electricity Plan Vol-II (Transmission) — previous edition',                  url: 'https://cea.nic.in/psp___a_ii/national-electricity-plan-volume-ii-transmission/?lang=en' },
      { year: '2023',    label: 'Manual on Transmission Planning Criteria, 2023 (PDF)',                                url: 'https://cea.nic.in/wp-content/uploads/psp___a_ii/2023/03/Manual_on_Transmission_Planning_Criteria_2023.pdf' },
      { year: 'Ongoing', label: 'CTUIL — upcoming ISTS, RE-evacuation maps, CTU substation spare capacity',            url: 'https://ctuil.in/renewable-energy' },
      { year: 'Ongoing', label: 'India Transmission Portal (CEA / CTUIL ecosystem)',                                   url: 'https://www.indiatransmission.org/' },
      { year: 'Ongoing', label: 'Intra-state GIS spare capacity — state utility links curated by MNRE',                url: 'https://mnre.gov.in/?p=27649' },
    ],
  },
];

// ── State-specific policy stacks ─────────────────────────────────────────
// Sourced from windmap-india (11).html (user-supplied). URLs curl-tested;
// verified-broken paths swapped for stable agency landings via URL_FIX in
// the build-elevation-grid sibling generator (apps/web/scripts/...). HP
// kept curated since the source file had no policy_groups entry for it.
const STATE_POLICY_LINKS: Record<string, PolicyGroup[]> = {
  'Andhra Pradesh': [
    {
      issuer: 'NREDCAP — State Nodal Agency (since 1984)',
      accent: '#ff8a1f',
      site:   'https://nredcap.in/',
      links: [
        { year: '2020', label: 'Andhra Pradesh Renewable Energy Export Policy, 2020', url: 'https://nredcap.in/GuidelinesWindPowerProjects.aspx' },
        { year: 'Ongoing', label: 'NREDCAP Wind Power Guidelines', url: 'https://nredcap.in/GuidelinesWindPowerProjects.aspx' },
      ],
    },
    {
      issuer: 'Andhra Pradesh Electricity Regulatory Commission (APERC)',
      accent: '#a5b4fc',
      site:   'https://aperc.gov.in/',
      links: [
        { year: 'Ongoing', label: 'APERC tariff / open-access / banking orders for wind', url: 'https://aperc.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE & SECI — Central',
      accent: '#7bc4e2',
      site:   'https://www.seci.co.in/tenders',
      links: [
        { year: '2026', label: 'NTPC REL 900 MW wind tender (Anantapur)', url: 'https://www.mercomindia.com/ntpc-rel-floats-tender-for-540-mw-wind-project-in-andhra-pradesh' },
        { year: '2026', label: 'NTPC-IOC 215 MW wind tender (AP)', url: 'https://www.mercomindia.com/ntpc-indian-oil-jv-tenders-215-mw-wind-project-in-andhra-pradesh' },
      ],
    },
  ],
  'Gujarat': [
    {
      issuer: 'Gujarat Energy Development Agency (GEDA) — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://geda.gujarat.gov.in/',
      links: [
        { year: '2023', label: 'Gujarat Renewable Energy Policy, 2023 (valid till 30 Sep 2028)', url: 'https://geda.gujarat.gov.in/Gallery/Media_Gallery/Gujarat_Renewable_Energy_Policy-2023.pdf' },
        { year: '2025', label: 'Gujarat Integrated Renewable Energy Policy, 2025', url: 'https://guj-epd.gujarat.gov.in/Home/GujaratREPolicy' },
      ],
    },
    {
      issuer: 'Gujarat Electricity Regulatory Commission (GERC)',
      accent: '#a5b4fc',
      site:   'https://gercin.org/',
      links: [
        { year: '2024', label: 'GERC Order No. 1 of 2024 — Wind-Solar Hybrid tariff', url: 'https://gercin.org/wp-content/uploads/2024/02/Order-No.-1-of-2024-GERC-Wind-Solar-Hybrid-Order.pdf' },
        { year: 'Ongoing', label: 'Generic wind tariff / open-access orders', url: 'https://gercin.org/' },
      ],
    },
    {
      issuer: 'MNRE & SECI — Central',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2015/2024', label: 'National Offshore Wind Energy Policy (Gujarat is priority zone)', url: 'https://mnre.gov.in/en/wind-policy-and-guidelines/' },
        { year: '2024', label: '500 MW Offshore Wind Tender (off Gujarat)', url: 'https://www.seci.co.in/tenders' },
      ],
    },
  ],
  'Himachal Pradesh': [
    {
      issuer: 'Himachal Pradesh — State RE Policy & HIMURJA',
      accent: '#ff8a1f',
      site:   'https://himurja.hp.gov.in/',
      links: [
        { year: '2021',    label: 'HP Renewable Energy Policy 2021 (1 GW wind target by 2027)', url: 'https://himurja.hp.gov.in/' },
        { year: 'Ongoing', label: 'HIMURJA — RE nodal agency portal',                            url: 'https://himurja.hp.gov.in/' },
      ],
    },
    {
      issuer: 'Himachal Pradesh Electricity Regulatory Commission (HPERC)',
      accent: '#a5b4fc',
      site:   'https://hperc.org/',
      links: [
        { year: 'Ongoing', label: 'HPERC — Tariff & open-access orders', url: 'https://hperc.org/' },
      ],
    },
  ],
  'Karnataka': [
    {
      issuer: 'Karnataka Renewable Energy Development Ltd. (KREDL) — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://kredl.karnataka.gov.in/',
      links: [
        { year: '2022', label: 'Karnataka Renewable Energy Policy, 2022–2027', url: 'https://kredl.karnataka.gov.in/' },
        { year: 'Ongoing', label: 'Government Orders on Wind Power Projects', url: 'https://kredl.karnataka.gov.in/new-page/Government%20Orders%20of%20Wind%20Power%20Projects/en' },
        { year: 'Ongoing', label: 'KREDL Wind Section', url: 'https://kredl.karnataka.gov.in/new-page/Wind/en' },
      ],
    },
    {
      issuer: 'Karnataka Electricity Regulatory Commission (KERC)',
      accent: '#a5b4fc',
      site:   'https://kerc.karnataka.gov.in/',
      links: [
        { year: 'Ongoing', label: 'KERC generic wind tariff & open-access/banking orders', url: 'https://kerc.karnataka.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE — Central',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2022', label: 'Draft National Repowering Policy, 2022', url: 'https://mnre.gov.in/en/wind-schemes-guidelines/' },
      ],
    },
  ],
  'Kerala': [
    {
      issuer: 'ANERT — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://anert.gov.in/',
      links: [
        { year: '2022', label: 'Kerala Renewable Energy Policy, 2022', url: 'https://anert.gov.in/' },
      ],
    },
    {
      issuer: 'KSERC',
      accent: '#a5b4fc',
      site:   'https://erckerala.org/',
      links: [
        { year: 'Ongoing', label: 'KSERC tariff orders', url: 'https://erckerala.org/' },
      ],
    },
  ],
  'Madhya Pradesh': [
    {
      issuer: 'MP Urja Vikas Nigam Ltd. (MPUVNL) — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://www.mprenewable.nic.in/',
      links: [
        { year: '2025', label: 'Madhya Pradesh Renewable Energy Policy, 2025', url: 'https://invest.mp.gov.in/wp-content/uploads/2025/02/Energy-Policy-2025.pdf' },
      ],
    },
    {
      issuer: 'Madhya Pradesh Electricity Regulatory Commission (MPERC)',
      accent: '#a5b4fc',
      site:   'https://mperc.in/',
      links: [
        { year: '2025', label: 'MPERC Petition 22/2025 — wind-related order', url: 'https://mperc.in/uploads/petition_order_document/MPERC_PNo_22_2025_Final_Order_13_08_2025_1.pdf' },
        { year: '2025', label: 'Status of Madhya Pradesh Power Sector (27 Jun 2025)', url: 'https://mperc.in/uploads/editor/About_MP_Power_Sector_as_on_27_06_2025.pdf' },
      ],
    },
    {
      issuer: 'MPPMCL — Procurement',
      accent: '#7bc4e2',
      site:   'https://mptenders.gov.in/',
      links: [
        { year: '2025', label: 'MPPMCL 800 MW wind tender (+800 MW greenshoe)', url: 'https://www.mercomindia.com/madhya-pradesh-issues-tender-to-procure-800-mw-wind-power' },
      ],
    },
  ],
  'Maharashtra': [
    {
      issuer: 'Maharashtra Energy Development Agency (MEDA) — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://www.mahaurja.com/meda/',
      links: [
        { year: '2020', label: 'Maharashtra Unconventional Energy Generation Policy, 2020', url: 'https://india-re-navigator.com/public/tender_uploads/utility_rooftop_wind_policy-602fb08002107.pdf' },
        { year: 'Ongoing', label: 'MEDA Wind Power Policy page', url: 'https://www.mahaurja.com/meda/en/programme/wind_power_policy' },
      ],
    },
    {
      issuer: 'Maharashtra Electricity Regulatory Commission (MERC)',
      accent: '#a5b4fc',
      site:   'https://merc.gov.in/',
      links: [
        { year: 'Ongoing', label: 'MERC RE tariff / open-access / banking orders', url: 'https://merc.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE — Central',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2022', label: 'Draft National Repowering Policy, 2022', url: 'https://mnre.gov.in/en/wind-schemes-guidelines/' },
      ],
    },
  ],
  'Odisha': [
    {
      issuer: 'OREDA',
      accent: '#ff8a1f',
      site:   'https://oredaodisha.com/',
      links: [
        { year: '2022', label: 'Odisha Renewable Energy Policy, 2022', url: 'https://investodisha.gov.in/policy-framework/sectoral-policies/renewable-energy-policy-2022' },
      ],
    },
    {
      issuer: 'OERC',
      accent: '#a5b4fc',
      site:   'https://www.orierc.org/',
      links: [
        { year: 'Ongoing', label: 'OERC tariff orders', url: 'https://www.orierc.org/' },
      ],
    },
  ],
  'Rajasthan': [
    {
      issuer: 'Rajasthan Renewable Energy Corporation Ltd. (RRECL) — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://energy.rajasthan.gov.in/rrecl/',
      links: [
        { year: '2019', label: 'Wind & Hybrid Energy Policy, 2019', url: 'https://energy.rajasthan.gov.in/rrecl/' },
        { year: '2023', label: 'Rajasthan Renewable Energy Policy, 2023', url: 'https://rising.rajasthan.gov.in/storage/app/public/files/pdf/rajasthan-renewable-energy-policy-2023.pdf' },
        { year: '2024', label: 'Rajasthan Integrated Clean Energy Policy, 2024', url: 'https://istart.rajasthan.gov.in/public/Policies/2024/rajasthan-integrated-clean-energy-policy.pdf' },
      ],
    },
    {
      issuer: 'Rajasthan Electricity Regulatory Commission (RERC)',
      accent: '#a5b4fc',
      site:   'https://rerc.rajasthan.gov.in/',
      links: [
        { year: '2021', label: 'RERC (Terms & Conditions for Open Access) Regulations', url: 'https://rerc.rajasthan.gov.in/' },
        { year: 'Ongoing', label: 'Tariff orders for wind power procurement', url: 'https://rerc.rajasthan.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE — Central schemes applicable in Rajasthan',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2022', label: 'Draft National Repowering Policy for Wind Power Projects, 2022', url: 'https://mnre.gov.in/en/wind-schemes-guidelines/' },
        { year: '2018', label: 'National Wind-Solar Hybrid Policy', url: 'https://mnre.gov.in/en/wind-policy-and-guidelines/' },
      ],
    },
  ],
  'Tamil Nadu': [
    {
      issuer: 'Tamil Nadu Green Energy Corp. (TNGECL) / TEDA — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://teda.tn.gov.in/',
      links: [
        { year: '2024', label: 'Tamil Nadu Repowering, Refurbishment & Life Extension Policy, 2024', url: 'https://powerline.net.in/2024/12/05/big-moves-renewable-energy-policy-developments-in-tamil-nadu/' },
        { year: '2026', label: 'Jan 2026 amendments to 2024 policy (performance-linked eligibility)', url: 'https://www.mercomindia.com/tamil-nadu-tweaks-wind-policy-to-ease-repowering-and-life-extension-norms' },
      ],
    },
    {
      issuer: 'Tamil Nadu Electricity Regulatory Commission (TNERC)',
      accent: '#a5b4fc',
      site:   'https://www.tnerc.gov.in/',
      links: [
        { year: 'Ongoing', label: 'TNERC tariff, wheeling, banking, open-access orders', url: 'https://www.tnerc.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE & SECI — Central',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2015/2024', label: 'National Offshore Wind Energy Policy (Tamil Nadu is priority zone)', url: 'https://mnre.gov.in/en/wind-policy-and-guidelines/' },
        { year: '2026', label: '500 MW offshore wind tender (off TN coast) — due Feb 2026', url: 'https://energiesmedia.com/india-to-open-new-offshore-wind-tender-process/' },
      ],
    },
  ],
  'Telangana': [
    {
      issuer: 'TSREDCO / TGREDCO — State Nodal Agency',
      accent: '#ff8a1f',
      site:   'https://tsredco.telangana.gov.in/',
      links: [
        { year: '2025', label: 'Telangana Clean & Green Policy, 2025', url: 'https://tsredco.telangana.gov.in/Default.aspx' },
        { year: '2015', label: 'Telangana Solar Power Policy, 2015 (wind covered by TSERC)', url: 'https://tsredco.telangana.gov.in/' },
      ],
    },
    {
      issuer: 'Telangana State Electricity Regulatory Commission (TSERC)',
      accent: '#a5b4fc',
      site:   'https://tserc.gov.in/',
      links: [
        { year: 'Ongoing', label: 'TSERC generic wind tariff / open-access / banking orders', url: 'https://tserc.gov.in/' },
      ],
    },
    {
      issuer: 'MNRE & SECI — Central',
      accent: '#7bc4e2',
      site:   'https://mnre.gov.in/en/wind-schemes-guidelines/',
      links: [
        { year: '2022', label: 'Draft National Repowering Policy, 2022', url: 'https://mnre.gov.in/en/wind-schemes-guidelines/' },
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
