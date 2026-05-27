#!/usr/bin/env python3
"""chunk_doc.py — Phase 2 chunker. elements.jsonl -> chunks.jsonl.

Per the spec:
    - Tables are atomic-ish: <=25 rows = one chunk; >25 rows = split into
      groups of ~20 data rows, with the header row repeated at the top
      of every continuation chunk plus a "(rows X-Y of N)" marker.
    - Prose chunks: paragraphs grouped under the same section, target
      ~500 tokens, hard max 800. Break on paragraph boundaries.
    - Headings are not their own chunks; they live in section_path.
    - Every chunk text is prefixed:
          Year: <N>. Section: <heading>.            (prose)
          Year: <N>. Section: <heading>. Table: <caption>.  (table)
    - Chunk ID = sha1(source_file + "::" + idx + "::" + text). Deterministic
      — re-running on the same source produces identical IDs and upserts
      overwrite cleanly.

Multi-row header detection:
    Some tables in this corpus have 2-row headers (top row spans merged
    super-columns, second row holds sub-labels). We detect this by
    looking at the first column: header rows have non-numbered first
    cells ("Sl. No.", "No.", ""); data rows start when first cell matches
    /^\\d+[.)]?\\s*$/. All detected header rows are repeated at the top of
    every continuation chunk so retrievals don't surface orphan rows.

Usage:
    python chunk_doc.py <elements.jsonl> [--out chunks.jsonl]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ── Tokenizer ──────────────────────────────────────────────────────────
# text-embedding-3-small uses cl100k_base. We use the same encoding here
# so our token budgets match what the embedder will actually charge.
import tiktoken
_ENC = tiktoken.get_encoding("cl100k_base")


def n_tokens(s: str) -> int:
    return len(_ENC.encode(s, disallowed_special=()))


# ── Constants ──────────────────────────────────────────────────────────
PROSE_TARGET_TOKENS = 500
PROSE_MAX_TOKENS = 800
PROSE_MIN_TOKENS = 50  # drop tinier prose chunks; the spec calls them out as bad
TABLE_SINGLE_CHUNK_MAX_ROWS = 25  # spec rule
TABLE_SPLIT_ROW_GROUP = 20         # spec rule

DATA_ROW_FIRST_CELL_RE = re.compile(r"^\s*\d+[.)]?\s*$")

# Indian states + UTs as they appear in source docs (uppercase). Used to detect
# in-table state-divider rows in the WRA mast tables: those tables have NO
# state column, just a row that says "ANDHRA PRADESH" / "RAJASTHAN" etc. acting
# as a section divider for the mast records that follow.
INDIAN_STATES = {
    "ANDAMAN & NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH",
    "ASSAM", "BIHAR", "CHHATTISGARH", "GOA", "GUJARAT", "HARYANA",
    "HIMACHAL PRADESH", "JAMMU AND KASHMIR", "JAMMU & KASHMIR", "JHARKHAND",
    "KARNATAKA", "KERALA", "LADAKH", "LAKSHADWEEP", "MADHYA PRADESH",
    "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND",
    "ODISHA", "ORISSA", "PUDUCHERRY", "PONDICHERRY", "PUNJAB", "RAJASTHAN",
    "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH",
    "UTTARAKHAND", "WEST BENGAL", "DAMAN & DIU", "DADRA AND NAGAR HAVELI",
    "DELHI", "CHANDIGARH", "DADRA & NAGAR HAVELI",
}
STATE_CANONICAL = {s: s.title() for s in INDIAN_STATES}
# Manual fixes for canonical names
STATE_CANONICAL["TAMIL NADU"] = "Tamil Nadu"
STATE_CANONICAL["ANDHRA PRADESH"] = "Andhra Pradesh"
STATE_CANONICAL["MADHYA PRADESH"] = "Madhya Pradesh"
STATE_CANONICAL["UTTAR PRADESH"] = "Uttar Pradesh"
STATE_CANONICAL["HIMACHAL PRADESH"] = "Himachal Pradesh"
STATE_CANONICAL["ARUNACHAL PRADESH"] = "Arunachal Pradesh"
STATE_CANONICAL["WEST BENGAL"] = "West Bengal"
STATE_CANONICAL["ANDAMAN & NICOBAR ISLANDS"] = "Andaman & Nicobar Islands"
STATE_CANONICAL["JAMMU AND KASHMIR"] = "Jammu and Kashmir"
STATE_CANONICAL["JAMMU & KASHMIR"] = "Jammu and Kashmir"
STATE_CANONICAL["DAMAN & DIU"] = "Daman & Diu"
STATE_CANONICAL["DADRA AND NAGAR HAVELI"] = "Dadra and Nagar Haveli"
STATE_CANONICAL["DADRA & NAGAR HAVELI"] = "Dadra and Nagar Haveli"
STATE_CANONICAL["PONDICHERRY"] = "Puducherry"
STATE_CANONICAL["ORISSA"] = "Odisha"


def detect_state_marker(row: list[str]) -> str | None:
    """Return canonical state name if this row is a state-name divider.

    A divider row has its content in 1-3 cells (usually merged) and that
    content is an all-caps state name. Other cells are blank."""
    non_empty = [c.strip() for c in row if c and c.strip()]
    if not non_empty or len(non_empty) > 3:
        return None
    for cell in non_empty:
        candidate = cell.upper().strip()
        if candidate in INDIAN_STATES:
            return STATE_CANONICAL[candidate]
    return None


def states_in_rows(rows: list[list[str]]) -> list[str]:
    """List of states whose divider appears in the given rows. Preserves
    first-seen order so chunk metadata is stable across re-runs."""
    seen: list[str] = []
    seen_set: set[str] = set()
    for r in rows:
        s = detect_state_marker(r)
        if s and s not in seen_set:
            seen.append(s)
            seen_set.add(s)
    return seen


# ── ID generation ─────────────────────────────────────────────────────
def chunk_id(source_file: str, idx: int, text: str) -> str:
    h = hashlib.sha1(f"{source_file}::{idx}::{text}".encode("utf-8"))
    return h.hexdigest()


# ── Section prefix ─────────────────────────────────────────────────────
def section_prefix(year: int, section_path: list[str], table_caption: str | None = None, states: list[str] | None = None) -> str:
    section = " / ".join(section_path) if section_path else "(no section)"
    parts = [f"Year: {year}", f"Section: {section}"]
    if states:
        # Surfaced into the embedded text so 'Rajasthan masts' queries can
        # actually rank these chunks. In WRA mast tables the state is encoded
        # ONLY as an in-table divider row — without this, the embedder has
        # no signal connecting 'Rajasthan' to chunks containing its masts.
        parts.append(f"States: {', '.join(states)}")
    if table_caption:
        cap = table_caption.rstrip(". ")
        parts.append(f"Table: {cap}")
    return ". ".join(parts) + "."


# ── Table chunking ─────────────────────────────────────────────────────
def find_header_row_count(rows: list[list[str]], default_header_idx: int) -> int:
    """Return the number of leading rows that are header rows.

    Strategy:
      1. Walk rows. The first row whose first cell matches /^\\d+[.)]?\\s*$/
         is the start of data — header rows are everything before it.
      2. If no numbered marker is found anywhere, fall back to
         `default_header_idx + 1` (single header row at the marked position).
    """
    for i, row in enumerate(rows):
        if not row:
            continue
        first = row[0] if row else ""
        if DATA_ROW_FIRST_CELL_RE.match(first):
            return max(i, default_header_idx + 1)  # at least the spec-marked header
    return max(1, default_header_idx + 1)


def merge_header_rows(header_rows: list[list[str]]) -> list[str]:
    """Collapse N header rows into a single column-merged header.

    Source docs frequently use 2-row headers with merged super-columns:
        row0:  | ... | Latitude   | Latitude | Latitude | Longitude | ... |
        row1:  | ... | Deg        | Min      | Sec      | Deg       | ... |
    Naive rendering produces visible duplicates and a phantom 'units' row.
    Here we join the per-column header values, dropping consecutive
    duplicates within a column (so "Latitude / Latitude / Deg" becomes
    "Latitude Deg")."""
    if not header_rows:
        return []
    width = max(len(r) for r in header_rows)
    merged: list[str] = []
    for col in range(width):
        seen: list[str] = []
        last: str | None = None
        for r in header_rows:
            cell = r[col].strip() if col < len(r) else ""
            if cell and cell != last:
                seen.append(cell)
                last = cell
        merged.append(" ".join(seen))
    return merged


def render_table_md(header_rows: list[list[str]], data_rows: list[list[str]]) -> str:
    """Render with a single MERGED header row followed by data rows.

    Markdown only supports one header row syntactically, and even visually
    a 2-row header is confusing for both the LLM and the UI. We collapse
    multi-row headers via merge_header_rows() first."""
    def esc(s: str) -> str:
        return s.replace("|", "\\|").replace("\n", " ")
    all_rows = header_rows + data_rows
    if not all_rows:
        return ""
    width = max(len(r) for r in all_rows)
    def pad(r: list[str]) -> list[str]:
        return list(r) + [""] * (width - len(r))
    header = merge_header_rows(header_rows) if header_rows else []
    header = pad(header)
    out = ["| " + " | ".join(esc(c) for c in header) + " |"]
    out.append("|" + "|".join(["---"] * width) + "|")
    for dr in data_rows:
        out.append("| " + " | ".join(esc(c) for c in pad(dr)) + " |")
    return "\n".join(out)


def _row_state_map(rows: list[list[str]], starting_state: str | None = None) -> list[str | None]:
    """For each row, return the state context (the most recent state marker
    seen at or before this row). Used so a chunk whose first row is data
    (not a marker) still knows the state declared in a prior row.

    `starting_state` carries forward from the previous table in the same
    section — WRA mast tables are split across N tables for one state and
    only the first table has the marker."""
    out: list[str | None] = []
    current: str | None = starting_state
    for r in rows:
        s = detect_state_marker(r)
        if s:
            current = s
        out.append(current)
    return out


def _last_state_in_rows(rows: list[list[str]], default: str | None = None) -> str | None:
    """Last state declared anywhere in `rows`. Used to seed the next table's
    starting_state."""
    last = default
    for r in rows:
        s = detect_state_marker(r)
        if s:
            last = s
    return last


def _states_for_chunk(state_map: list[str | None], lo: int, hi: int) -> list[str]:
    """Unique states present (in order) across rows [lo:hi]."""
    seen: list[str] = []
    seen_set: set[str] = set()
    for i in range(lo, hi):
        s = state_map[i]
        if s and s not in seen_set:
            seen.append(s)
            seen_set.add(s)
    return seen


def chunk_table(
    element: dict,
    source_file: str,
    year: int,
    next_idx: int,
    starting_state: str | None = None,
) -> tuple[list[dict], int, str | None]:
    """Convert a `table` element to one or more chunk records.

    `starting_state` is the state context carried from the previous table
    in the same section — used so a Rajasthan continuation table whose
    first row is just data (no divider) still gets tagged Rajasthan.

    Returns (chunks, new_next_idx, last_state_seen)."""
    all_rows: list[list[str]] = element["rows"]
    header_row_count = find_header_row_count(all_rows, element.get("header_row_index", 0))
    header_rows = all_rows[:header_row_count]
    data_rows = all_rows[header_row_count:]
    n_data = len(data_rows)
    caption = element["caption"]
    section_path = element["section_path"]
    # Build a row→state map across the data rows. WRA mast tables have state
    # dividers as rows (no state column). For tables without any state markers
    # this stays all-None and chunks won't get a 'states' tag.
    state_map = _row_state_map(data_rows, starting_state=starting_state)
    final_state = state_map[-1] if state_map else starting_state

    chunks: list[dict] = []
    if n_data <= TABLE_SINGLE_CHUNK_MAX_ROWS:
        states = _states_for_chunk(state_map, 0, n_data)
        body = render_table_md(header_rows, data_rows)
        prefix = section_prefix(year, section_path, caption, states=states or None)
        text = f"{prefix}\n\n{body}"
        chunks.append({
            "id": chunk_id(source_file, next_idx, text),
            "chunk_index": next_idx,
            "source_file": source_file,
            "year": year,
            "section_path": section_path,
            "type": "table",
            "text": text,
            "token_count": n_tokens(text),
            "metadata": {
                "table_index": element["index"],
                "data_rows": n_data,
                "header_row_count": header_row_count,
                "caption": caption,
                "states": states,
            },
        })
        return chunks, next_idx + 1, final_state

    # >25 rows → split. Each chunk repeats ALL header rows + a continuation marker.
    n_groups = (n_data + TABLE_SPLIT_ROW_GROUP - 1) // TABLE_SPLIT_ROW_GROUP
    for g in range(n_groups):
        lo = g * TABLE_SPLIT_ROW_GROUP
        hi = min(lo + TABLE_SPLIT_ROW_GROUP, n_data)
        group_rows = data_rows[lo:hi]
        states = _states_for_chunk(state_map, lo, hi)
        marker = f"(Table continued — data rows {lo + 1}-{hi} of {n_data})"
        body = render_table_md(header_rows, group_rows)
        prefix = section_prefix(year, section_path, caption, states=states or None)
        text = f"{prefix}\n{marker}\n\n{body}"
        chunks.append({
            "id": chunk_id(source_file, next_idx, text),
            "chunk_index": next_idx,
            "source_file": source_file,
            "year": year,
            "section_path": section_path,
            "type": "table" if n_groups == 1 else "table_continuation",
            "text": text,
            "token_count": n_tokens(text),
            "metadata": {
                "table_index": element["index"],
                "data_rows": hi - lo,
                "rows_from": lo + 1,
                "rows_to": hi,
                "of_rows": n_data,
                "group_index": g + 1,
                "of_groups": n_groups,
                "header_row_count": header_row_count,
                "caption": caption,
                "states": states,
            },
        })
        next_idx += 1
    # First chunk in a split group is a proper "table"; subsequent are "table_continuation".
    if chunks:
        chunks[0]["type"] = "table"
    return chunks, next_idx, final_state


# ── Prose chunking ─────────────────────────────────────────────────────
def flush_prose(
    pending: list[str],
    section_path: list[str],
    source_file: str,
    year: int,
    next_idx: int,
) -> tuple[list[dict], int]:
    """Convert accumulated paragraphs to one or more prose chunks.

    Greedy fill: pack paragraphs until adding the next would exceed
    PROSE_MAX_TOKENS, then start a new chunk. If a single paragraph is
    itself >PROSE_MAX_TOKENS, it goes in alone (will warn at run time)."""
    if not pending:
        return [], next_idx
    chunks: list[dict] = []
    prefix = section_prefix(year, section_path)
    prefix_tokens = n_tokens(prefix + "\n\n")

    buf: list[str] = []
    buf_tokens = 0
    for para in pending:
        p_tokens = n_tokens(para)
        if buf and buf_tokens + p_tokens + prefix_tokens > PROSE_MAX_TOKENS:
            text = f"{prefix}\n\n" + "\n\n".join(buf)
            chunks.append(_make_prose_chunk(text, source_file, year, section_path, next_idx, buf_tokens + prefix_tokens))
            next_idx += 1
            buf = []
            buf_tokens = 0
        buf.append(para)
        buf_tokens += p_tokens
        if buf_tokens + prefix_tokens >= PROSE_TARGET_TOKENS:
            text = f"{prefix}\n\n" + "\n\n".join(buf)
            chunks.append(_make_prose_chunk(text, source_file, year, section_path, next_idx, buf_tokens + prefix_tokens))
            next_idx += 1
            buf = []
            buf_tokens = 0
    if buf:
        text = f"{prefix}\n\n" + "\n\n".join(buf)
        chunks.append(_make_prose_chunk(text, source_file, year, section_path, next_idx, buf_tokens + prefix_tokens))
        next_idx += 1
    return chunks, next_idx


def _make_prose_chunk(text, source_file, year, section_path, idx, approx_tokens):
    return {
        "id": chunk_id(source_file, idx, text),
        "chunk_index": idx,
        "source_file": source_file,
        "year": year,
        "section_path": section_path,
        "type": "prose",
        "text": text,
        "token_count": n_tokens(text),  # exact, not approx
        "metadata": {},
    }


def _drop_tiny_prose(chunks: list[dict]) -> list[dict]:
    """Filter prose chunks under PROSE_MIN_TOKENS. Postscripts like
    '(Source: MNRE)' that survive paragraph filtering end up here.
    Information is still in the markdown for human review."""
    return [c for c in chunks if not (c["type"] == "prose" and c["token_count"] < PROSE_MIN_TOKENS)]


# ── Main walk ──────────────────────────────────────────────────────────
YEAR_RE = re.compile(r"(19|20)\d{2}")


def infer_year(source_file: str) -> int | None:
    m = YEAR_RE.search(source_file)
    return int(m.group(0)) if m else None


def chunk_doc(elements_path: Path, out_path: Path, source_file: str | None = None, year: int | None = None) -> dict:
    source_file = source_file or elements_path.stem.replace(".elements", "") + ".docx"
    year = year or infer_year(source_file)
    if year is None:
        sys.exit(f"FATAL: could not infer year from source_file={source_file!r}; pass --year")

    elements: list[dict] = []
    with elements_path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                elements.append(json.loads(line))

    chunks: list[dict] = []
    next_idx = 0
    pending_prose: list[str] = []
    current_section: list[str] = []
    # State context propagates ACROSS sibling tables (WRA mast tables span
    # one state across 1-N tables, with the divider only in the first).
    # Resets when the section path changes.
    running_state: str | None = None
    last_section_key: tuple = ()

    def flush() -> None:
        nonlocal pending_prose, next_idx
        new_chunks, next_idx = flush_prose(pending_prose, current_section, source_file, year, next_idx)
        chunks.extend(new_chunks)
        pending_prose = []

    for el in elements:
        t = el["type"]
        if t == "heading":
            # Heading flushes prose; the heading itself becomes part of
            # downstream section_path (already populated on later elements).
            flush()
            current_section = el["section_path"]
        elif t == "paragraph":
            # If section changed (e.g. unstyled "header" paragraph that
            # bumped section_path), flush so chunks don't span sections.
            if el["section_path"] != current_section and pending_prose:
                flush()
            current_section = el["section_path"]
            pending_prose.append(el["text"])
        elif t == "table":
            tc = set(el.get("title_context") or [])
            if tc and pending_prose:
                pending_prose = [p for p in pending_prose if p not in tc]
            flush()
            current_section = el["section_path"]
            # Reset running_state on section change so a Rajasthan from WRA
            # doesn't leak into an unrelated section's tables.
            section_key = tuple(current_section)
            if section_key != last_section_key:
                running_state = None
                last_section_key = section_key
            tab_chunks, next_idx, running_state = chunk_table(
                el, source_file, year, next_idx, starting_state=running_state,
            )
            chunks.extend(tab_chunks)
        # Images: spec says treat as a known limitation, not a chunk.
        # We logged them in the parse_report; nothing to emit here.
        # other element types ignored
    flush()

    chunks = _drop_tiny_prose(chunks)
    # Re-pack chunk_index so it stays contiguous after the filter. IDs depend
    # on chunk_index, so we must re-hash too.
    for new_idx, c in enumerate(chunks):
        c["chunk_index"] = new_idx
        c["id"] = chunk_id(c["source_file"], new_idx, c["text"])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for c in chunks:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")

    # ── Sanity stats ────────────────────────────────────────────────────
    by_type = {}
    tok_counts: list[int] = []
    table_groups: dict[int, int] = {}
    for c in chunks:
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        tok_counts.append(c["token_count"])
        if c["type"] in ("table", "table_continuation"):
            ti = c["metadata"].get("table_index")
            if ti is not None:
                table_groups[ti] = table_groups.get(ti, 0) + 1
    tok_counts.sort()
    n = len(tok_counts)
    stats = {
        "source_file": source_file,
        "year": year,
        "chunk_count": n,
        "by_type": by_type,
        "table_chunks_per_table": table_groups,
        "token_min": tok_counts[0] if tok_counts else 0,
        "token_max": tok_counts[-1] if tok_counts else 0,
        "token_p50": tok_counts[n // 2] if tok_counts else 0,
        "token_p95": tok_counts[int(n * 0.95)] if tok_counts else 0,
        "token_p99": tok_counts[int(n * 0.99)] if tok_counts else 0,
        "tiny_chunks_lt_50": sum(1 for t in tok_counts if t < 50),
        "huge_chunks_gt_1200": sum(1 for t in tok_counts if t > 1200),
    }
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("elements", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--source-file", help="overrides default derived from filename")
    ap.add_argument("--year", type=int, help="overrides default inferred from filename")
    args = ap.parse_args()
    if not args.elements.exists():
        sys.exit(f"FATAL: not found: {args.elements}")
    out = args.out or args.elements.with_suffix("").with_suffix(".chunks.jsonl")
    # ^ "<stem>.elements.jsonl" -> "<stem>.chunks.jsonl"
    if out.name.endswith(".elements.jsonl"):
        out = out.parent / out.name.replace(".elements.jsonl", ".chunks.jsonl")
    stats = chunk_doc(args.elements, out, source_file=args.source_file, year=args.year)
    print(json.dumps(stats, indent=2))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
