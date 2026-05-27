#!/usr/bin/env python3
"""
extract_facts.py — synthetic fact-chunk extractor for the Indian Windpower
directory PDFs.

WHY THIS EXISTS
---------------
Docling's table extraction collapses several of the directory's key reference
tables: a manufacturer's entire row of FY-by-FY values lands in a single cell
as a whitespace-delimited string of numbers (e.g. "4918 5255.290 639 954.600
720 1160.850 218 414.750 227 403.050 226 441.950 435 900.100 847 1778.700").

With column structure destroyed, the LLM at query time can find the right
table chunk but cannot reliably map numbers to fiscal years. The result is
"no data for 2016" when the data is literally in the retrieved chunk.

This module parses those known-structured tables positionally — we hardcode
each table's column count and column order based on the directory's stable
layout, regex-extract every number from each manufacturer/state row, and
emit one clean fact paragraph per (manufacturer, period) or
(manufacturer, state) pair.

The fact paragraphs become additional Chunk objects in ingest_one.py —
each is small, semantically focused, embeds well against direct questions
("How many turbines did Suzlon install in FY 2016-17?"), and is human-
verifiable by reading the .facts.jsonl dump.

TABLES PARSED
-------------
1. Make & Year-wise WEG Installations (Presently Active) — 17 fiscal years
   (Upto Mar 2010 + FY 2010-11 … FY 2024-25), 16-ish active manufacturers,
   one row each. Plus a continuation table with FY 2017-18 … FY 2024-25 + TOTAL.
2. (added later) State & Make-wise WEG Installations — cumulative table
   with active and inactive manufacturer halves.

VERIFICATION
------------
Each parser logs a warning + skips its row when the number count doesn't
match the expected column count. Wrong data is worse than missing data.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional


# Column order for the Active Make&Year-wise table, first half page.
# Confirmed against Suzlon's row: 8 pairs of (No., MW) values map cleanly
# to these 8 fiscal years.
MAKE_YEAR_FIRST_HALF_FYS = [
    "Upto Mar 2010",
    "FY 2010-11",
    "FY 2011-12",
    "FY 2012-13",
    "FY 2013-14",
    "FY 2014-15",
    "FY 2015-16",
    "FY 2016-17",
]

# Continuation page — 8 fiscal years + a TOTAL column. 9 pairs of values.
MAKE_YEAR_CONTINUATION_FYS = [
    "FY 2017-18",
    "FY 2018-19",
    "FY 2019-20",
    "FY 2020-21",
    "FY 2021-22",
    "FY 2022-23",
    "FY 2023-24",
    "FY 2024-25",
    "TOTAL",  # cumulative across all fiscal years in the table
]

# Section heading we anchor the Active table parse on. The PDF's HTML-
# entity-encoded "&amp;" is what Docling exports — keep it literal.
MAKE_YEAR_ACTIVE_HEADING = (
    "## Make &amp; Year-wise WEG Installations in India (By WEG Manufacturers Presently Active)"
)

# Regex: a row starts with `| <idx>. <name>` for the first half (with manufacturer
# name) or `| <idx>.` followed by mostly-empty columns for the continuation.
ROW_FIRST_HALF_RE = re.compile(r"^\|\s*(\d+)\.\s+([A-Za-z][^|]*?)\s*\|(.+)$")
ROW_CONTINUATION_RE = re.compile(r"^\|\s*(\d+)\.\s*\|(.+)$")

# Regex to pull every numeric value (integers and decimals) out of a row.
# Also handles HTML entity `&#124;` (pipe) appearing inside cells.
NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


@dataclass
class Fact:
    """One synthetic fact chunk, ready to embed."""
    kind: str       # 'make-year' | 'state-make' | ...
    key: str        # stable identifier (e.g. 'make-year:Suzlon:FY 2016-17')
    text: str       # the prose fact (what gets embedded)
    section: str    # source section heading from the PDF
    year: int       # directory year (e.g. 2025), used as Qdrant payload filter


def _normalize_name(name: str) -> str:
    """Clean a manufacturer/entity name: strip stars, trailing punctuation,
    HTML entities, and collapse whitespace. Examples:
      '14. Suzlon          ' -> 'Suzlon'
      '15.| Vestas Wind'     -> 'Vestas Wind'
    """
    n = name.replace("&amp;", "&").replace("&#124;", "|")
    n = re.sub(r"^\s*\d+\.\s*\|?\s*", "", n)   # leading index
    n = re.sub(r"\s+", " ", n).strip(" |.")
    return n


def _extract_numbers(row_data: str) -> List[float]:
    """Pull every number out of a row's cell-content area. We treat the
    integer-vs-float distinction at the consumer; here we just return floats
    preserving order."""
    cleaned = row_data.replace("&#124;", " ").replace("|", " ")
    return [float(m.group(0)) for m in NUMBER_RE.finditer(cleaned)]


def parse_make_year_active(md: str, year: int) -> List[Fact]:
    """Parse the Active Make&Year-wise table.

    The table appears in two halves separated by a 'Contd.......' marker and
    a page break. Both halves share the same manufacturer indices (1, 2, ...,
    N), so we collect rows from each half keyed by index and merge.
    """
    # Find the section by heading. Section runs until the next H2 heading.
    start = md.find(MAKE_YEAR_ACTIVE_HEADING)
    if start == -1:
        return []
    # Section body ends at the next "## " heading (any subject).
    end_match = re.search(r"^## ", md[start + len(MAKE_YEAR_ACTIVE_HEADING):], re.MULTILINE)
    end = start + len(MAKE_YEAR_ACTIVE_HEADING) + (end_match.start() if end_match else len(md))
    body = md[start:end]

    # Split on 'Contd.' (case-insensitive, allowing variable dot counts) to
    # separate first-half from continuation. The Active section in 2025
    # contains exactly one such break.
    halves = re.split(r"(?im)^\s*Contd\.+\s*$", body)
    first_half = halves[0]
    continuation = halves[1] if len(halves) > 1 else ""

    # Pass 1 — first half: rows with manufacturer name + 16 numbers (8 FY pairs).
    first_pairs: dict[int, tuple[str, List[float]]] = {}
    for line in first_half.splitlines():
        m = ROW_FIRST_HALF_RE.match(line)
        if not m:
            continue
        idx = int(m.group(1))
        name = _normalize_name(m.group(2))
        nums = _extract_numbers(m.group(3))
        # Skip totals row and anything that doesn't match the expected count.
        if name.upper() == "TOTAL":
            continue
        first_pairs[idx] = (name, nums)

    # Pass 2 — continuation: rows with index only + 18 numbers (9 FY pairs, incl TOTAL).
    cont_pairs: dict[int, List[float]] = {}
    for line in continuation.splitlines():
        m = ROW_CONTINUATION_RE.match(line)
        if not m:
            continue
        idx = int(m.group(1))
        nums = _extract_numbers(m.group(2))
        cont_pairs[idx] = nums

    facts: List[Fact] = []
    for idx in sorted(first_pairs.keys()):
        name, first_nums = first_pairs[idx]
        cont_nums = cont_pairs.get(idx, [])

        # Validate: first half should have exactly 8 FYs * 2 = 16 numbers.
        # If the row was mostly empty (manufacturer with no installations),
        # we'll get fewer — pad with zeros, but still skip totally-empty rows.
        if len(first_nums) == 0 and len(cont_nums) == 0:
            continue
        if first_nums and len(first_nums) != len(MAKE_YEAR_FIRST_HALF_FYS) * 2:
            print(f"[fact] make-year first half: {name} has {len(first_nums)} nums, "
                  f"expected {len(MAKE_YEAR_FIRST_HALF_FYS) * 2}; skipping that half")
            first_nums = []
        if cont_nums and len(cont_nums) != len(MAKE_YEAR_CONTINUATION_FYS) * 2:
            print(f"[fact] make-year continuation: {name} has {len(cont_nums)} nums, "
                  f"expected {len(MAKE_YEAR_CONTINUATION_FYS) * 2}; skipping that half")
            cont_nums = []

        # Emit one fact per (manufacturer, fy) with non-zero values.
        def emit(fy_list: List[str], nums: List[float]) -> None:
            for i, fy in enumerate(fy_list):
                no = nums[i * 2]
                mw = nums[i * 2 + 1]
                # Skip empty / zero entries — these mean "no installations
                # that year" and would inflate the corpus with noise.
                if no == 0 and mw == 0:
                    continue
                if fy == "TOTAL":
                    text = (
                        f"{name} cumulative total WEG installations in India (all fiscal "
                        f"years through FY 2024-25, as on 31.03.2025) per the Make & "
                        f"Year-wise WEG Installations table in the {year} Indian Windpower "
                        f"Directory: {int(no)} wind turbines / {mw:.3f} MW."
                    )
                else:
                    text = (
                        f"{name} installed {int(no)} wind turbines (Wind Energy Generators, WEGs) "
                        f"with a total capacity of {mw:.3f} MW during {fy} in India, "
                        f"per the Make & Year-wise WEG Installations table (Manufacturers "
                        f"Presently Active) in the {year} Indian Windpower Directory."
                    )
                facts.append(Fact(
                    kind="make-year",
                    key=f"make-year:active:{name}:{fy}",
                    text=text,
                    section="Make & Year-wise WEG Installations in India (By WEG Manufacturers Presently Active)",
                    year=year,
                ))

        if first_nums:
            emit(MAKE_YEAR_FIRST_HALF_FYS, first_nums)
        if cont_nums:
            emit(MAKE_YEAR_CONTINUATION_FYS, cont_nums)

    return facts


def parse_headline_facts(md: str, year: int) -> List[Fact]:
    """Extract headline summary facts that appear as prose in the directory.

    These are the directory's canonical answers to common high-level
    questions (total capacity, manufacturer count, mast count, generation
    figures). The directory often paraphrases the same stat in multiple
    places with conflicting precision — pulling the canonical, dated
    sentence into its own chunk makes retrieval surface the right one.

    Regex-driven so the same patterns work on future-year directories.
    """
    facts: List[Fact] = []

    # 14 manufacturers as on 10.07.2025 (paraphrases include "more than 16")
    m = re.search(
        r"there are\s+(\d+)\s+manufacturers offering WEGs of\s+(\d+)\s+ratings",
        md, re.IGNORECASE,
    )
    if m:
        n_manuf, n_ratings = m.group(1), m.group(2)
        # Pull the as-on date from the same paragraph
        para_start = md.rfind("\n\n", 0, m.start())
        para_end = md.find("\n\n", m.end())
        para = md[max(0, para_start):para_end if para_end != -1 else m.end() + 500]
        date_m = re.search(r"as on\s+([\d.]+)", para, re.IGNORECASE)
        date_str = date_m.group(1) if date_m else "the directory's reference date"
        facts.append(Fact(
            kind="headline",
            key=f"headline:manufacturer-count:{year}",
            text=(
                f"As of {date_str}, there are exactly {n_manuf} wind turbine generator "
                f"(WEG) manufacturers offering wind electric generators in India, "
                f"covering {n_ratings} ratings from 225 kW to 5200 kW, per the "
                f"{year} Indian Windpower Directory's manufacturer list."
            ),
            section="Manufacturer count (canonical headline figure)",
            year=year,
        ))

    # Total installed capacity as on 31.03.YYYY per MNRE
    m = re.search(
        r"total installed capacity of Windpower Projects in India as on\s+([\d.]+)\s+as per MNRE is\s+([\d,]+)\s*MW",
        md, re.IGNORECASE,
    )
    if m:
        date_str, total_mw = m.group(1), m.group(2)
        facts.append(Fact(
            kind="headline",
            key=f"headline:total-capacity:{year}",
            text=(
                f"India's total installed wind power capacity as on {date_str}, "
                f"per the Ministry of New and Renewable Energy (MNRE), is {total_mw} MW. "
                f"This figure is from the {year} Indian Windpower Directory."
            ),
            section="Total installed capacity (canonical headline figure)",
            year=year,
        ))

    # NIWE mast count
    m = re.search(
        r"Total number of masts installed by NIWE is\s+(\d+)",
        md, re.IGNORECASE,
    )
    if m:
        facts.append(Fact(
            kind="headline",
            key=f"headline:niwe-masts:{year}",
            text=(
                f"The National Institute of Wind Energy (NIWE) has installed a total "
                f"of {m.group(1)} wind monitoring masts across India's windy states, "
                f"per the {year} Indian Windpower Directory. The directory does not "
                f"provide a state-by-state breakdown of these masts."
            ),
            section="NIWE wind monitoring masts (canonical headline figure)",
            year=year,
        ))

    # Wind electricity generation during FY YYYY-YY
    m = re.search(
        r"Electricity generation from windpower projects during\s+(\d{4}-\d{2})\s+was\s+([\d,]+)\s+M\.?U",
        md, re.IGNORECASE,
    )
    if m:
        facts.append(Fact(
            kind="headline",
            key=f"headline:wind-generation:{m.group(1)}",
            text=(
                f"Electricity generation from windpower projects in India during "
                f"FY {m.group(1)} was {m.group(2)} Million Units (MU), per the "
                f"{year} Indian Windpower Directory."
            ),
            section="Wind electricity generation (canonical headline figure)",
            year=year,
        ))

    # 150m potential realisation percentage
    m = re.search(
        r"([\d.]+)\s*%\s*of the estimated potential at\s+150\s*m",
        md, re.IGNORECASE,
    )
    if m:
        facts.append(Fact(
            kind="headline",
            key=f"headline:potential-150m:{year}",
            text=(
                f"As of the {year} Indian Windpower Directory's reference date, "
                f"India has realised {m.group(1)}% of its estimated wind power "
                f"potential at 150 m above ground level (agl)."
            ),
            section="Wind potential realisation 150m (canonical headline figure)",
            year=year,
        ))

    return facts


def parse_manufacturer_contributions_prose(md: str, year: int) -> List[Fact]:
    """Extract per-manufacturer FY 2024-25 contributions from the prose
    paragraph that lists every contributing manufacturer.

    The 2025 directory has a sentence: "During 2024-25 M/s GE's contribution
    is 929 MW, M/s Envision's contribution is 838 MW, ..." — 10 manufacturers
    listed with clean MW figures. This single paragraph is the ground truth
    for FY 2024-25 contributions and surfaces cleanly when made into one
    chunk per manufacturer.

    This also serves sparse-row manufacturers (Inox, GE, Adani Green,
    Envision, Sany, Siva) that the table parser can't handle reliably.
    """
    facts: List[Fact] = []

    # Find the introducing fiscal year so the parser still works on next
    # year's directory ("During 2025-26 M/s ...").
    fy_match = re.search(
        r"During\s+(\d{4}-\d{2})\s+M/s\s+\w",
        md, re.IGNORECASE,
    )
    if not fy_match:
        return facts
    fy = fy_match.group(1)

    # Match every "M/s NAME's contribution is N(.NN) MW" mention.
    # Name allows letters, spaces, ampersand, dot, hyphen; trims surrounding
    # whitespace. The leading lookahead `M/s` anchors us to this specific
    # prose structure and avoids false positives elsewhere.
    pattern = re.compile(
        r"M/s\s+([A-Z][A-Za-z][A-Za-z\s&.\-]*?)'s contribution is\s*([\d]+(?:\.\d+)?)\s*MW",
    )
    for m in pattern.finditer(md):
        mfr = re.sub(r"\s+", " ", m.group(1)).strip(" .,-")
        mw = m.group(2)
        facts.append(Fact(
            kind="prose-contribution",
            key=f"prose-contribution:{mfr}:FY {fy}",
            text=(
                f"During FY {fy}, {mfr} contributed {mw} MW of new wind power "
                f"capacity in India, per the {year} Indian Windpower Directory's "
                f"manufacturer-contribution summary paragraph. (This paragraph "
                f"lists 10 manufacturers who contributed during FY {fy}; only "
                f"makers with non-zero contributions are listed.)"
            ),
            section=f"Manufacturer contributions during FY {fy} (canonical prose summary)",
            year=year,
        ))
    return facts


def parse_state_make_totals(md: str, year: int) -> List[Fact]:
    """Extract cumulative-total (TOTAL column) from the State & Make-wise
    WEG Installations table for each manufacturer.

    We tolerate the row's middle cells being a mess; we only need the very
    last 'Total' pair, which Docling consistently puts at the row's end.
    Regex finds rows like '| 14 | Suzlon | ... | 9964 15008.290 |' inside
    the table section and emits one fact per manufacturer.
    """
    facts: List[Fact] = []

    # Find the section spanning the Active+Inactive State&Make-wise tables.
    start_marker = "## State &amp; Make-wise WEG Installations in India (By WEG Manufacturers Presently Active)"
    end_marker_options = [
        "## Make &amp; Year-wise WEG Installations",
        "## Year &amp; Rating-wise",
    ]
    start = md.find(start_marker)
    if start == -1:
        return facts
    end = len(md)
    for em in end_marker_options:
        e = md.find(em, start + len(start_marker))
        if e != -1:
            end = min(end, e)
    body = md[start:end]

    # Row signature: `| <idx> | <Manufacturer Name> | ... | <total_no> <total_mw> |`
    # The last numeric pair on the line is the TOTAL across all states.
    # We accept either the numbered or non-numbered row prefix.
    row_re = re.compile(
        r"^\|\s*(?:\d+\s*\|?\s*)?([A-Z][A-Za-z][A-Za-z\s&.\-/()]*?)\s*\|.+?\|\s*([\d,]+)\s+([\d,]+\.\d+)\s*\|\s*$",
        re.MULTILINE,
    )
    seen: set[str] = set()
    for m in row_re.finditer(body):
        name = re.sub(r"\s+", " ", m.group(1)).strip(" .,-/")
        if name.upper() in {"TOTAL", "MAKE", "MAKE NO", "MAKE NO MW", "NO"}:
            continue
        if name in seen:
            continue
        seen.add(name)
        total_no = m.group(2).replace(",", "")
        total_mw = m.group(3).replace(",", "")
        # Sanity: total_no should be a small-to-large integer.
        try:
            n_int = int(total_no)
            if n_int < 1 or n_int > 100000:
                continue
        except ValueError:
            continue
        facts.append(Fact(
            kind="state-make-total",
            key=f"state-make-total:{name}",
            text=(
                f"{name} has a cumulative total of {n_int} wind turbines installed "
                f"across India with combined capacity of {total_mw} MW, as on "
                f"31.03.2025, per the State & Make-wise WEG Installations table "
                f"in the {year} Indian Windpower Directory."
            ),
            section="State & Make-wise WEG Installations (cumulative totals)",
            year=year,
        ))
    return facts


DEMO_PROJECTS_HEADING = "## Demonstration Windpower Projects in India (Funded by Govt.)"

# States that appear as section-header rows inside the demo-projects table.
DEMO_KNOWN_STATES = {
    "Andhra Pradesh", "Goa", "Gujarat", "Karnataka", "Kerala",
    "Madhya Pradesh", "Maharashtra", "Odisha", "Rajasthan",
    "Tamil Nadu", "West Bengal",
}

# Per-WEG rating string. Tolerates ASCII x/X and Unicode ×; the trailing
# kW is OPTIONAL because OCR frequently strips the unit from cells like
# "4 X 55" (the "kW" lands in the next cell with the manufacturer name).
# Defaulting to kW is safe because every rating in this table is in kW —
# the largest is 1250 kW (Suzlon at Narasimhakonda/Sogi).
DEMO_RATING_RE = re.compile(r"(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:[kK][wW])?")
# Same pattern minus the leading count — used to recover the per-WEG rating
# when OCR dropped only the leading number (e.g. "X 90 KW" at Kaipadar).
DEMO_RATING_KW_ONLY_RE = re.compile(r"[×xX]\s*(\d+(?:\.\d+)?)\s*[kK][wW]")


@dataclass
class _DemoSubrow:
    rating_text: str
    make: str
    date: str
    nos_ocr: str
    mw_ocr: str


@dataclass
class _DemoProject:
    sino: int
    place: str
    state: str
    subrows: List[_DemoSubrow]


def _demo_clean(s: str) -> str:
    return s.replace("&#124;", " ").replace("&amp;", "&").strip()


def _demo_clean_place(s: str) -> str:
    s = _demo_clean(s)
    # OCR routinely renders the table's left-edge pipe as a leading "I " or
    # "l " (e.g. "I Tirumala"). Strip it when followed by a capital — but
    # only the single-letter form, to avoid mangling real names.
    s = re.sub(r"^[Il]\s+(?=[A-Z])", "", s)
    return s.strip()


def _demo_parse_cells(line: str) -> Optional[List[str]]:
    s = line.strip()
    if not s.startswith("|") or not s.endswith("|"):
        return None
    return [_demo_clean(c) for c in s[1:-1].split("|")]


def _demo_is_separator(cells: List[str]) -> bool:
    return all(set(c.strip()) <= {"-", ":", ""} for c in cells)


def _demo_is_header(cells: List[str]) -> bool:
    joined = " ".join(c.lower() for c in cells)
    return (
        "si. no" in joined or "sl. no" in joined or
        "rating of weg" in joined or
        "month/ year" in joined or "month / year" in joined
    )


def _demo_parse_int(s: str) -> Optional[int]:
    s = s.replace(",", "").strip()
    return int(s) if s.isdigit() else None


def _demo_parse_float(s: str) -> Optional[float]:
    s = s.replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _demo_project_totals(p: _DemoProject) -> tuple[int, float]:
    """Best-effort (total_wegs, total_mw) for one project.

    Strategy: prefer summing per-sub-row ratings (N × kW), since the OCR'd
    Total Nos. column is unreliable ("1" misread as "T", "7" as "1", etc).
    If any sub-row's rating string didn't parse, fall back to the last
    populated OCR'd MW cell (which is empirically more readable than the
    Nos. column) and use the OCR'd Nos. only if it exceeds our running sum
    and looks like a plausible integer.
    """
    total_n = 0
    total_mw = 0.0
    all_ratings_parsed = True
    for sr in p.subrows:
        m = DEMO_RATING_RE.search(sr.rating_text)
        if m:
            n = int(m.group(1))
            kw = float(m.group(2))
            total_n += n
            total_mw += n * kw / 1000.0
        elif sr.rating_text or sr.make:
            all_ratings_parsed = False

    if not all_ratings_parsed:
        last_mw: Optional[float] = None
        for sr in p.subrows:
            mw = _demo_parse_float(sr.mw_ocr)
            if mw is not None:
                last_mw = mw
        if last_mw is not None:
            total_mw = last_mw
        for sr in p.subrows:
            n = _demo_parse_int(sr.nos_ocr)
            if n is not None and n > total_n and n <= 500:
                total_n = n
        # Last-resort count inference: if we still have 0 count but a positive
        # MW total, extract the per-WEG kW rating from any sub-row's text and
        # derive count = MW * 1000 / kW. Handles "X 90 KW Vestas..." rows
        # where OCR dropped the leading count and the Total Nos. cell.
        if total_n == 0 and total_mw > 0:
            for sr in p.subrows:
                m = DEMO_RATING_KW_ONLY_RE.search(sr.rating_text + " " + sr.make)
                if m:
                    kw = float(m.group(1))
                    if kw > 0:
                        total_n = max(1, round(total_mw * 1000.0 / kw))
                        break

    return total_n, round(total_mw, 3)


def _demo_format_subrow(sr: _DemoSubrow) -> str:
    parts: List[str] = []
    m = DEMO_RATING_RE.search(sr.rating_text)
    if m:
        parts.append(f"{m.group(1)}×{m.group(2)} kW")
    elif sr.rating_text:
        parts.append(sr.rating_text)
    if sr.make:
        parts.append(sr.make)
    if sr.date:
        parts.append(f"commissioned {sr.date}")
    return " ".join(parts)


def parse_demonstration_projects(md: str, year: int) -> List[Fact]:
    """Parse the 'Demonstration Windpower Projects in India (Funded by Govt.)'
    table.

    The table lists 40 government-funded demo sites across 11 states. Each
    project spans 1–3 markdown rows (one row per WEG type at that site);
    state names appear as cell-2-only separator rows. Docling collapses
    several rating cells (e.g. '5 X 110 kW' split across two cols, or the
    leading count dropped entirely on the second sub-row of a project), and
    the per-project Total Nos. column is heavily OCR-corrupted — so prose
    retrieval over the raw chunks consistently misses most entries.

    We emit two kinds of facts:
      1. One per project (40 facts) — for targeted lookups like "what was
         installed at Kheda?".
      2. One **summary listing** containing all 40 projects in compact form.
         Critical for enumeration queries ("list all demonstration projects
         funded by government"): a single retrieval gets the whole list,
         instead of depending on top-K stitching of 3-4 fragmented table
         chunks whose contents the LLM can't fully parse.
    """
    start = md.find(DEMO_PROJECTS_HEADING)
    if start == -1:
        return []
    rest = md[start + len(DEMO_PROJECTS_HEADING):]
    end_match = re.search(r"^## ", rest, re.MULTILINE)
    end = start + len(DEMO_PROJECTS_HEADING) + (end_match.start() if end_match else len(rest))
    body = md[start:end]

    projects: List[_DemoProject] = []
    current_state: Optional[str] = None
    current: Optional[_DemoProject] = None

    for line in body.splitlines():
        cells = _demo_parse_cells(line)
        if cells is None or _demo_is_separator(cells) or _demo_is_header(cells):
            continue
        if not any(c.strip() for c in cells):
            continue
        cells = (cells + [""] * 10)[:10]
        sino_cell = cells[0].strip()
        place_cell = _demo_clean_place(cells[1])

        # State separator row: col 0 empty, col 1 a known state, rest empty.
        if (not sino_cell and place_cell in DEMO_KNOWN_STATES
                and not any(c.strip() for c in cells[2:6])):
            current_state = place_cell
            continue

        # Grand TOTAL row — end of table.
        if any(c.strip().upper() == "TOTAL" for c in cells[:5]):
            break

        sino_int = _demo_parse_int(sino_cell)
        # OCR-dropped-SI.No recovery: col 0 empty, col 1 has a place name
        # (not a known state, starts with a capital), and the row carries a
        # rating or make field. Several projects (Lamba=8, Dahanu=22,
        # Gudepanchgani=24 in the 2025 directory) lose their digit to OCR
        # and would otherwise be silently merged into the previous project's
        # sub-rows. Auto-assign sino = last_sino + 1, which is correct as
        # long as the table's row order is preserved (it is).
        if (sino_int is None and place_cell
                and place_cell not in DEMO_KNOWN_STATES
                and re.match(r"^[A-Z]", place_cell)
                and (cells[4].strip() or cells[2].strip() or cells[3].strip())):
            sino_int = (projects[-1].sino + 1) if projects else 1

        if sino_int is not None:
            current = _DemoProject(
                sino=sino_int,
                place=place_cell or "(unknown)",
                state=current_state or "(unknown)",
                subrows=[],
            )
            projects.append(current)

        if current is None:
            continue

        rating_text = (cells[2] + " " + cells[3]).strip()
        make = cells[4].strip(" |").strip()
        date = cells[5].strip()
        nos = cells[6].strip()
        mw = cells[7].strip()

        if rating_text or make or date or nos or mw:
            current.subrows.append(_DemoSubrow(
                rating_text=rating_text,
                make=make,
                date=date,
                nos_ocr=nos,
                mw_ocr=mw,
            ))

    facts: List[Fact] = []
    summary_lines: List[str] = []

    for p in projects:
        n_wegs, mw = _demo_project_totals(p)
        details = "; ".join(
            _demo_format_subrow(sr) for sr in p.subrows
            if sr.rating_text or sr.make or sr.date
        )
        text = (
            f"Government-funded demonstration windpower project SI.No {p.sino} — "
            f"{p.place} ({p.state}), per the Demonstration Windpower Projects in "
            f"India (Funded by Govt.) table in the {year} Indian Windpower "
            f"Directory (as on 31.03.2025). Installed equipment: {details}. "
            f"Total at this site: {n_wegs} WEGs / {mw:.3f} MW."
        )
        facts.append(Fact(
            kind="demo-project",
            key=f"demo-project:{p.sino}:{p.place}",
            text=text,
            section="Demonstration Windpower Projects in India (Funded by Govt.)",
            year=year,
        ))
        summary_lines.append(
            f"{p.sino}. {p.place} ({p.state}) — {n_wegs} WEGs / {mw:.3f} MW"
        )

    if summary_lines:
        summary_text = (
            f"Complete list of all {len(summary_lines)} government-funded "
            f"demonstration windpower projects in India, per the Demonstration "
            f"Windpower Projects in India (Funded by Govt.) table in the {year} "
            f"Indian Windpower Directory (as on 31.03.2025). The directory's "
            f"TOTAL row gives an aggregate of 396 WEGs and 73.165 MW across "
            f"these projects, established at sites in 11 states (Andhra Pradesh, "
            f"Goa, Gujarat, Karnataka, Kerala, Madhya Pradesh, Maharashtra, "
            f"Odisha, Rajasthan, Tamil Nadu, West Bengal). Each entry below is "
            f"formatted as 'SI.No. Place (State) — total WEGs / total MW':\n\n"
            + "\n".join(summary_lines)
        )
        facts.append(Fact(
            kind="demo-summary",
            key=f"demo-summary:all:{year}",
            text=summary_text,
            section="Demonstration Windpower Projects in India (Funded by Govt.) — complete list",
            year=year,
        ))

    return facts


def parse_state_wise_installed(md: str, year: int) -> List[Fact]:
    """Parse the State-wise Windpower Installed Capacity table (cumulative).

    The cleanest table in the directory — 4 columns: State, Demonstration MW,
    Commercial MW, Total MW. Emits one fact per state with the official
    MNRE/SNA total as of 31.03.YYYY, plus an all-India total fact.
    """
    facts: List[Fact] = []
    start = md.find("## State-wise Windpower Installed Capacity in India")
    if start == -1:
        return facts
    end = md.find("\n## ", start + 1)
    body = md[start:end if end != -1 else len(md)]

    # Pull as-on date if present. The 2025 directory has an OCR fluke "37.03.2025"
    # in this section — restore to 31.03 since 37 is impossible.
    date_m = re.search(r"As on\s+([\d.]+)", body)
    as_on = (date_m.group(1).replace("37.", "31.") if date_m else f"31.03.{year}")

    # Row: `| State Name | demo MW | commercial MW | total MW |`
    row_re = re.compile(
        r"^\|\s*([A-Z][A-Za-z][A-Za-z\s&.\-/()]*?)\s*\|\s*([\d,.]*)\s*\|\s*([\d,.]*)\s*\|\s*([\d,.]+)\s*\|\s*$",
        re.MULTILINE,
    )
    for m in row_re.finditer(body):
        state = re.sub(r"\s+", " ", m.group(1)).strip()
        total = m.group(4).replace(",", "")
        try:
            float(total)
        except ValueError:
            continue
        if state.upper() in {"STATE", "MAKE"} or len(state) < 3:
            continue
        commercial = m.group(3).replace(",", "")
        demo = m.group(2).replace(",", "")
        if state.lower() == "total (all india)" or "all india" in state.lower():
            facts.append(Fact(
                kind="state-installed",
                key=f"state-installed:All India:{year}",
                text=(
                    f"India's all-India total cumulative installed wind power capacity "
                    f"as on {as_on} is {total} MW (Commercial Projects: {commercial} MW + "
                    f"Demonstration Projects: {demo} MW), summed across all states from "
                    f"the State-wise Windpower Installed Capacity table in the {year} "
                    f"Indian Windpower Directory."
                ),
                section="State-wise Windpower Installed Capacity (canonical state totals)",
                year=year,
            ))
            continue
        if state.lower() == "others":
            continue
        facts.append(Fact(
            kind="state-installed",
            key=f"state-installed:{state}:{year}",
            text=(
                f"{state}'s total cumulative installed wind power capacity as on "
                f"{as_on} is {total} MW (Commercial Projects: {commercial} MW + "
                f"Demonstration Projects: {demo} MW), per the State-wise Windpower "
                f"Installed Capacity table in the {year} Indian Windpower Directory."
            ),
            section="State-wise Windpower Installed Capacity",
            year=year,
        ))
    return facts


# Column order for "State & Make-wise Installation of Windpower Projects in
# India during 2024-25" — current-year-only by-state table. Only 5 states
# had installations in FY 2024-25.
STATE_MAKE_FY_STATES = [
    "Andhra Pradesh",
    "Gujarat",
    "Karnataka",
    "Maharashtra",
    "Tamil Nadu",
]


def parse_state_make_2024_25(md: str, year: int) -> List[Fact]:
    """Parse the State & Make-wise Installation table for the CURRENT FY.

    Columns: SI / Make / AP / Gujarat / Karnataka / Maharashtra / Tamil Nadu /
    Total — all MW values. Emits one fact per (manufacturer, state) with
    non-zero installation, plus one per-manufacturer summary across states.
    """
    facts: List[Fact] = []
    heading = "## State &amp; Make-wise Installation of Windpower Projects in India"
    start = md.find(heading)
    if start == -1:
        return facts
    # Section runs until the next H2 — but the table itself ends before the
    # "(Source ...)" line. We use the next "##" or "(Source" boundary.
    end = md.find("\n## ", start + 1)
    body = md[start:end if end != -1 else len(md)]

    fy_match = re.search(r"during the year\s+(\d{4}-\d{2})", body, re.IGNORECASE)
    fy = fy_match.group(1) if fy_match else f"{year - 1}-{str(year)[-2:]}"

    # Match `| <idx>. | <Manufacturer> | <AP> | <Gujarat> | <Karnataka> | <MH> | <TN> | <Total> |`
    row_re = re.compile(
        r"^\|\s*\d+\.\s*\|\s*([A-Z][A-Za-z][A-Za-z\s&.\-/()]*?)\s*\|"
        r"\s*([\d,.]*)\s*\|\s*([\d,.]*)\s*\|\s*([\d,.]*)\s*\|"
        r"\s*([\d,.]*)\s*\|\s*([\d,.]*)\s*\|\s*([\d,.]+)\s*\|\s*$",
        re.MULTILINE,
    )
    for m in row_re.finditer(body):
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        if name.upper() == "TOTAL":
            continue
        per_state_raw = [m.group(i).replace(",", "").strip() for i in range(2, 7)]
        total_mw = m.group(7).replace(",", "")
        installed: list[tuple[str, str]] = []
        for st, mw in zip(STATE_MAKE_FY_STATES, per_state_raw):
            if not mw:
                continue
            try:
                if float(mw) <= 0:
                    continue
            except ValueError:
                continue
            installed.append((st, mw))
            facts.append(Fact(
                kind="state-make-fy",
                key=f"state-make-fy:{name}:{st}:FY {fy}",
                text=(
                    f"During FY {fy}, {name} installed {mw} MW of new wind power "
                    f"capacity in {st} state, per the State & Make-wise Installation "
                    f"table in the {year} Indian Windpower Directory."
                ),
                section=f"State & Make-wise Installation during FY {fy}",
                year=year,
            ))
        if installed:
            states_summary = "; ".join(f"{s}: {mw} MW" for s, mw in installed)
            facts.append(Fact(
                kind="state-make-fy-summary",
                key=f"state-make-fy-summary:{name}:FY {fy}",
                text=(
                    f"{name}'s total installation during FY {fy} was {total_mw} MW "
                    f"across the following states: {states_summary}. From the State "
                    f"& Make-wise Installation table in the {year} Indian Windpower "
                    f"Directory."
                ),
                section=f"State & Make-wise Installation during FY {fy} (per-manufacturer summary)",
                year=year,
            ))
    return facts


def extract_all_facts(md: str, year: int) -> List[Fact]:
    """Top-level entry. Returns every fact for the given parsed markdown."""
    facts: List[Fact] = []
    facts.extend(parse_headline_facts(md, year))
    facts.extend(parse_manufacturer_contributions_prose(md, year))
    facts.extend(parse_state_make_totals(md, year))
    facts.extend(parse_state_wise_installed(md, year))
    facts.extend(parse_state_make_2024_25(md, year))
    facts.extend(parse_make_year_active(md, year))
    facts.extend(parse_demonstration_projects(md, year))
    return facts


# ─── CLI for debugging ─────────────────────────────────────────────────────

def _main() -> None:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("markdown", type=Path)
    ap.add_argument("year", type=int)
    ap.add_argument("--grep", help="Substring filter on the emitted fact text")
    args = ap.parse_args()

    md = args.markdown.read_text(encoding="utf-8")
    facts = extract_all_facts(md, args.year)
    print(f"emitted {len(facts)} facts")
    needle = args.grep.lower() if args.grep else None
    shown = 0
    for f in facts:
        if needle and needle not in f.text.lower():
            continue
        print(json.dumps(asdict(f), ensure_ascii=False))
        shown += 1
    if needle:
        print(f"-- {shown} match --grep {args.grep!r}")


if __name__ == "__main__":
    _main()
