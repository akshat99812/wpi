#!/usr/bin/env python3
"""embed_and_upsert.py — Phase 3. chunks.jsonl -> OpenAI embeddings -> Qdrant.

Behaviour:
    - Reads a chunks.jsonl produced by chunk_doc.py.
    - Before upserting, DELETES existing points in the collection where
      payload.source_file == <this file's source>. This makes re-runs
      idempotent: same chunk content produces the same UUID; stale chunks
      from prior runs that no longer exist get purged.
    - Embeds with OpenAI `text-embedding-3-small` (1536-d, cosine), batched
      at 128 inputs/request (OpenAI accepts up to ~2048 but 128 keeps
      memory + retry granularity sane).
    - Upserts in batches of 256 points to Qdrant.
    - Payload per point: year, source_file, section_path, type, text, token_count.
      Plus optional caption / table_index / row range from chunker metadata.

Idempotent point IDs: the chunker emits a 40-char SHA-1 hex; we turn the
first 32 chars into a canonical UUID for Qdrant. Re-running the parser
on the same docx -> same chunks -> same SHA-1 -> same UUID -> upsert
overwrites in place.

Usage:
    python embed_and_upsert.py <chunks.jsonl> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
EMBED_BATCH = 128
UPSERT_BATCH = 256


def chunk_id_to_uuid(sha1_hex: str) -> str:
    """Format the first 32 hex chars of a SHA-1 digest as a canonical UUID.
    Deterministic — same input -> same UUID -> Qdrant overwrites in place."""
    h = sha1_hex[:32]
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def get_clients():
    from openai import OpenAI
    from qdrant_client import QdrantClient

    okey = os.environ.get("OPENAI_API_KEY")
    qurl = os.environ.get("QDRANT_URL")
    qkey = os.environ.get("QDRANT_API_KEY")
    coll = os.environ.get("QDRANT_COLLECTION", "wind_energy_v1")
    if not okey:
        sys.exit("FATAL: OPENAI_API_KEY missing")
    if not qurl or not qkey:
        sys.exit("FATAL: QDRANT_URL / QDRANT_API_KEY missing")
    return OpenAI(api_key=okey), QdrantClient(url=qurl, api_key=qkey), coll


def load_chunks(path: Path) -> list[dict]:
    chunks = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                chunks.append(json.loads(line))
    return chunks


def delete_existing(qdrant, collection: str, source_file: str) -> int:
    """Filter-delete points where source_file matches. Returns prior count for logging."""
    from qdrant_client.http import models as rest
    # Count first for the log line.
    before = qdrant.count(
        collection_name=collection,
        count_filter=rest.Filter(must=[rest.FieldCondition(
            key="source_file", match=rest.MatchValue(value=source_file),
        )]),
        exact=True,
    ).count
    if before == 0:
        return 0
    qdrant.delete(
        collection_name=collection,
        points_selector=rest.FilterSelector(filter=rest.Filter(must=[
            rest.FieldCondition(key="source_file", match=rest.MatchValue(value=source_file)),
        ])),
        wait=True,
    )
    return before


def embed_batches(openai_client, texts: list[str]) -> list[list[float]]:
    """Embed in batches of EMBED_BATCH. Returns vectors aligned with texts."""
    vectors: list[list[float]] = []
    n = len(texts)
    for i in range(0, n, EMBED_BATCH):
        batch = texts[i:i + EMBED_BATCH]
        t0 = time.time()
        resp = openai_client.embeddings.create(model=EMBED_MODEL, input=batch)
        ms = int((time.time() - t0) * 1000)
        # OpenAI returns data in input order.
        for d in resp.data:
            vectors.append(d.embedding)
        print(f"  embedded {i + len(batch)}/{n} ({ms}ms)")
    if len(vectors) != n:
        sys.exit(f"FATAL: embed count mismatch — got {len(vectors)}, expected {n}")
    return vectors


def build_point(chunk: dict, vec: list[float]):
    from qdrant_client.http import models as rest
    payload = {
        "year": chunk["year"],
        "source_file": chunk["source_file"],
        "section_path": chunk["section_path"],
        # Keep a flat 'section' for filters / legacy callers — bottom of path.
        "section": (chunk["section_path"][-1] if chunk["section_path"] else None),
        "type": chunk["type"],
        "text": chunk["text"],
        "token_count": chunk["token_count"],
    }
    md = chunk.get("metadata") or {}
    if md:
        # Promote a small set of useful keys to top-level payload for filtering.
        for k in ("table_index", "caption", "header_row_count", "rows_from", "rows_to", "of_rows", "states"):
            if k in md:
                payload[k] = md[k]
    return rest.PointStruct(id=chunk_id_to_uuid(chunk["id"]), vector=vec, payload=payload)


def upsert_batches(qdrant, collection: str, points: list) -> None:
    for i in range(0, len(points), UPSERT_BATCH):
        batch = points[i:i + UPSERT_BATCH]
        t0 = time.time()
        qdrant.upsert(collection_name=collection, points=batch, wait=True)
        ms = int((time.time() - t0) * 1000)
        print(f"  upserted {i + len(batch)}/{len(points)} ({ms}ms)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("chunks", type=Path)
    ap.add_argument("--dry-run", action="store_true", help="parse + embed + count, no Qdrant writes")
    args = ap.parse_args()
    if not args.chunks.exists():
        sys.exit(f"FATAL: not found: {args.chunks}")

    chunks = load_chunks(args.chunks)
    if not chunks:
        sys.exit("FATAL: chunks.jsonl is empty")
    source_file = chunks[0]["source_file"]
    if not all(c["source_file"] == source_file for c in chunks):
        sys.exit("FATAL: chunks.jsonl mixes multiple source_file values; refusing to upsert")

    print(f"source_file: {source_file}")
    print(f"chunks: {len(chunks)}")
    total_tokens = sum(c["token_count"] for c in chunks)
    print(f"total embed tokens (approx): {total_tokens:,} (~${total_tokens * 0.02e-6:.4f} at $0.02/M)")

    openai_client, qdrant, collection = get_clients()

    print(f"\n[1/3] Deleting existing points for source_file=...")
    deleted = delete_existing(qdrant, collection, source_file) if not args.dry_run else -1
    print(f"  deleted: {deleted if deleted >= 0 else 'SKIPPED (--dry-run)'}")

    print(f"\n[2/3] Embedding {len(chunks)} chunks ({EMBED_MODEL}, batch={EMBED_BATCH})...")
    vectors = embed_batches(openai_client, [c["text"] for c in chunks])

    if args.dry_run:
        print("\n[3/3] Dry-run: skipping upsert.")
        return

    print(f"\n[3/3] Upserting {len(chunks)} points (batch={UPSERT_BATCH})...")
    points = [build_point(c, v) for c, v in zip(chunks, vectors)]
    upsert_batches(qdrant, collection, points)

    final_count = qdrant.count(collection_name=collection, exact=True).count
    print(f"\nDone. Collection '{collection}' total points: {final_count}")


if __name__ == "__main__":
    main()
