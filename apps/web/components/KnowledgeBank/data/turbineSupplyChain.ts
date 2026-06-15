/**
 * Wind-turbine supply chain — OEMs offering products in India and where they
 * come from. Powers the "Supply chain" view in the Technology tab.
 *
 * Compiled June 2026 from MNRE RLMM/ALMM (Wind), company filings, and 2023–2026
 * industry news (deep-research + adversarial origin verification). TWO origin
 * dimensions are captured because they often differ — the real supply-chain
 * story for India:
 *   - `origin`      = corporate HQ / parent-company nationality.
 *   - `techOrigin`  = where the TURBINE DESIGN / IP comes from, when it differs
 *                     from the corporate origin (many India-HQ OEMs license
 *                     foreign — Chinese / German / US — designs).
 *
 * Origins reflect HQ/parent nationality as of mid-2026; ownership can change
 * (e.g. Siemens Gamesa's India business → India-controlled "Vayona Energy",
 * Dec 2025). Market-share / installed-MW figures are deliberately NOT asserted
 * here — only the (sourced) origin + India-presence mapping.
 */

export type IndiaPresence = 'Indigenous' | 'Local manufacturing' | 'Import' | 'Exited';
export type OemStatus = 'Major' | 'Established' | 'Emerging' | 'Exited';

export interface TurbineOem {
  name: string;
  /** Corporate HQ / parent-company nationality. */
  origin: string;
  /** Turbine design/IP lineage, only when it differs from `origin`. */
  techOrigin?: string;
  /** How the OEM supplies the Indian market. */
  presence: IndiaPresence;
  status: OemStatus;
  models?: string;
  note?: string;
  source: { title: string; url: string };
}

/** Per-origin colour + flag (one source of truth for chart + table). */
export const ORIGIN_META: Record<string, { color: string; flag: string }> = {
  India: { color: '#5ec26a', flag: '🇮🇳' },
  China: { color: '#e0584e', flag: '🇨🇳' },
  Denmark: { color: '#7aa7c7', flag: '🇩🇰' },
  'United States': { color: '#d3a13e', flag: '🇺🇸' },
  Germany: { color: '#b06be0', flag: '🇩🇪' },
  'Saudi Arabia': { color: '#3fae9a', flag: '🇸🇦' },
  Brazil: { color: '#e0954e', flag: '🇧🇷' },
  Spain: { color: '#d06bb2', flag: '🇪🇸' },
};

export const SUPPLY_CHAIN_AS_OF = 'June 2026';

/** Chinese OEMs that lead globally but have no confirmed India RLMM listing /
 *  manufacturing yet — shown as a watchlist, excluded from the active stats. */
export const OEM_WATCHLIST =
  'Other Chinese OEMs — Windey, Dongfang Electric, CRRC — lead global rankings ' +
  'but have no confirmed India RLMM listing or manufacturing as of mid-2026.';

