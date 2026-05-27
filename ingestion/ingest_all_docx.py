#!/usr/bin/env python3
"""ingest_all_docx.py — Phase 4 driver. Full-corpus docx ingestion.

Pipeline:
    Phase A — parse every docx under data/docx/ (parallel, ProcessPool)
    Phase B — chunk every parsed elements.jsonl (sequential, fast)
    Phase C — embed + upsert per file (sequential, OpenAI-rate-friendly)

Resume support:
    - A docx is parsed only if its .elements.jsonl is missing OR older than the docx.
    - A chunks.jsonl is regenerated only if missing OR older than elements.jsonl.
    - Phase C always runs (embed_and_upsert.py is itself idempotent — same
      content -> same UUID -> Qdrant overwrites). Cheap, marginal cost.
    - --force bypasses all skip logic.

Cost guard:
    - Before Phase C, sum total tokens across all chunks. If estimated cost
      exceeds COST_ABORT_USD, abort with a message asking the user to confirm.

Final report:
    ingestion/data/ingestion_report_<timestamp>.json with per-doc results,
    aggregate counts, warnings, cost.

Usage:
    python ingest_all_docx.py [--force] [--workers N] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCX_DIR = ROOT / "data" / "docx"
PARSED_DIR = ROOT / "data" / "parsed"

COST_ABORT_USD = 2.0
PRICE_PER_M_TOKENS = 0.02  # text-embedding-3-small


# ── Skip logic ─────────────────────────────────────────────────────────
def is_fresh(out: Path, src: Path) -> bool:
    return out.exists() and out.stat().st_mtime >= src.stat().st_mtime


# ── Phase A: parse (called in a worker process) ───────────────────────
def _parse_one(args: tuple[str, str, bool]) -> dict:
    """Worker. Runs parse_doc on one docx file."""
    docx_path_str, out_dir_str, force = args
    docx_path = Path(docx_path_str)
    out_dir = Path(out_dir_str)
    stem = docx_path.stem
    elements_path = out_dir / f"{stem}.elements.jsonl"
    md_path = out_dir / f"{stem}.md"
    report_path = out_dir / f"{stem}.parse_report.json"

    if not force and is_fresh(elements_path, docx_path) and is_fresh(md_path, docx_path):
        return {
            "filename": docx_path.name,
            "phase": "parse",
            "status": "skipped (cache fresh)",
        }
    # Local import so worker processes pick up the module independently.
    from parse_docx import parse_doc
    try:
        t0 = time.time()
        report = parse_doc(docx_path, out_dir)
        ms = int((time.time() - t0) * 1000)
        return {
            "filename": docx_path.name,
            "phase": "parse",
            "status": "ok",
            "elapsed_ms": ms,
            "counts": report["counts"],
            "warnings": report["warnings"],
        }
    except Exception as e:
        return {
            "filename": docx_path.name,
            "phase": "parse",
            "status": "error",
            "error": f"{type(e).__name__}: {e}",
        }


# ── Phase B: chunk (sequential, cheap) ─────────────────────────────────
def _sum_tokens(chunks_path: Path) -> tuple[int, int]:
    """Returns (chunk_count, total_tokens) by iterating the file line by line.
    Iteration respects only \\n (unlike str.splitlines() which also breaks on
    \\v / \\f — characters python-docx sometimes preserves from the source)."""
    n = 0
    tok = 0
    with chunks_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            n += 1
            tok += json.loads(line)["token_count"]
    return n, tok


def chunk_one(elements_path: Path, force: bool) -> dict:
    from chunk_doc import chunk_doc
    stem = elements_path.name.replace(".elements.jsonl", "")
    chunks_path = elements_path.parent / f"{stem}.chunks.jsonl"
    if not force and is_fresh(chunks_path, elements_path):
        n, tok = _sum_tokens(chunks_path)
        return {
            "filename": stem + ".docx",
            "phase": "chunk",
            "status": "skipped (cache fresh)",
            "chunk_count": n,
            "total_tokens": tok,
            "chunks_path": str(chunks_path),
        }
    t0 = time.time()
    stats = chunk_doc(elements_path, chunks_path)
    ms = int((time.time() - t0) * 1000)
    n, tok = _sum_tokens(chunks_path)
    return {
        "filename": stem + ".docx",
        "phase": "chunk",
        "status": "ok",
        "elapsed_ms": ms,
        "chunk_count": n,
        "total_tokens": tok,
        "by_type": stats["by_type"],
        "token_max": stats["token_max"],
        "chunks_path": str(chunks_path),
    }


# ── Phase C: embed + upsert (sequential per doc) ──────────────────────
def embed_one(chunks_path: Path) -> dict:
    from embed_and_upsert import load_chunks, delete_existing, embed_batches, build_point, upsert_batches, get_clients
    openai_client, qdrant, collection = get_clients()
    chunks = load_chunks(chunks_path)
    if not chunks:
        return {"filename": chunks_path.name, "phase": "embed", "status": "empty", "chunk_count": 0}
    source_file = chunks[0]["source_file"]
    t0 = time.time()
    deleted = delete_existing(qdrant, collection, source_file)
    vectors = embed_batches(openai_client, [c["text"] for c in chunks])
    points = [build_point(c, v) for c, v in zip(chunks, vectors)]
    upsert_batches(qdrant, collection, points)
    ms = int((time.time() - t0) * 1000)
    return {
        "filename": source_file,
        "phase": "embed",
        "status": "ok",
        "elapsed_ms": ms,
        "chunks_embedded": len(chunks),
        "tokens_embedded": sum(c["token_count"] for c in chunks),
        "stale_points_deleted": deleted,
    }


# ── Main driver ────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="ignore cache; reparse + rechunk + re-embed everything")
    ap.add_argument("--workers", type=int, default=4, help="parallel parse workers (Phase A)")
    ap.add_argument("--dry-run", action="store_true", help="parse + chunk; skip embed/upsert")
    args = ap.parse_args()

    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(DOCX_DIR.rglob("*.docx"))
    if not files:
        sys.exit(f"FATAL: no docx under {DOCX_DIR}")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%SZ")
    print(f"== {ts} ingest_all_docx.py ==")
    print(f"corpus: {len(files)} docx file(s)")
    print(f"force={args.force}  workers={args.workers}  dry_run={args.dry_run}\n")

    report: dict = {
        "timestamp": ts,
        "force": args.force,
        "dry_run": args.dry_run,
        "files": [],
        "aggregate": {},
    }

    # Phase A: parallel parse
    print("─ Phase A: parse (parallel) ─" * 1)
    parse_results: dict[str, dict] = {}
    work = [(str(f), str(PARSED_DIR), args.force) for f in files]
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(_parse_one, w): w[0] for w in work}
            for fut in as_completed(futs):
                r = fut.result()
                parse_results[r["filename"]] = r
                ms = r.get("elapsed_ms", 0)
                cts = r.get("counts", {})
                summary = f"tables={cts.get('tables','?')} paragraphs={cts.get('paragraphs','?')}" if cts else r["status"]
                print(f"  [parse] {r['filename']:50s}  {r['status']:25s}  {ms}ms  {summary}")
    else:
        for w in work:
            r = _parse_one(w)
            parse_results[r["filename"]] = r
            ms = r.get("elapsed_ms", 0)
            cts = r.get("counts", {})
            summary = f"tables={cts.get('tables','?')} paragraphs={cts.get('paragraphs','?')}" if cts else r["status"]
            print(f"  [parse] {r['filename']:50s}  {r['status']:25s}  {ms}ms  {summary}")

    # Phase B: chunk (sequential)
    print("\n─ Phase B: chunk (sequential) ─")
    chunk_results: dict[str, dict] = {}
    for f in files:
        stem = f.stem
        elements_path = PARSED_DIR / f"{stem}.elements.jsonl"
        if not elements_path.exists():
            chunk_results[f.name] = {"phase": "chunk", "status": "skipped (no elements.jsonl from parse)"}
            print(f"  [chunk] {f.name:50s}  skipped (no elements.jsonl)")
            continue
        r = chunk_one(elements_path, args.force)
        chunk_results[f.name] = r
        ms = r.get("elapsed_ms", 0)
        print(f"  [chunk] {f.name:50s}  {r['status']:25s}  {ms}ms  chunks={r['chunk_count']:4d} tokens={r['total_tokens']:7,}")

    # Cost guard
    total_tokens = sum(r.get("total_tokens", 0) for r in chunk_results.values())
    est_cost = total_tokens * PRICE_PER_M_TOKENS / 1e6
    print(f"\nestimated embed cost: ${est_cost:.4f}  (total tokens: {total_tokens:,})")
    if est_cost > COST_ABORT_USD:
        sys.exit(f"FATAL: estimated cost ${est_cost:.2f} > ${COST_ABORT_USD:.2f}. Re-run with --force after confirming.")

    # Phase C: embed + upsert (sequential)
    embed_results: dict[str, dict] = {}
    if args.dry_run:
        print("\n─ Phase C: SKIPPED (--dry-run) ─")
    else:
        print("\n─ Phase C: embed + upsert ─")
        for f in files:
            stem = f.stem
            chunks_path = PARSED_DIR / f"{stem}.chunks.jsonl"
            if not chunks_path.exists():
                embed_results[f.name] = {"phase": "embed", "status": "skipped (no chunks.jsonl)"}
                print(f"  [embed] {f.name:50s}  skipped (no chunks)")
                continue
            r = embed_one(chunks_path)
            embed_results[f.name] = r
            ms = r.get("elapsed_ms", 0)
            print(f"  [embed] {f.name:50s}  {r['status']:25s}  {ms}ms  chunks={r.get('chunks_embedded','-')}")

    # Aggregate
    for f in files:
        report["files"].append({
            "filename": f.name,
            "parse": parse_results.get(f.name, {}),
            "chunk": chunk_results.get(f.name, {}),
            "embed": embed_results.get(f.name, {}),
        })
    total_chunks = sum(c.get("chunk_count", 0) for c in chunk_results.values())
    n_failed = sum(1 for r in parse_results.values() if r.get("status") == "error")
    report["aggregate"] = {
        "files": len(files),
        "parse_ok": sum(1 for r in parse_results.values() if r.get("status") == "ok"),
        "parse_skipped": sum(1 for r in parse_results.values() if "skipped" in r.get("status","")),
        "parse_failed": n_failed,
        "total_chunks": total_chunks,
        "total_tokens": total_tokens,
        "estimated_cost_usd": round(est_cost, 4),
        "warnings_per_file": {r.get("filename","?"): len(r.get("warnings", [])) for r in parse_results.values()},
    }

    out = ROOT / "data" / f"ingestion_report_{ts}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nfinal report -> {out.relative_to(ROOT.parent)}")
    print(f"aggregate: {report['aggregate']}")


if __name__ == "__main__":
    main()
