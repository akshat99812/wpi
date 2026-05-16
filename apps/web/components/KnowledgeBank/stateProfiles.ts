export interface StateWindProfile {
  installed_mw:       number;
  installed_caption:  string;
  potential_gw:       number;

  // Quick-fact chips
  plf:            string;
  primeDistricts: string;
  terrain:        string;
  policyAnchor:   string;

  // Intro paragraph (shown before the chips)
  intro: string;

  // InfoCard bodies (each string = one <Prose> paragraph)
  resourceGeography: string[];
  windRegime:        string;
  sectorProfile:     string[];
  gridTransmission:  string;
  nearTermOutlook:   string;

  sources: Array<{ label: string; url: string }>;
}

const GWA = (state: string) =>
  `https://globalwindatlas.info/area/India/${encodeURIComponent(state)}`;

export const STATE_PROFILES: Record<string, StateWindProfile> = {

  // ── Andhra Pradesh ─────────────────────────────────────────────────────────
  'Andhra Pradesh': {
    installed_mw:      4377,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      123.3,

    plf:            '28 – 38%',
    primeDistricts: 'Anantapur, Kurnool, Nellore',
    terrain:        'Rain-shadow Deccan plateau',
    policyAnchor:   'AP RE Policy 2022',

    intro: "Andhra Pradesh's rain-shadow Anantapur–Kurnool belt is among India's most productive wind terrain. With ~4.38 GW installed and 123.3 GW of NIWE 150 m potential, the state carries strong procurement momentum under APEPDCL tenders and SECI ISTS tranches.",

    resourceGeography: [
      "AP's prime corridor runs from Anantapur — one of India's driest districts — through Kurnool and into coastal Nellore. NIWE places the 150 m potential at 123.3 GW (MNRE Table 7.1). Wind speeds in the Anantapur–Kurnool rain-shadow reach 7.5–8.5 m/s at hub height.",
      "Key clusters: Anantapur (Greenko, ReNew, Vestas legacy), Kurnool (Adani, NTPC Renewable), Nellore coastal corridor, and Prakasam. Coastal Nellore and Prakasam pair high wind with strong solar, making FDRE hybrid projects bankable.",
    ],
    windRegime: "The rain-shadow belt is terrain-accelerated; sites pick up south-west monsoon flow (Jun–Sep) and benefit from cyclonic tail-winds in Oct–Dec. Annual PLF at 150 m runs 30–38% at top Anantapur sites. The Kurnool–Nellore coastal band records modest year-round flows that smooth seasonal variability.",
    sectorProfile: [
      "State nodal: NREDCAP (AP New & Renewable Energy Development Corporation). Utilities: APEPDCL and APSPDCL for retail distribution; APTRANSCO for transmission. APERC is the state regulator.",
      "AP RE Policy 2022 targets 40 GW of RE by 2030. Active developers: Greenko (Anantapur, Kurnool), ReNew Power, NTPC Renewable, Adani Green, Torrent and Sembcorp. AP has been a primary SECI ISTS tranche beneficiary, with tranches XII–XV allocating significant capacity to Anantapur.",
    ],
    gridTransmission: "APTRANSCO operates the 220/400 kV backbone. PGCIL Southern Region handles ISTS via the Kurnool–Tadipatri 400 kV link and the Gazuwaka 765 kV substation. Green Energy Corridor Phase II (Rs 1,620 Cr, AP component) strengthens Kurnool and Anantapur cluster evacuation.",
    nearTermOutlook: "Pipeline: APEPDCL / APSPDCL tenders (~2 GW), SECI ISTS capacity allocated to AP, NREDCAP auctions, coastal Nellore offshore feasibility (MNRE), and FDRE hybrid projects in the Kurnool–Anantapur cluster.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Andhra Pradesh in Global Wind Atlas', url: GWA('Andhra Pradesh') },
      { label: 'NREDCAP — AP RE Corporation', url: 'https://nredcap.in/' },
    ],
  },

  // ── Gujarat ────────────────────────────────────────────────────────────────
  'Gujarat': {
    installed_mw:      12677,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      180.8,

    plf:            '28 – 35%',
    primeDistricts: 'Kutch, Rajkot, Jamnagar',
    terrain:        'Coastal & arid plains',
    policyAnchor:   'Gujarat RE Policy 2023',

    intro: "Gujarat leads India's wind fleet with ~12.68 GW installed — the largest state base nationally. The Kutch–Saurashtra coast delivers consistent westerlies year-round, and the Gulf of Kutch is designated India's primary offshore development zone with SECI VGF support.",

    resourceGeography: [
      "Gujarat's wind resource anchors on the Kutch–Saurashtra coastal belt and the Thar Desert margin. The NIWE 150 m potential is 180.8 GW — second-largest state endowment after Rajasthan. Kutch wind speeds regularly exceed 8 m/s at hub height; the Adani-dominated Khavda cluster hosts Class 6–7 sites.",
      "Key clusters: Kutch (Adani Green, NTPC Renewable, CESC), Rajkot–Jasdan corridor (ReNew, Greenko), Jamnagar–Porbandar coast, and Bhavnagar–Saurashtra ridgelines. The Dwarka–Okha bearing is the Gulf of Kutch offshore zone.",
    ],
    windRegime: "Kutch and Saurashtra receive strong south-west monsoon flows (Jun–Sep) augmented by a winter north-westerly regime. A thermal-low in pre-monsoon months (Mar–May) extends generation well beyond the monsoon season, giving Gujarat one of India's least-seasonal large-state wind profiles. Offshore simulations put mean Gulf of Kutch speeds at 9–11 m/s at 150 m.",
    sectorProfile: [
      "Nodal agencies: GEDA (policy, clearances), GUVNL (utility procurement), GWEL (group-captive and IPP). GETCO is the state transmission utility. Gujarat Wind/Solar Power Policy 2023 provides single-window clearance and favourable banking and wheeling norms for C&I consumers.",
      "Major developers: Adani Green Energy (Khavda RE Park, ~5 GW), NTPC Renewable, Greenko, ReNew Power, Torrent Power, Sembcorp. GUVNL Phase IV–VI tenders (~5 GW combined) have been the primary commissioning driver since 2022.",
    ],
    gridTransmission: "GETCO operates the 220/400 kV backbone. PGCIL Western Region handles ISTS via the Khavda–Bhuj–Vadodara 765 kV corridor. Offshore: PGCIL is evaluating an HVDC submarine landing point at Vadodara for Gulf of Kutch projects.",
    nearTermOutlook: "Pipeline: GUVNL Phase VI (~2 GW), SECI offshore RfS (500 MW Gulf of Kutch, VGF-backed), FDRE hybrid rounds, and captive projects in the chemical and petrochemical industrial belt. Khavda RE Park (30 GW ultimate) is India's largest single RE site.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Gujarat in Global Wind Atlas', url: GWA('Gujarat') },
      { label: 'GUVNL Tenders', url: 'https://www.guvnl.com/' },
    ],
  },

  // ── Karnataka ─────────────────────────────────────────────────────────────
  'Karnataka': {
    installed_mw:      7351,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      169.3,

    plf:            '25 – 35%',
    primeDistricts: 'Chitradurga, Gadag, Davangere',
    terrain:        'Deccan plateau ridgelines',
    policyAnchor:   'Karnataka RE Policy 2022–27',

    intro: "Karnataka holds ~169.3 GW of NIWE 150 m wind potential — the fourth-largest state endowment nationally — yet only ~4.3% is built out. The Chitradurga–Gadag–Davangere ridgeline is India's densest wind development corridor and anchors the OEM manufacturing hub (Inox, Vestas).",

    resourceGeography: [
      "Karnataka's wind resource runs along the Deccan plateau ridgelines from Chitradurga through Gadag, Davangere and Tumkur. NIWE places the 150 m potential at 169.3 GW (MNRE Table 7.1) — fourth-largest nationally, after Rajasthan, Gujarat and Maharashtra. Best ridgeline sites record 7.5–9 m/s at hub height.",
      "Key clusters: Chitradurga (ReNew, Greenko, NTPC), Gadag (Inox Wind, Enercon legacy), Davangere, and the Tumkur–Pavagada hybrid zone. The 2 GW Pavagada Solar-Wind Hybrid Park is India's largest hybrid installation.",
    ],
    windRegime: "Deccan ridgeline sites pick up south-west monsoon flows (Jun–Sep) accelerated by terrain channelling. PLF at 150 m typically spans 28–38% on prime ridgelines; monsoon-season CUFs reach 45–55% in peak months. Winter flow is more subdued (15–20% CUF), giving Karnataka a highly seasonal generation profile.",
    sectorProfile: [
      "State nodal: KREDL (Karnataka Renewable Energy Development Limited). Utilities: BESCOM, HESCOM, GESCOM, MESCOM, CESC (Bengaluru) for distribution; KPTCL for transmission. KERC is the state regulator.",
      "Karnataka RE Policy 2022–2027 targets 10 GW of wind additions by 2027. Major developers: ReNew Power, Greenko, NTPC Renewable, Adani Green, Inox Wind, Enercon. Suzlon's Pondicherry assembly line supplies Karnataka projects. SECI ISTS tranches XII–XV allocated significant Karnataka capacity.",
    ],
    gridTransmission: "KPTCL operates the 220/400 kV backbone. PGCIL Southern Region provides ISTS via Chitradurga–Tumkur 400 kV and the Gadag 765 kV substation. The Gadag–Hungund 765 kV link is critical for Chitradurga–Gadag cluster evacuation to the Northern and Western regions.",
    nearTermOutlook: "Pipeline: BESCOM / HESCOM procurement (~2 GW), SECI ISTS tranches with Karnataka capacity allocations, KREDL auction rounds under RE Policy 2022, and hybrid projects in the Chitradurga zone. Repowering of ~800 MW legacy Enercon fleet is under evaluation.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Karnataka in Global Wind Atlas', url: GWA('Karnataka') },
      { label: 'KREDL — Karnataka RE Development', url: 'https://kredlinfo.in/' },
    ],
  },

  // ── Kerala ────────────────────────────────────────────────────────────────
  'Kerala': {
    installed_mw:      71,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      2.62,

    plf:            '18 – 25%',
    primeDistricts: 'Palakkad, Idukki, Thrissur',
    terrain:        'Palghat gap & Western Ghats',
    policyAnchor:   'Kerala RE Policy 2022',

    intro: "Kerala's wind resource is concentrated at the Palghat gap — the same low-altitude pass that powers Tamil Nadu's strongest sites. Development is constrained by Western Ghats Eco-Sensitive Zone designations and fragmented land holdings; installed capacity is just ~71 MW (MNRE, 31 Mar 2025).",

    resourceGeography: [
      "Kerala's @150 m potential is ~2.62 GW (NIWE / MNRE Table 7.1), one of the smallest among Indian wind states. The resource concentrates in the Palakkad district (Palghat gap) and on the high-altitude ridges of Idukki–Munnar. The gap creates a natural wind funnel with hub-height speeds of 6–8 m/s, but the best sites straddle the Kerala–Tamil Nadu border and most are now built out on the TN side.",
      "Development is highly constrained by forest land classification under the Western Ghats Eco-Sensitive Zone notifications and fragmented paddy-land holdings. Palakkad and Idukki are the only viable utility-scale wind zones.",
    ],
    windRegime: "Kerala is a pure south-west monsoon state — Jun–Sep accounts for 60–70% of annual wind generation. PLF at Palakkad sites runs 20–28% annually; monsoon-peak CUFs can reach 35%. Post-monsoon and winter generation drops sharply, creating debt-service coverage risk in non-monsoon quarters.",
    sectorProfile: [
      "State nodal: ANERT (Agency for New & Renewable Energy Research and Technology). Utility: KSEB (Kerala State Electricity Board) for both generation and distribution. KSERC is the state regulator.",
      "Kerala RE Policy 2022 frames the state's clean-energy roadmap. Suzlon and Inox Wind have operational projects in Palakkad. KSEB procures limited wind through tenders, APPC-based purchase, and feed-in tariff orders; group-captive C&I demand remains underdeveloped.",
    ],
    gridTransmission: "KSEB operates the 110/220 kV network. PGCIL Southern Region connects Kerala via Madakkathara–Coimbatore 400 kV. Palakkad cluster connects via the Palakkad–Kalamassery 220 kV line. Grid constraints in Idukki limit large-scale project commissioning.",
    nearTermOutlook: "KSEB mini-tenders (~150 MW), rooftop and small-wind for RPO compliance, and potential Idukki hydro-wind complementarity schemes. Structural growth is constrained by eco-sensitive zone regulations and limited land availability.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Kerala in Global Wind Atlas', url: GWA('Kerala') },
      { label: 'ANERT — Kerala RE Agency', url: 'https://anert.gov.in/' },
    ],
  },

  // ── Madhya Pradesh ────────────────────────────────────────────────────────
  'Madhya Pradesh': {
    installed_mw:      3195,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      55.4,

    plf:            '~26%',
    primeDistricts: 'Dhar, Khargone, Ratlam',
    terrain:        'Malwa plateau ridges',
    policyAnchor:   'Energy Policy 2025',

    intro: "Malwa plateau ridge lines and the western MP–Gujarat border pick up reasonable monsoon winds. Material repowering potential from first-generation fleet (1,562 MW identified by MPUVNL/NIWE).\n\nWind zones: Dhar, Ujjain, Ratlam, Shajapur, Khargone.",

    resourceGeography: [
      "Madhya Pradesh's wind resource is on the Malwa plateau ridges — Dhar, Ujjain, Ratlam, Shajapur and Khargone. The state's 150 m potential is 55.4 GW (NIWE / MNRE Table 7.1), materially smaller than the peninsular leaders, but sites are consistent and well-characterised.",
      "Installed base is ~3.20 GW (MNRE 31 Mar 2025); realisation is ~5.8% against the NIWE potential.",
    ],
    windRegime: "The regime is monsoon-driven with ridge-line terrain acceleration; PLFs at 150 m typically span 22–30%. MP's wind-solar complementarity is moderate, and FDRE / hybrid rounds have been the primary commissioning pathway since 2023.",
    sectorProfile: [
      "The state nodal agency is MP Urja Vikas Nigam (MPUVNL / MP Renewable); MPPTCL is the state transmission utility. The MP Renewable Energy Policy 2025 (issued Feb 2025) is the current framework. MPERC's 2025 generic wind tariff order and the MP Power Management Company's 800 MW wind tender (Dec 2024) have driven current activity.",
      "Captive wind projects are actively being procured — e.g. MP Jal Nigam's 60 MW captive wind block. Suzlon, ReNew, Adani and Tata Power have active portfolios in the state.",
    ],
    gridTransmission: "MPPTCL operates the state grid; PGCIL Western Region handles ISTS. Dhar and Ratlam clusters are served by dedicated 220/400 kV substations linked to the Indore load centre.",
    nearTermOutlook: "Near-term pipeline is anchored in the 800 MW state tender, MP Energy Policy 2025 implementation, MPERC's 2025 wind tariff order, and state-captive/hybrid projects by state PSUs.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Madhya Pradesh in Global Wind Atlas', url: GWA('Madhya Pradesh') },
    ],
  },

  // ── Maharashtra ───────────────────────────────────────────────────────────
  'Maharashtra': {
    installed_mw:      5285,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      173.9,

    plf:            '22 – 30%',
    primeDistricts: 'Satara, Sangli, Dhule, Nashik',
    terrain:        'Western Ghats leeward ridges',
    policyAnchor:   'Maharashtra RE Policy 2023',

    intro: "Maharashtra's wind resource concentrates on the leeward escarpments of the Western Ghats and the Deccan plateau. At ~5.28 GW installed it is India's fifth-largest state by capacity. MSEDCL is the most active FDRE (Firm and Dispatchable RE) utility procurer in India.",

    resourceGeography: [
      "Maharashtra's wind resource runs along the Ghats leeward ridge from Satara through Sangli and Kolhapur, and across the Deccan plateau from Dhule and Nashik into Ahmednagar. The NIWE 150 m potential is 173.9 GW (MNRE Table 7.1) — third-largest nationally. Sites range from maritime-influenced Ghats escarpments to drier inland plateaus.",
      "Key clusters: Satara (ReNew, Greenko, NTPC), Sangli–Kolhapur, Dhule–Nandurbar (Adani), and the Nashik–Ahmednagar corridor. The Mumbai–Pune industrial belt is the primary C&I offtake market.",
    ],
    windRegime: "Maharashtra sites are monsoon-driven: the south-west monsoon (Jun–Sep) accounts for 50–60% of annual generation on Ghats-facing escarpments. Annual PLF runs 24–32% at 150 m; Satara and Sangli prime sites exceed 28%. Inland Dhule–Nashik sites benefit from slightly reduced monsoon dominance due to the rain-shadow effect.",
    sectorProfile: [
      "State nodal: MEDA (Maharashtra Energy Development Agency). Utility procurement: MSEDCL (principal buyer); MAHATRANSCO for transmission. MERC regulates state tariff orders.",
      "Maharashtra RE Policy 2023 sets 17.3 GW of new RE capacity by 2025. MSEDCL is India's largest FDRE procurer (~8 GW hybrid pipeline, wind+solar+BESS). Developers: Adani Green, ReNew, Greenko, NTPC Renewable, Statkraft. Suzlon has its corporate HQ and assembly plants in Pune.",
    ],
    gridTransmission: "MAHATRANSCO operates the 220/400 kV backbone. PGCIL Western Region handles ISTS via the Pune–Solapur 400 kV corridor and the Dhule–Padghe 400 kV link. Green Energy Corridor investment strengthens Satara–Sangli cluster evacuation.",
    nearTermOutlook: "MSEDCL FDRE pipeline (~5–8 GW hybrid), MAHADISCOM procurement, state-level C&I group-captive projects, and Maharashtra RE Policy 2023 implementation. Satara–Sangli legacy-fleet repowering (~500 MW candidates from 1 MW vintage turbines).",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Maharashtra in Global Wind Atlas', url: GWA('Maharashtra') },
      { label: 'MEDA — Maharashtra Energy Development', url: 'https://www.mahaurja.com/' },
    ],
  },

  // ── Odisha ────────────────────────────────────────────────────────────────
  'Odisha': {
    installed_mw:      50,
    installed_caption: 'March 2025 (OREDA / GRIDCO)',
    potential_gw:      12.13,

    plf:            '18 – 25%',
    primeDistricts: 'Kalahandi, Koraput, Bolangir',
    terrain:        'Eastern Ghats & coastal belt',
    policyAnchor:   'Odisha RE Policy 2022',

    intro: "Odisha is an early-stage wind state with ~50 MW commissioned but a NIWE-assessed 150 m potential of ~12.13 GW (MNRE Table 7.1). GRIDCO has been actively tendering; the 480 km Bay of Bengal coastline (Paradip–Gopalpur) is under offshore feasibility study by MNRE/NIWE.",

    resourceGeography: [
      "Odisha's wind potential is distributed across the Eastern Ghats hillside districts (Kalahandi, Koraput, Bolangir) and the Bay of Bengal coastline. NIWE assesses the 150 m potential at ~12.13 GW. Wind speeds in best inland sites reach 6–7 m/s; coastal sites are marginally higher.",
      "Key development zones: Kalahandi–Nuapada (Suzlon pre-development), Koraput–Rayagada Eastern Ghats ridge, Bolangir plateau, and the coastal belt from Paradip to Gopalpur (offshore pre-feasibility).",
    ],
    windRegime: "Odisha experiences south-west monsoon flows and Bay of Bengal cyclonic systems. Post-FY20, Class-III WTGs (IEC TC-I) are mandated due to cyclone exposure. Annual PLF at 150 m inland sites runs 20–28%; coastal sites offer higher mean speeds but require cyclone-rated turbines and structural reinforcement.",
    sectorProfile: [
      "State nodal: OREDA (Odisha Renewable Energy Development Agency). Utility: GRIDCO (Grid Corporation of Odisha) for wholesale; NESCO, WESCO, SOUTHCO, CESU for retail distribution. OERC is the state regulator.",
      "Odisha RE Policy 2022 targets 10 GW of RE by 2030. GRIDCO's 2023 wind tender (~500 MW) attracted limited response due to evacuation constraints. Active developers: Suzlon (pre-development in Kalahandi), ReNew. NALCO and SAIL's Odisha operations are a significant C&I captive demand pool.",
    ],
    gridTransmission: "OPTCL operates the 132/220 kV backbone; PGCIL Eastern Region handles ISTS via Angul 400 kV and Rourkela 765 kV. Eastern Ghats cluster evacuation is constrained by limited 220 kV coverage. Green Energy Corridor Phase II allocates Rs 1,200 Cr for Odisha grid strengthening.",
    nearTermOutlook: "Pipeline: GRIDCO wind tender (~500+ MW), OREDA project facilitation, offshore feasibility study at Paradip–Gopalpur, and captive demand from NALCO/SAIL/JSPL. Grid infrastructure investment is the near-term development bottleneck.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Odisha in Global Wind Atlas', url: GWA('Odisha') },
      { label: 'OREDA — Odisha RE Agency', url: 'https://oreda.in/' },
    ],
  },

  // ── Rajasthan ─────────────────────────────────────────────────────────────
  'Rajasthan': {
    installed_mw:      5209,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      284.2,

    plf:            '28 – 38%',
    primeDistricts: 'Jaisalmer, Barmer, Jodhpur',
    terrain:        'Thar Desert arid plains',
    policyAnchor:   'Rajasthan RE Policy 2023',

    intro: "Rajasthan's Thar Desert region offers India's most consistent wind flows, driven by a thermal-low pressure system that reduces monsoon-dependence. With ~5.21 GW installed and 284.2 GW of NIWE 150 m potential, Rajasthan carries one of the largest underdeveloped RE endowments in the world.",

    resourceGeography: [
      "Rajasthan's wind corridor spans the Jaisalmer–Barmer belt, the Jodhpur plateau, and the Bikaner–Nagaur corridor. The NIWE 150 m potential is 284.2 GW (MNRE Table 7.1) — the largest state endowment nationally. Unlike peninsular states, Rajasthan's thermal-low circulation drives generation outside the monsoon season, producing one of India's least-seasonal wind regimes.",
      "Prime clusters: Jaisalmer (Adani, Greenko, NTPC), Barmer–Ramgarh, Jodhpur, Bikaner, and Nagaur. The Jaisalmer district alone accounts for ~70% of installed capacity and the bulk of the development pipeline. Khimsar in Nagaur hosts high-quality FDRE sites.",
    ],
    windRegime: "The Thar thermal-low creates a sustained pressure gradient that pulls in oceanic air from the Arabian Sea. PLF at well-sited Jaisalmer 150 m projects runs 32–40%; Class 6–7 sites record annual CUFs above 40%. The pre-monsoon (Apr–Jun) and monsoon seasons are equally productive, reducing inter-seasonal revenue variability.",
    sectorProfile: [
      "State nodal: RRECL (Rajasthan Renewable Energy Corporation Limited) for approvals and RPO. Utilities: RVUNL for state generation; discoms JVVNL, AVVNL and JDVVNL for distribution. RERC is the state regulator.",
      "Rajasthan RE Policy 2023 introduces single-window clearance and sets a 50 GW RE addition target by 2030. Major developers: Adani Green Energy (~1 GW+ Jaisalmer), Greenko, NTPC Renewable, ReNew, Avaada, Torrent. SECI ISTS tranches consistently allocate large capacity to Rajasthan sites.",
    ],
    gridTransmission: "RVPN operates the 220/400 kV backbone. PGCIL Northern Region handles ISTS via the Jaisalmer–Bikaner–Delhi 765 kV and the Barmer–Jodhpur–Ajmer 400 kV. Green Energy Corridor Phase II (Rs 12,031 Cr) strengthens Rajasthan evacuation to Punjab and Haryana.",
    nearTermOutlook: "Pipeline: RRECL auctions (~3 GW), SECI ISTS tranche capacity in Rajasthan, RVUNL procurement plan, and captive projects for the Delhi-NCR industrial corridor. Bhadla/Fatehgarh RE Park is developing into a 10 GW+ multi-technology zone.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Rajasthan in Global Wind Atlas', url: GWA('Rajasthan') },
      { label: 'RRECL — Rajasthan RE Corporation', url: 'https://www.rrecl.com/' },
    ],
  },

  // ── Tamil Nadu ────────────────────────────────────────────────────────────
  'Tamil Nadu': {
    installed_mw:      11740,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      95.1,

    plf:            '30 – 40%',
    primeDistricts: 'Tirunelveli, Thoothukudi, Coimbatore',
    terrain:        'Palghat gap + Ghats leeward',
    policyAnchor:   'TN Wind Energy Policy 2019',

    intro: "Tamil Nadu operates India's second-largest wind fleet at ~10.7 GW. The Palghat gap between Kerala and Tamil Nadu is a natural wind corridor; Tirunelveli and Thoothukudi districts host some of India's highest-PLF sites. Gulf of Mannar (Dhanushkodi) is designated for offshore development.",

    resourceGeography: [
      "Tamil Nadu's wind resource is driven by two mechanisms: the Palghat gap that funnels south-west monsoon flow across the peninsula, and the leeward escarpments of the Western Ghats. NIWE places the 150 m potential at 95.1 GW (MNRE Table 7.1) — sixth-highest nationally but with very high utilisation density.",
      "Prime clusters: Tirunelveli (Muppandal), Thoothukudi, Coimbatore (Aralvaimozhi / Kethanur), Dindigul, and the Pudukottai corridor. Offshore potential covers the Gulf of Mannar (Dhanushkodi) and Palk Strait.",
    ],
    windRegime: "Tamil Nadu benefits from both the south-west monsoon (Jun–Sep) and the north-east monsoon (Oct–Dec), creating a bimodal generation profile less seasonal than purely monsoon-dependent states. PLF at top-tier 150 m sites (Aralvaimozhi, Muppandal) regularly exceeds 35%; annual CUFs of 32–40% are achievable at optimally sited projects.",
    sectorProfile: [
      "State nodal: TEDA (Tamil Nadu Energy Development Agency). Utility procurement: TANGEDCO; open-access via TANTRANSCO. TNERC regulates tariff orders and banking policy.",
      "Active developers: INOX Wind, Vestas, Siemens Gamesa (legacy fleet), Adani Green, ReNew, Greenko. TN Wind Energy Policy 2019 allows life-extension repowering (norms issued 2024) and C&I open-access wheeling. SECI ISTS tranches allocate capacity to TN offshore and onshore sites.",
    ],
    gridTransmission: "TANTRANSCO operates the 110/230 kV network with strong southern generation corridors. PGCIL Southern Region handles ISTS via the Madurai–Pugalur 765 kV link. Offshore: PGCIL is evaluating an HVDC submarine cable from Kayathar / Tuticorin to the onshore grid.",
    nearTermOutlook: "Pipeline: TANGEDCO's 3 GW procurement plan (2025–28), SECI ISTS tranches, offshore development under MNRE (500 MW Gulf of Mannar phase), and repowering of legacy Muppandal / Aralvaimozhi fleet (~2,000+ MW repowering candidates).",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Tamil Nadu in Global Wind Atlas', url: GWA('Tamil Nadu') },
      { label: 'TEDA — Tamil Nadu Energy Development Agency', url: 'https://www.teda.in/' },
    ],
  },

  // ── Telangana ─────────────────────────────────────────────────────────────
  'Telangana': {
    installed_mw:      128,
    installed_caption: '31 March 2025 (MNRE RE-Stats 2024-25)',
    potential_gw:      54.7,

    plf:            '20 – 28%',
    primeDistricts: 'Narayanpet, Jogulamba Gadwal, Nizamabad',
    terrain:        'Deccan plateau — moderate ridges',
    policyAnchor:   'Telangana RE Policy 2022',

    intro: "Telangana is an emerging wind state post-bifurcation from Andhra Pradesh. The Deccan plateau terrain offers moderate wind speeds with significant untapped potential in northern and western districts. TSREDCO has been active in tendering since 2022.",

    resourceGeography: [
      "Telangana's wind resource is on the Deccan plateau ridgelines of the north-western districts — Narayanpet (formerly Mahabubnagar), Jogulamba Gadwal, Nizamabad and Sangareddy. NIWE places the 150 m potential at ~54.7 GW (MNRE Table 7.1) — moderate by Indian standards but well-suited to distributed generation and C&I captive.",
      "Key sites: Narayanpet and Wanaparthy districts (highest speeds, 6–7.5 m/s), Nizamabad corridor, and Mahabubnagar (legacy GE/Enercon fleet). The Hyderabad–Nagpur economic corridor hosts industrial C&I demand.",
    ],
    windRegime: "Telangana is monsoon-driven; the south-west monsoon (Jun–Sep) provides the bulk of generation. PLF at 150 m runs 20–28% depending on site quality. The Deccan interior is less windward than AP's coastal and rain-shadow zones, resulting in moderate but bankable resources with less inter-seasonal variation than coastal states.",
    sectorProfile: [
      "State nodal: TSREDCO (Telangana State Renewable Energy Development Corporation). Utilities: TSNPDCL and TSSPDCL for retail distribution; TSTRANSCO for transmission. TSERC is the state regulator.",
      "Telangana RE Policy 2022 provides single-window clearance and banking facilities. Active developers: ReNew Power, Greenko (Enercon-acquired sites), Adani Green, and Sembcorp. Open-access C&I for the Hyderabad pharma and data-centre belt is the primary offtake market.",
    ],
    gridTransmission: "TSTRANSCO operates the 220 kV backbone. PGCIL Southern Region handles ISTS from Hyderabad cluster substations. Grid capacity constraints in Narayanpet are being addressed via 400 kV substation upgrades (PGCIL FY26 plan).",
    nearTermOutlook: "Pipeline: TSREDCO auction round (~500 MW), TSNPDCL procurement for RPO compliance, C&I open-access for the Hyderabad industrial belt, and hybrid solar-wind projects. Proximity to the Hyderabad data-centre cluster is driving captive wind demand.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Telangana in Global Wind Atlas', url: GWA('Telangana') },
      { label: 'TSREDCO — Telangana RE Corporation', url: 'https://tsredco.telangana.gov.in/' },
    ],
  },

  // ── Himachal Pradesh ──────────────────────────────────────────────────────
  'Himachal Pradesh': {
    installed_mw:      118,
    installed_caption: 'March 2025 (HIMURJA)',
    potential_gw:      0.24,

    plf:            '15 – 22%',
    primeDistricts: 'Lahaul-Spiti, Kangra, Chamba',
    terrain:        'High-altitude mountain ridges',
    policyAnchor:   'HP RE Policy 2021',

    intro: "Himachal Pradesh's wind resource concentrates in the high-altitude districts of Lahaul-Spiti and Chamba, where ridge-line winds are strong but access is seasonally restricted. Development is early-stage at ~118 MW, constrained by terrain logistics and limited grid infrastructure.",

    resourceGeography: [
      "HP's 150 m potential — estimated at ~0.24 GW by NIWE (MNRE Table 7.1) — concentrates in the upper Spiti, Kinnaur and Chamba ridge systems above 3,000 m, with mean speeds of 5.5–7.5 m/s. These sites face significant logistical challenges for heavy equipment transport.",
      "Lower-altitude sites in Kangra and Bilaspur have been proposed but face ecological sensitivity (Great Himalayan National Park adjacent zones). The Kullu–Manali corridor is studied but mostly constrained by forest and protected-area overlaps.",
    ],
    windRegime: "HP's wind regime is driven by Himalayan valley channelling and katabatic-anabatic flows. Primary generation season is pre-monsoon (Apr–Jun) and post-monsoon (Sep–Nov); monsoon months see reduced speeds due to the blocking effect of the main Himalayan range. Annual PLF at operational sites runs 18–25%.",
    sectorProfile: [
      "State nodal: HIMURJA (Himachal Pradesh Energy Development Agency). Utility: HPSEBL (HP State Electricity Board Limited) for both generation and distribution. HPERC is the state regulator.",
      "HP RE Policy 2021 targets 1 GW of wind additions by 2027. Suzlon has operational projects in Spiti; Inox Wind has pre-development sites in Chamba. Cold-weather turbine variants (IEC Class S with arctic-grade lubricants and blade heating) are required at high-altitude sites.",
    ],
    gridTransmission: "HPPTCL operates the 220 kV state backbone; PGCIL Northern Region connects HP via the Abdullapur 400 kV interconnect. High-altitude Lahaul-Spiti sites require dedicated 33/132 kV step-up lines that add 15–25% to project costs.",
    nearTermOutlook: "Pipeline: HIMURJA 200 MW tender, HPSEBL small-hydro + wind complementarity schemes, and captive wind for Kinnaur–Spiti agri-processing zones. Development pace is gated by road-access infrastructure and HP grid reinforcement funding.",
    sources: [
      { label: 'NIWE — Wind Resource Assessment', url: 'https://niwe.res.in/' },
      { label: 'Open Himachal Pradesh in Global Wind Atlas', url: GWA('Himachal Pradesh') },
      { label: 'HIMURJA — HP Energy Agency', url: 'https://himurja.hp.gov.in/' },
    ],
  },

};