export const TURBINE_OEMS: TurbineOem[] = [
  {
    name: 'Suzlon Energy',
    origin: 'India',
    presence: 'Indigenous',
    status: 'Major',
    models: 'S144 (3.x MW), S133, S120',
    note: 'Indigenous Indian OEM (Pune, 1995). Largest cumulative India installed base; fully in-house design + manufacturing (Pondicherry, Daman).',
    source: { title: 'MNRE — Wind Manufacturing (RLMM)', url: 'https://mnre.gov.in/en/wind-manufacturing/' },
  },
  {
    name: 'Inox Wind',
    origin: 'India',
    techOrigin: 'United States',
    presence: 'Indigenous',
    status: 'Major',
    models: 'DF 3.x MW, WT2000 2 MW',
    note: 'Indian OEM (InoxGFL group). Domestic mfg (Gujarat, HP, MP). Turbine design licensed from AMSC/WindTec (USA) — a tech licence, ownership is Indian.',
    source: { title: 'Top onshore wind OEMs in India — Blackridge Research', url: 'https://www.blackridgeresearch.com/blog/latest-list-of-top-onshore-wind-power-turbine-manufacturers-suppliers-companies-in-india' },
  },
  {
    name: 'Envision Energy',
    origin: 'China',
    presence: 'Local manufacturing',
    status: 'Major',
    models: 'EN-182/5.0 MW, EN-156/3.3 MW',
    note: "China's 2nd-largest OEM. India: nacelle/hub in Pune, blades in Trichy; EN-182/5.0 MW cleared RLMM May 2025. Among the top current India market shares.",
    source: { title: 'Envision Energy India — About', url: 'https://www.envision-energy.in/about-us' },
  },
  {
    name: 'Vestas',
    origin: 'Denmark',
    presence: 'Local manufacturing',
    status: 'Major',
    models: 'V150-4.x MW, EnVentus',
    note: 'Danish OEM (HQ Aarhus) — not German. Nacelle/hub + blade manufacturing in India (Chennai). Long-standing India operations.',
    source: { title: 'Vestas — company profile', url: 'https://en.wikipedia.org/wiki/Vestas' },
  },
  {
    name: 'GE Vernova',
    origin: 'United States',
    presence: 'Local manufacturing',
    status: 'Major',
    models: '3.8 MW-154m, 2.x–3.x MW',
    note: 'US OEM (spun off from GE, 2024). Pune factory (~1.5 GW/yr); >5 GW installed in India. New 3.8 MW turbine ALMM-certified 2025.',
    source: { title: 'GE Vernova — India 3.8 MW launch + ALMM', url: 'https://www.gevernova.com/news/press-releases/ge-vernova-deepens-india-commitment-38mw-workhorse-turbine-launch-powerica-order-allm-certification-pune-manufacturing' },
  },
  {
    name: 'Vayona Energy',
    origin: 'India',
    techOrigin: 'Spain / Germany',
    presence: 'Local manufacturing',
    status: 'Major',
    models: 'SG 2.x–3.x MW (ex-Siemens Gamesa)',
    note: "TPG + MAVCO consortium acquired Siemens Gamesa's India onshore business (~$550M, 90%), rebranded Vayona Energy (Dec 2025). Now India-controlled; Tamil Nadu mfg; tech heritage Spanish/German.",
    source: { title: 'TPG + MAVCO acquire Siemens Gamesa India → Vayona Energy', url: 'https://www.tpg.com/news-and-insights/tpg-and-mavco-led-consortium-completes-acquisition-of-siemens-gamesas-wind-business-in-india-and-sri-lanka-forming-new-platform-vayona-energy' },
  },
  {
    name: 'Nordex',
    origin: 'Germany',
    presence: 'Local manufacturing',
    status: 'Established',
    models: 'Delta4000 (N133 …)',
    note: 'German OEM (Acciona/Spain is largest shareholder). Building wind-component manufacturing in Tiruvallur, Tamil Nadu.',
    source: { title: 'Nordex India — component manufacturing facility', url: 'https://www.eqmagpro.com/nordex-india-initiates-construction-of-wind-energy-component-manufacturing-facility-in-tiruvallur-eq/' },
  },
  {
    name: 'Adani Wind',
    origin: 'India',
    techOrigin: 'Germany',
    presence: 'Local manufacturing',
    status: 'Emerging',
    models: '5.2 MW WTG',
    note: 'Adani group wind division. 5.2 MW RLMM-listed 2023; turbine built on W2E (Wind to Energy, Germany) technology. Integrated manufacturing near Mundra, Gujarat.',
    source: { title: "Adani Wind's 5.2 MW enlisted in MNRE RLMM", url: 'https://www.adanienterprises.com/en/newsroom/media-releases/adani-winds-5-2-mw-wind-turbine-enlisted-in-the-mnre-revised-list-of-models-and-manufacturers-rlmm' },
  },
  {
    name: 'Venwind Refex',
    origin: 'India',
    techOrigin: 'Germany / China',
    presence: 'Local manufacturing',
    status: 'Emerging',
    models: 'GWH182-5.3 MW',
    note: 'Subsidiary of Refex Industries (India); Silvassa factory. Turbine licensed from Vensys (Germany), which is ~70% owned by China’s Goldwind — so the design lineage is Chinese/German behind an Indian corporate.',
    source: { title: 'Venwind Refex opens 5.3 MW factory — Windpower Monthly', url: 'https://www.windpowermonthly.com/article/1927082/indian-manufacturer-venwind-refex-opens-factory-53mw-wind-turbine' },
  },
  {
    name: 'Sany',
    origin: 'China',
    presence: 'Local manufacturing',
    status: 'Emerging',
    models: 'SI-16840 4 MW',
    note: 'Sany Group (China). SI-16840 4 MW added to RLMM Jan 2024; ~1.6 GW India orders in 2024 (JSW, Sembcorp). India manufacturing presence.',
    source: { title: "Sany's SI-16840 secures MNRE approval — WindInsider", url: 'https://windinsider.com/2024/01/29/sanys-si-16840-wind-turbine-secures-mnre-approval-paving-the-way-for-expansion-in-indias-wind-power-landscape/' },
  },
  {
    name: 'Senvion India',
    origin: 'Saudi Arabia',
    techOrigin: 'Germany',
    presence: 'Local manufacturing',
    status: 'Established',
    note: 'Owned by alfanar (Saudi Arabia) since 2021 — the German parent Senvion GmbH went insolvent in 2019. German (REpower) tech heritage; India EPC/O&M + manufacturing.',
    source: { title: 'alfanar completes acquisition of Senvion India — Mercom', url: 'https://www.mercomindia.com/alfanar-completes-acquisition-wind-senvion' },
  },
  {
    name: 'WEG',
    origin: 'Brazil',
    presence: 'Local manufacturing',
    status: 'Emerging',
    note: 'Brazilian industrial OEM setting up wind-turbine manufacturing in India.',
    source: { title: 'WEG (Brazil) to set up wind manufacturing in India', url: 'https://www.eqmagpro.com/brazilian-company-weg-to-set-up-wind-turbine-manufacturing-facility-in-india/' },
  },
  {
    name: 'Wind World (India)',
    origin: 'India',
    presence: 'Local manufacturing',
    status: 'Established',
    note: 'Formerly Enercon India; rebranded after the Enercon (Germany) dispute. Large legacy installed base; India manufacturing.',
    source: { title: 'Wind World — formerly Enercon India', url: 'https://www.windpowermonthly.com/article/1172141/analysis-surprise-rebrand-company-formerly-known-enercon-india-limited' },
  },
  {
    name: 'RRB Energy',
    origin: 'India',
    presence: 'Indigenous',
    status: 'Established',
    note: 'Long-standing Indian OEM (Pawan Shakti series).',
    source: { title: 'RRB Energy — profile', url: 'https://en.wikipedia.org/wiki/RRB_Energy' },
  },
  {
    name: 'Siva Wind Turbine',
    origin: 'India',
    presence: 'Indigenous',
    status: 'Established',
    source: { title: 'MNRE — Wind Manufacturing (RLMM)', url: 'https://mnre.gov.in/en/wind-manufacturing/' },
  },
  {
    name: 'Pioneer Wincon',
    origin: 'India',
    presence: 'Indigenous',
    status: 'Established',
    note: 'Indian OEM (Chennai), small/medium turbines.',
    source: { title: 'Pioneer Wincon', url: 'https://pioneerwincon.com/in/' },
  },
  {
    name: 'Southern Wind Farms',
    origin: 'India',
    presence: 'Indigenous',
    status: 'Established',
    source: { title: 'MNRE — Wind Manufacturing (RLMM)', url: 'https://mnre.gov.in/en/wind-manufacturing/' },
  },
  {
    name: 'Goldwind',
    origin: 'China',
    presence: 'Import',
    status: 'Established',
    note: "World's largest OEM. Limited direct India supply (imports); also the ~70% owner of Vensys, whose design Venwind Refex builds.",
    source: { title: 'Goldwind — profile', url: 'https://en.wikipedia.org/wiki/Goldwind' },
  },
  {
    name: 'Mingyang Smart Energy',
    origin: 'China',
    presence: 'Import',
    status: 'Emerging',
    note: 'Major Chinese OEM exploring India; no confirmed RLMM model yet (low certainty).',
    source: { title: 'Mingyang Smart Energy — profile', url: 'https://en.wikipedia.org/wiki/Ming_Yang_Smart_Energy' },
  },
  {
    name: 'Siemens Gamesa (legacy)',
    origin: 'Spain',
    presence: 'Exited',
    status: 'Exited',
    note: 'Spanish/German OEM; India onshore wind business sold to Vayona Energy (2025). Listed as the historical brand — its successor is Vayona Energy above.',
    source: { title: 'Siemens Gamesa to divest India wind business', url: 'https://www.siemens-energy.com/global/en/home/press-releases/siemens-gamesa-to-divest-a-majority-stake-of-its-indian-wind-bus.html' },
  },
  {
    name: 'ReGen Powertech',
    origin: 'India',
    presence: 'Exited',
    status: 'Exited',
    note: 'Indian OEM (Vensys-licensed designs); insolvency / largely exited.',
    source: { title: 'ReGen Powertech — loan exposure sale', url: 'https://www.business-standard.com/industry/banking/sbi-to-sell-rs-1550-cr-loan-exposure-in-regen-powertech-125060901049_1.html' },
  },
];
