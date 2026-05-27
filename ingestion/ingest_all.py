#!/usr/bin/env python3
"""
ingest_all.py — multi-PDF driver for the wind RAG corpus.

Wraps ingest_one.py with two-phase scheduling:

    Phase A (parallel, CPU-bound): Docling parse each PDF in its own
        worker process. Each call writes its own data/parsed/<stem>.md
        + .docling.json cache. Workers default to 3 — Docling holds
        layout models in memory (~1.5 GB/worker) and this box has 8 GB.

    Phase B (sequential, network-bound): chunk + embed + upsert each
        parsed PDF one at a time. Sequential because Gemini's free tier
        rate-limits gemini-embedding-001; parallel embedders would just
        race each other into 429s.

Discovery walks data/pdfs/ and accepts either layout:
    data/pdfs/<year>/<file>.pdf      (year = parent dir, when integer)
    data/pdfs/<file>.pdf             (year = first 19xx/20xx in name)

Usage:
    python ingest_all.py                       # full pipeline, 3 workers
    python ingest_all.py --workers 4
    python ingest_all.py --dry-run             # parse + chunk only
    python ingest_all.py --parse-only          # phase A only, no embed/upsert
    python ingest_all.py --force-reparse       # ignore parse caches
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import re
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Tuple

from dotenv import load_dotenv

import ingest_one
from ingest_one import (
    PARSED_DIR,
    ROOT,
    chunk_markdown,
    embed_chunks,
    ensure_collection,
    extract_fact_chunks,
    parse_pdf,
    require_env,
    upsert,
)

PDFS_DIR = ROOT / "data" / "pdfs"
# Match 19xx/20xx not adjacent to another digit. `\b` won't do — `_` is
# a word char in regex, so `2025_Open` would fail a trailing `\b`.
YEAR_RE = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")


def extract_year(pdf_path: Path) -> Optional[int]:
    """Year comes from parent dir if it's a 4-digit integer, else from a
    19xx/20xx match in the filename. Returns None if neither works — the
    caller decides whether to skip or fail."""
    parent = pdf_path.parent.name
    if parent.isdigit() and len(parent) == 4:
        return int(parent)
    m = YEAR_RE.search(pdf_path.stem)
    return int(m.group(0)) if m else None


def discover_pdfs(root: Path) -> List[Tuple[Path, int]]:
    """Return [(pdf_path, year), ...] sorted by (year, name). Skips files
    with no derivable year and prints a warning."""
    found: List[Tuple[Path, int]] = []
    skipped: List[Path] = []
    for pdf in sorted(root.rglob("*.pdf")):
        y = extract_year(pdf)
        if y is None:
            skipped.append(pdf)
            continue
        found.append((pdf, y))
    for p in skipped:
        print(f"[discover] WARN: no year derivable from {p.relative_to(root)} — skipping")
    found.sort(key=lambda t: (t[1], t[0].name))
    return found


def _parse_worker(args: Tuple[str, bool]) -> Tuple[str, Optional[str]]:
    """Worker entry point — must be top-level for multiprocessing pickling.
    Returns (pdf_path_str, error_message_or_None)."""
    pdf_path_str, force = args
    try:
        parse_pdf(Path(pdf_path_str), force=force)
        return pdf_path_str, None
    except Exception as e:
        return pdf_path_str, f"{type(e).__name__}: {e}"


def parallel_parse(pdfs: List[Path], *, workers: int, force: bool) -> List[Path]:
    """Run Docling in parallel across `pdfs`. Returns the list of PDFs
    whose parse succeeded (a parse cache now exists on disk). Failures
    are printed and excluded — we don't want one bad PDF to abort the
    whole corpus."""
    if not pdfs:
        return []
    t0 = time.time()
    print(f"[parse] starting parallel parse of {len(pdfs)} PDFs across {workers} workers")
    payload = [(str(p), force) for p in pdfs]
    ok: List[Path] = []
    # spawn is the default on macOS in modern Python, but be explicit so
    # behavior matches on Linux. fork would inherit the parent's already-
    # imported (but unused here) modules and waste memory.
    ctx = mp.get_context("spawn")
    with ctx.Pool(processes=workers) as pool:
        for pdf_str, err in pool.imap_unordered(_parse_worker, payload):
            if err is None:
                ok.append(Path(pdf_str))
                print(f"[parse]   ok  {Path(pdf_str).name}")
            else:
                print(f"[parse]   ERR {Path(pdf_str).name}: {err}", file=sys.stderr)
    elapsed = time.time() - t0
    print(f"[parse] done in {elapsed:.1f}s — {len(ok)}/{len(pdfs)} succeeded")
    return ok


def ingest_one_full(
    pdf: Path,
    year: int,
    *,
    openai_key: str,
    qdrant,
    collection: str,
) -> int:
    """Chunk + embed + upsert one already-parsed PDF. Returns chunk count.

    Assumes parse_pdf has already populated the cache; calling it here is
    a cache hit and returns the cached markdown."""
    md = parse_pdf(pdf, force=False)
    chunks = chunk_markdown(md, year=year, source_file=pdf.name)
    fact_chunks = extract_fact_chunks(md, year=year, source_file=pdf.name)
    chunks.extend(fact_chunks)
    print(f"[chunk] {pdf.name}: {len(chunks):,} chunks "
          f"({sum(c.has_table for c in chunks):,} with tables; "
          f"{len(fact_chunks):,} synthetic facts)")
    if not chunks:
        return 0
    vectors = embed_chunks(chunks, openai_key)
    upsert(qdrant, collection, chunks, vectors)
    return len(chunks)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workers", type=int, default=3,
                    help="Parallel Docling workers (default 3; each uses ~1.5 GB).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse + chunk only; skip embed and upsert.")
    ap.add_argument("--parse-only", action="store_true",
                    help="Phase A only — parse every PDF and stop.")
    ap.add_argument("--force-reparse", action="store_true",
                    help="Ignore parse caches and re-run Docling.")
    ap.add_argument("--pdfs-dir", type=Path, default=PDFS_DIR,
                    help=f"Override PDF discovery root (default {PDFS_DIR}).")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")

    discovered = discover_pdfs(args.pdfs_dir)
    if not discovered:
        sys.exit(f"FATAL: no PDFs found under {args.pdfs_dir}")
    print(f"[discover] {len(discovered)} PDFs:")
    for pdf, year in discovered:
        print(f"  {year}  {pdf.relative_to(args.pdfs_dir)}")

    # Phase A — parallel parse
    parsed_ok = parallel_parse(
        [pdf for pdf, _ in discovered],
        workers=args.workers,
        force=args.force_reparse,
    )
    parsed_set = set(parsed_ok)
    survivors = [(pdf, year) for pdf, year in discovered if pdf in parsed_set]

    if args.parse_only:
        print(f"[parse-only] stopping after phase A ({len(survivors)} PDFs parsed)")
        return

    # In dry-run we still want to chunk and dump a sample per PDF so the
    # caller can spot-check section/page assignment without burning API
    # quota.
    if args.dry_run:
        import json
        for pdf, year in survivors:
            md = parse_pdf(pdf, force=False)
            chunks = chunk_markdown(md, year=year, source_file=pdf.name)
            sample = PARSED_DIR / f"{pdf.stem}.chunks.jsonl"
            with sample.open("w", encoding="utf-8") as f:
                for c in chunks[:50]:
                    f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")
            print(f"[dry-run] {pdf.name}: {len(chunks):,} chunks -> "
                  f"{sample.relative_to(ROOT)}")
        print("[dry-run] done — re-run without --dry-run to embed + upsert")
        return

    # Phase B — sequential chunk/embed/upsert. We resolve env + Qdrant
    # once, then loop. Sequential keeps RAM bounded and avoids hammering
    # the embeddings API; OpenAI's tier limits are generous so this
    # could go parallel later if it ever becomes the bottleneck.
    openai_key = require_env("OPENAI_API_KEY")
    qdrant_url = require_env("QDRANT_URL")
    qdrant_key = require_env("QDRANT_API_KEY")
    collection = require_env("QDRANT_COLLECTION")

    from qdrant_client import QdrantClient  # lazy
    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    ensure_collection(qdrant, collection)

    total = 0
    for pdf, year in survivors:
        try:
            n = ingest_one_full(
                pdf, year,
                openai_key=openai_key,
                qdrant=qdrant,
                collection=collection,
            )
            total += n
        except Exception as e:
            print(f"[ingest] ERR {pdf.name}: {type(e).__name__}: {e}", file=sys.stderr)
    print(f"[done] upserted {total:,} chunks across {len(survivors)} PDFs "
          f"into '{collection}' at {qdrant_url}")


if __name__ == "__main__":
    main()
