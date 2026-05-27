// Rule-based query rewriter for the wind-energy RAG.
//
// Embedding models (text-embedding-3-small here) don't know domain shorthand:
// "MP" doesn't embed close to "Madhya Pradesh", "Suzion" doesn't embed close
// to "Suzlon", "mast" alone misses "wind monitoring mast" passages. This
// layer fixes that BEFORE the query hits the embedder.
//
// Deterministic on purpose — easy to debug, no extra latency or cost.
// If a class of failures shows up that rules can't handle, we'll layer an
// LLM rewriter on top later (with a feature flag).

interface RewriteResult {
  original: string;
  // Canonical form: state abbrevs expanded + typos fixed. Safe to show the
  // LLM as the user's question — preserves intent without the typo
  // mismatching the corpus's canonical spellings.
  canonical: string;
  // Embed text: canonical + appended domain expansions (e.g. "mast → wind
  // monitoring mast"). Sent to the embedder ONLY — never to the LLM,
  // because the appended hints make for awkward reading.
  embedText: string;
  expansions: string[]; // human-readable list of substitutions applied
  // Additional query variants whose retrievals should be UNIONed with the
  // embedText's. Generated when the query has hints that a domain-specific
  // section in the corpus is the likely answer source but the user-phrased
  // query embeds far from that section.
  variants: string[];
}

// Known manufacturer / brand tokens in the wind directory corpus.
// Matching one of these in a query suggests the user wants per-manufacturer
// data, which is consolidated in the "Manufacturer-wise Capacity Addition"
// and "State & Make-wise WEG Installations" sections — sections that vector
// similarity alone doesn't reliably surface against a casually-worded query.
const MANUFACTURERS = [
  "Suzlon", "Vestas", "GE", "Envision", "Senvion", "Inox",
  "Adani Green", "Adani", "Siemense Gamesa", "Gamesa", "Sany",
  "Pioneer Wincon", "Pioneer", "SIVA Wind", "SIVA", "Nordex",
  "Regen Powertech", "Regen", "WEG Electric", "Emergya Wind",
];
const STATES_FULL = [
  "Andhra Pradesh", "Gujarat", "Karnataka", "Maharashtra", "Tamil Nadu",
  "Madhya Pradesh", "Rajasthan", "Telangana", "Kerala", "West Bengal",
  "Odisha", "Goa", "Uttar Pradesh", "Himachal Pradesh",
];
const YEAR_HINT = /\b(FY|fiscal|20\d{2}|20\d{2}[-–]\d{2})\b/;

// State abbreviations — only the unambiguous ones. We intentionally skip
// "OR" (Odisha) because it collides with the English word "or", and "GA"
// (Goa) because of "Georgia" / "ga" ambiguity. The wind directory only
// uses full state names, so query-side expansion is the only place these
// matter.
const STATE_ABBREVS: Record<string, string> = {
  MP: "Madhya Pradesh",
  TN: "Tamil Nadu",
  AP: "Andhra Pradesh",
  UP: "Uttar Pradesh",
  TG: "Telangana",
  MH: "Maharashtra",
  RJ: "Rajasthan",
  KA: "Karnataka",
  KL: "Kerala",
  WB: "West Bengal",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  JK: "Jammu and Kashmir",
};

// Manufacturer / common-term fuzzy fixes. Keys are typed forms, values are
// canonical names found in the corpus. Case-insensitive.
const TYPO_FIXES: Record<string, string> = {
  Suzion: "Suzlon",
  Suzlan: "Suzlon",
  Suzolon: "Suzlon",
  Vesta: "Vestas",
  "Siemens Gamesa": "Siemense Gamesa", // OCR'd as "Siemense" in this corpus
  Gamesia: "Gamesa",
  Inox: "Inox", // canonical; here so users mistyping it map back
  // Common Indian state misspellings — embedder doesn't connect "gujrat" to
  // "Gujarat" reliably, so the state-tagged chunks rank lower than they should.
  Gujrat: "Gujarat",
  Maharastra: "Maharashtra",
  Maharasthra: "Maharashtra",
  Karnatka: "Karnataka",
  Karnatak: "Karnataka",
  Tamilnadu: "Tamil Nadu",
  "Tamil nadu": "Tamil Nadu",
  Telangna: "Telangana",
  Telengana: "Telangana",
  "Andra Pradesh": "Andhra Pradesh",
  "Madhyapradesh": "Madhya Pradesh",
  "Madhya pradesh": "Madhya Pradesh",
  Rajstan: "Rajasthan",
  Rajashtan: "Rajasthan",
  "Uttarpradesh": "Uttar Pradesh",
  "Uttar pradesh": "Uttar Pradesh",
  "Himachalpradesh": "Himachal Pradesh",
  "West bengal": "West Bengal",
  Westbengal: "West Bengal",
  Orissa: "Odisha",
};

// Domain shorthand: query terms that should also include the longer
// canonical phrase from the corpus. We APPEND the expansion (rather than
// replace) so the original term still helps if it appears in chunks.
const DOMAIN_EXPANSIONS: Record<string, string> = {
  mast: "wind monitoring mast",
  masts: "wind monitoring masts",
  WEG: "Wind Energy Generator",
  WEGs: "Wind Energy Generators",
  WTG: "Wind Turbine Generator",
  WTGs: "Wind Turbine Generators",
  capacity: "installed capacity",
  manufacturer: "WEG manufacturer",
  turbine: "wind turbine generator WEG",
  turbines: "wind turbine generators WEGs",
};

