#!/usr/bin/env python3
"""verify_retrieval.py — Phase 3 hand-query smoke test.

Runs a set of test queries directly against Qdrant (no chat/SSE in the path)
and prints top-K results. Validates that retrieval surfaces the chunks we
expect for table-dependent questions.

Usage:
    python verify_retrieval.py [--top-k 5]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

EMBED_MODEL = "text-embedding-3-small"

# (query, list-of-substrings-that-MUST-appear-in-top-K-combined-text)
QUERIES = [
    ("What was Gujarat's installed wind capacity in 2024-25?",
        ["Gujarat", "12677.48"]),
    ("Top 3 states by installed wind capacity in 2025",
        ["Gujarat", "Tamil Nadu", "Karnataka"]),
    ("India total installed wind capacity 31 March 2025",
        ["50037.82"]),
    ("How many turbines did Suzlon install in FY 2016-17?",
        ["Suzlon", "847"]),
    ("How many WEGs did Siemens Gamesa install in FY 2020-21?",
        ["Siemense Gamesa", "281", "606.600"]),
    ("Senvion turbines in Gujarat cumulative",
        ["Senvion", "212"]),
    ("Pioneer Wincon turbines installed upto March 2010",
        ["Pioneer Wincon", "682"]),
    ("Wind electricity generation in 2024-25 MU",
        ["83347"]),
    ("Inox Wind Ltd cumulative turbines installed",
        ["Inox", "1588"]),
    ("Hybrid renewable energy projects under SECI schemes",
        ["SECI"]),
]


def clients():
    from openai import OpenAI
    from qdrant_client import QdrantClient
    okey = os.environ.get("OPENAI_API_KEY")
    qurl = os.environ.get("QDRANT_URL")
    qkey = os.environ.get("QDRANT_API_KEY")
    coll = os.environ.get("QDRANT_COLLECTION", "wind_energy_v1")
    return OpenAI(api_key=okey), QdrantClient(url=qurl, api_key=qkey), coll


def embed(client, text: str) -> list[float]:
    r = client.embeddings.create(model=EMBED_MODEL, input=text)
    return r.data[0].embedding


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=5)
    args = ap.parse_args()

    oc, qd, coll = clients()
    total = len(QUERIES)
    passed = 0
    for q, expected in QUERIES:
        print(f"\n── {q}")
        vec = embed(oc, q)
        resp = qd.query_points(collection_name=coll, query=vec, limit=args.top_k, with_payload=True)
        combined = "\n\n".join((h.payload or {}).get("text", "") for h in resp.points)
        missing = [s for s in expected if s.lower() not in combined.lower()]
        ok = not missing
        if ok:
            passed += 1
        print(f"   {'OK' if ok else 'MISS'}  expected {expected}; missing {missing}")
        for i, h in enumerate(resp.points, 1):
            p = h.payload or {}
            snippet = (p.get("text") or "")[:120].replace("\n", " / ")
            print(f"   [{i}] score={h.score:.3f} type={p.get('type','?'):20s} table#{p.get('table_index','-')}  {snippet}")
    print(f"\n══ {passed}/{total} queries surfaced expected substrings in top-{args.top_k} ══")


if __name__ == "__main__":
    main()
