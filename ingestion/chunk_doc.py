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


# ── ID generation ─────────────────────────────────────────────────────
def chunk_id(source_file: str, idx: int, text: str) -> str:
    h = hashlib.sha1(f"{source_file}::{idx}::{text}".encode("utf-8"))
    return h.hexdigest()


# ── Section prefix ─────────────────────────────────────────────────────
def section_prefix(year: int, section_path: list[str], table_caption: str | None = None) -> str:
    section = " / ".join(section_path) if section_path else "(no section)"
    if table_caption:
        # Caption already includes its own punctuation; strip trailing dot if any.
        cap = table_caption.rstrip(". ")
        return f"Year: {year}. Section: {section}. Table: {cap}."
    return f"Year: {year}. Section: {section}."


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


def render_table_md(header_rows: list[list[str]], data_rows: list[list[str]]) -> str:
    """Render with one or more header rows followed by data rows.

    Markdown only supports a single header row syntactically, so we put the
    FIRST header row in the markdown header and additional header rows as
    the first data rows (visually identical to GFM table rendering). The
    LLM and the embedder read the entire block as a unit anyway."""
    def esc(s: str) -> str:
        return s.replace("|", "\\|").replace("\n", " ")
    all_rows = header_rows + data_rows
    if not all_rows:
        return ""
    width = max(len(r) for r in all_rows)
    def pad(r: list[str]) -> list[str]:
        return list(r) + [""] * (width - len(r))
    out = []
    # First header row -> markdown header
    out.append("| " + " | ".join(esc(c) for c in pad(header_rows[0])) + " |")
    out.append("|" + "|".join(["---"] * width) + "|")
    # Remaining header rows (if any) rendered as the first body rows
    for hr in header_rows[1:]:
        out.append("| " + " | ".join(esc(c) for c in pad(hr)) + " |")
    for dr in data_rows:
        out.append("| " + " | ".join(esc(c) for c in pad(dr)) + " |")
    return "\n".join(out)


def chunk_table(
    element: dict,
    source_file: str,
    year: int,
    next_idx: int,
) -> tuple[list[dict], int]:
    """Convert a `table` element to one or more chunk records.

    Returns (chunks, new_next_idx)."""
    all_rows: list[list[str]] = element["rows"]
    header_row_count = find_header_row_count(all_rows, element.get("header_row_index", 0))
    header_rows = all_rows[:header_row_count]
    data_rows = all_rows[header_row_count:]
    n_data = len(data_rows)
    caption = element["caption"]
    section_path = element["section_path"]

    chunks: list[dict] = []
    if n_data <= TABLE_SINGLE_CHUNK_MAX_ROWS:
        body = render_table_md(header_rows, data_rows)
        prefix = section_prefix(year, section_path, caption)
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
            },
        })
        return chunks, next_idx + 1

    # >25 rows → split. Each chunk repeats ALL header rows + a continuation marker.
    n_groups = (n_data + TABLE_SPLIT_ROW_GROUP - 1) // TABLE_SPLIT_ROW_GROUP
    for g in range(n_groups):
        lo = g * TABLE_SPLIT_ROW_GROUP
        hi = min(lo + TABLE_SPLIT_ROW_GROUP, n_data)
        group_rows = data_rows[lo:hi]
        marker = f"(Table continued — data rows {lo + 1}-{hi} of {n_data})"
        body = render_table_md(header_rows, group_rows)
        prefix = section_prefix(year, section_path, caption)
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
            },
        })
        next_idx += 1
    # First chunk in a split group is a proper "table"; subsequent are "table_continuation".
    if chunks:
        chunks[0]["type"] = "table"
    return chunks, next_idx


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
            # A table's title_context paragraphs are already embedded in the
            # table chunk's caption. Drop any pending prose that overlaps
            # with title_context so it doesn't also become its own tiny
            # prose chunk right before the table.
            tc = set(el.get("title_context") or [])
            if tc and pending_prose:
                pending_prose = [p for p in pending_prose if p not in tc]
            flush()
            current_section = el["section_path"]
            tab_chunks, next_idx = chunk_table(el, source_file, year, next_idx)
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