export function rewriteQuery(input: string): RewriteResult {
  const original = input;
  let s = input;
  const expansions: string[] = [];

  // State abbrevs — match as whole tokens (word boundary, allow surrounding
  // punctuation but not adjoining letters). We do this BEFORE typo/domain
  // passes because state abbrevs are most likely to be uppercase.
  for (const [abbr, full] of Object.entries(STATE_ABBREVS)) {
    const re = new RegExp(`(?<![A-Za-z])${abbr}(?![A-Za-z])`, "g");
    if (re.test(s)) {
      s = s.replace(re, full);
      expansions.push(`${abbr} → ${full}`);
    }
  }

  // Typo fixes — case-insensitive match, preserve casing of the match by
  // overwriting with the canonical (canonical wins since we want consistent
  // form for embedding).
  for (const [typo, canonical] of Object.entries(TYPO_FIXES)) {
    const re = new RegExp(`\\b${typo.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(s)) {
      s = s.replace(re, canonical);
      if (typo.toLowerCase() !== canonical.toLowerCase()) {
        expansions.push(`${typo} → ${canonical}`);
      }
    }
  }

  // Canonical is the LLM-safe rewrite (no appended hints, just typo +
  // abbreviation fixes). The user's intent is preserved.
  const canonical = s.trim();

  // For embed text, also append domain hints. These improve retrieval but
  // make awkward reading, so they never reach the LLM.
  const appended: string[] = [];
  for (const [term, expansion] of Object.entries(DOMAIN_EXPANSIONS)) {
    const re = new RegExp(`\\b${term}\\b`, "g");
    if (re.test(canonical) && !canonical.toLowerCase().includes(expansion.toLowerCase())) {
      appended.push(expansion);
      expansions.push(`+${term}: ${expansion}`);
    }
  }
  const embedText = appended.length > 0
    ? `${canonical} (${appended.join("; ")})`
    : canonical;

  const variants = generateVariants(canonical);
  return { original, canonical, embedText, expansions, variants };
}

// Generate additional query variants that target specific sections of the
// directory which embed poorly against casual phrasings.
function generateVariants(rewritten: string): string[] {
  const variants: string[] = [];
  const lower = rewritten.toLowerCase();

  const hasManufacturer = MANUFACTURERS.some(
    (m) => new RegExp(`\\b${m}\\b`, "i").test(rewritten),
  );
  const hasYear = YEAR_HINT.test(rewritten);
  const hasState = STATES_FULL.some(
    (st) => lower.includes(st.toLowerCase()),
  );

  // Manufacturer + year → two distinct tables in the directory:
  // (a) 5-year "Manufacturer-wise Capacity Addition" summary paragraph
  //     (covers ~last 5 FYs, casual prose phrasing).
  // (b) 40-year "Make & Year-wise WEG Installations" table (every FY back
  //     to ~FY 2010-11, structured rows). For historical years (anything
  //     older than ~2020), only (b) has data.
  if (hasManufacturer && hasYear) {
    variants.push(
      `Manufacturer-wise capacity addition contribution MW during the year ${rewritten}`,
    );
    variants.push(
      `Make and Year-wise WEG Installations in India table by manufacturer for FY year ${rewritten}`,
    );
  }
  // Manufacturer + state → "State & Make-wise WEG Installations" tables.
  if (hasManufacturer && hasState) {
    variants.push(
      `State and Make-wise WEG Installations table by manufacturer and state ${rewritten}`,
    );
  }
  // Manufacturer alone (no specific year or state) → boost toward overall
  // per-manufacturer summary chunks (cumulative totals, FY 2024-25 prose
  // contribution, manufacturer-wise capacity addition table).
  if (hasManufacturer && !hasYear && !hasState) {
    variants.push(
      `Manufacturer cumulative total installations and FY 2024-25 contribution MW summary ${rewritten}`,
    );
    variants.push(
      `State and Make-wise WEG Installations cumulative total by manufacturer ${rewritten}`,
    );
  }
  // Mast/monitoring queries → NIWE summary paragraph.
  if (/\bmast(s)?\b/i.test(rewritten) || /\bmonitoring\b/i.test(rewritten)) {
    variants.push(
      `NIWE total wind monitoring masts installed locations India ${rewritten}`,
    );
  }
  // Percent/share/ratio queries → "Important Facts and Figures" summary.
  if (/\b(percent|percentage|%|share|ratio|potential)\b/i.test(rewritten)) {
    variants.push(
      `Important facts and figures of Indian windpower percentage of estimated potential ${rewritten}`,
    );
  }
  // "How many manufacturers / companies / makers" queries → the directory's
  // headline list paragraph ("there are 14 WEG manufacturers as on
  // 10.07.2025..."). Without this hint, the per-(mfr, FY) synthetic fact
  // chunks crowd out the summary prose.
  if (
    /\bhow many\b/i.test(rewritten) &&
    /\b(manufacturer|maker|company|companies|vendors?)\b/i.test(rewritten)
  ) {
    variants.push(
      `List of WEG manufacturers offering wind electric generators in India ratings hub heights total models active ${rewritten}`,
    );
  }

  return variants;
}
