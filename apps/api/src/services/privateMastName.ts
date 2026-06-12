/**
 * Display name for a private mast from its free-form CSV label.
 *
 * The inventory labels mix the place name with mast height, operator codes,
 * measurement periods and "Pvt. WM/Mast" suffixes in no fixed order or
 * separator ("Aladar150m Jul24-Jun25_Pvt. Mast", "Ratkuriya-V_Pvt. WM_65m",
 * "Jura CECL_65m_WM_June2010-May2013"). The UI should show just "Aladar".
 *
 * Strategy: the place name is the leading run of the label, so cut at the
 * FIRST token that can't be part of a place name and tidy what's left. When
 * a marker opens the label, peel markers off the ends instead
 * ("Mast-1_80m_…_Pvt. Mast" → "Mast-1", "_Pvt. WM-Humbarne" → "Humbarne").
 */

// Tokens that can never be part of a place name.
const STRONG_MARKERS: readonly RegExp[] = [
  // No leading \b — "Pvt" arrives glued to the name ("PeddakodipallePvt.WM").
  /Pvt\b/i,
  // Height: "65m", "79.5m", "65 M", and attached forms like "Aladar150m"
  // (no \b before the digits — letter→digit is not a word boundary).
  /\d{2,3}(?:\.\d+)?\s*m\b/i,
  // "85 m Ht." and attached "Ht100m".
  /\bHt(?:\b\.?|(?=\d))/i,
  // Month + year fragments: "Jul24", "Nov. 2010", "June2010", "2may2011".
  // Digits are required after the month so names like "Mayurbhanj" survive;
  // a digit prefix only counts when attached ("2may") — a space-separated
  // one is a name suffix ("Sri Palvan-1 Dec09" keeps its "-1").
  /\b(?:\d{1,2})?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*'?\d{2,4}\b/i,
  /\b(?:19|20)\d{2}\b/,
  // "… 1 Year data" measurement-period notes.
  /\b\d+\s*year\b/i,
  // Operator / developer codes seen in the inventory ("CECLWM" arrives glued).
  /\b(?:MPWL|CECL(?:WM)?|MEIL|Suzlon|Vestas)\b/i,
];

// Suffix words that usually mark the name's end but CAN open a real name
// (a mast literally named "Mast-1") — so they cut, but never force a
// leading peel.
const WEAK_MARKERS: readonly RegExp[] = [/\bWM\b/i, /\bmast\b/i];

// Where the place name ends (used for the first-marker cut).
const CUT_MARKERS: readonly RegExp[] = [...STRONG_MARKERS, ...WEAK_MARKERS];

// Peeling off the label's ends additionally drops "Wind" ("…_Pvt. Wind") —
// too name-like to cut on mid-label ("Guttaseema Wind"), safe at an edge.
const PEEL_MARKERS: readonly RegExp[] = [...CUT_MARKERS, /\bwind\b/i];

// Leftovers shorter than this are noise ("2" from "Pvt. WM-2"), not a name.
const MIN_NAME_LENGTH = 3;

const EDGE_SEPARATORS = /^[\s.,\-]+|[\s.,\-]+$/g;

function tidy(s: string): string {
  return s
    .replace(/["'*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(EDGE_SEPARATORS, '')
    .trim();
}

/** Index of the earliest CUT_MARKERS match in the label, or -1 if none. */
function firstMarkerIndex(s: string): number {
  let cut = -1;
  for (const re of CUT_MARKERS) {
    const m = re.exec(s);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  return cut;
}

/** One peel pass: drop a PEEL_MARKERS token sitting at the given edge. */
function peelOnce(cur: string, end: 'leading' | 'trailing'): string {
  for (const re of PEEL_MARKERS) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(cur)) !== null) {
      const atEdge =
        end === 'leading'
          ? m.index === 0
          : m.index + m[0].length === cur.length;
      if (atEdge) {
        const peeled =
          end === 'leading' ? cur.slice(m[0].length) : cur.slice(0, m.index);
        return peeled.replace(EDGE_SEPARATORS, '');
      }
    }
  }
  return cur;
}

/** Repeatedly peel marker tokens (plus separators) off one end. */
function stripMarkersFromEnd(s: string, end: 'leading' | 'trailing'): string {
  let cur = s.replace(EDGE_SEPARATORS, '');
  for (;;) {
    const next = peelOnce(cur, end);
    if (next === cur) return cur;
    cur = next;
  }
}

function startsWithStrongMarker(s: string): boolean {
  return STRONG_MARKERS.some((re) => re.exec(s)?.index === 0);
}

export function displayNameFromLabel(raw: string): string {
  // Multiline labels (CSV-quoted) carry the name on the first line; quoted
  // segments inside a label ("Trade wind", 'Paribaha') are operator names.
  // Underscores become spaces BEFORE marker matching — "_" is a word char,
  // so "\bPvt\b" would never fire inside "_Pvt".
  const line = (raw.split(/\r?\n/)[0] ?? '')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/_/g, ' ');

  const cut = firstMarkerIndex(line);
  const head = tidy(cut === -1 ? line : line.slice(0, cut));
  if (head) return head;

  // A marker opened the label. Metadata usually still trails the name
  // ("Mast-1 80m … Pvt. Mast" — the mast really is named "Mast-1"), so peel
  // the tail first.
  const whole = tidy(line);
  const peeledTail = stripMarkersFromEnd(line, 'trailing');

  // If what's left STILL opens with a never-a-name token, the real name
  // trails the markers instead ("Pvt. WM-Humbarne", "Pvt. WM- Sailana").
  if (startsWithStrongMarker(peeledTail)) {
    const rest = tidy(stripMarkersFromEnd(peeledTail, 'leading'));
    if (rest.length >= MIN_NAME_LENGTH) return rest;
  }

  const tail = tidy(peeledTail);
  if (tail && tail !== whole) return tail;

  // Degenerate label ("Pvt. WM-2") — the tidied whole beats a bare "2".
  return whole || raw.trim();
}
