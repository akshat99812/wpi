#!/usr/bin/env python3
"""
run_eval.py — golden-question eval for the wind-energy RAG.

For each question in golden_questions.json:
  1. Retrieve top-K chunks from Qdrant (optionally filtered by year).
  2. Check whether all `expect_in_chunks` substrings appear *anywhere* in
     the retrieved chunk texts (retrieval hit).
  3. Generate an answer with OpenAI o4-mini and check whether all
     `expect_in_answer` substrings appear in the answer (answer hit).
  4. Report per-question pass/fail and aggregate hit-rate.

Run from repo root:
    cd ingestion && ../eval/.venv/bin/python ../eval/run_eval.py
or, if you've installed the ingestion venv globally:
    .venv/bin/python eval/run_eval.py

Reuses ingestion/.env for OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY,
QDRANT_COLLECTION. No new env vars.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
INGESTION = REPO / "ingestion"

# Reuse ingestion/.env so we don't duplicate config.
load_dotenv(INGESTION / ".env")

# Lazy imports so --help works without keys.
def _clients():
    import os
    from openai import OpenAI
    from qdrant_client import QdrantClient

    openai_key = os.environ.get("OPENAI_API_KEY")
    qdrant_url = os.environ.get("QDRANT_URL")
    qdrant_key = os.environ.get("QDRANT_API_KEY")
    collection = os.environ.get("QDRANT_COLLECTION", "wind_energy_v1")
    if not openai_key:
        sys.exit("FATAL: OPENAI_API_KEY missing (check ingestion/.env)")
    if not qdrant_url or not qdrant_key:
        sys.exit("FATAL: QDRANT_URL / QDRANT_API_KEY missing")
    return OpenAI(api_key=openai_key), QdrantClient(url=qdrant_url, api_key=qdrant_key), collection


SYSTEM_PROMPT = (
    "You answer questions about Indian wind energy using ONLY the passages "
    "provided. Cite sources by appending [n]. Preserve numbers exactly. "
    "If a passage contains a table or breakdown that includes the entity asked "
    "about but the specific cell is empty/zero or missing, say so and report "
    "what the table DOES contain for that entity. If only aggregate data is "
    "available when the user asked for a breakdown, report the aggregate and "
    "note the limitation. If the passages don't contain the answer at all, "
    "say so plainly — do not guess. Keep it concise."
)

EMBED_MODEL = "text-embedding-3-small"
GEN_MODEL = "o4-mini"


# Mirror of apps/api/src/services/rag/rewrite.ts — keep in sync. Same rules,
# different language. If rule set grows, switch eval to call the live /chat
# endpoint instead of duplicating.
STATE_ABBREVS = {
    "MP": "Madhya Pradesh", "TN": "Tamil Nadu", "AP": "Andhra Pradesh",
    "UP": "Uttar Pradesh", "TG": "Telangana", "MH": "Maharashtra",
    "RJ": "Rajasthan", "KA": "Karnataka", "KL": "Kerala", "WB": "West Bengal",
    "GJ": "Gujarat", "HP": "Himachal Pradesh", "JK": "Jammu and Kashmir",
}
TYPO_FIXES = {
    "Suzion": "Suzlon", "Suzlan": "Suzlon", "Suzolon": "Suzlon",
    "Vesta": "Vestas", "Siemens Gamesa": "Siemense Gamesa",
    "Gamesia": "Gamesa",
}
DOMAIN_EXPANSIONS = {
    "mast": "wind monitoring mast", "masts": "wind monitoring masts",
    "WEG": "Wind Energy Generator", "WEGs": "Wind Energy Generators",
    "WTG": "Wind Turbine Generator", "WTGs": "Wind Turbine Generators",
    "capacity": "installed capacity", "manufacturer": "WEG manufacturer",
    "turbine": "wind turbine generator WEG",
    "turbines": "wind turbine generators WEGs",
}


MANUFACTURERS = [
    "Suzlon", "Vestas", "GE", "Envision", "Senvion", "Inox",
    "Adani Green", "Adani", "Siemense Gamesa", "Gamesa", "Sany",
    "Pioneer Wincon", "Pioneer", "SIVA Wind", "SIVA", "Nordex",
    "Regen Powertech", "Regen", "WEG Electric", "Emergya Wind",
]
STATES_FULL = [
    "Andhra Pradesh", "Gujarat", "Karnataka", "Maharashtra", "Tamil Nadu",
    "Madhya Pradesh", "Rajasthan", "Telangana", "Kerala", "West Bengal",
    "Odisha", "Goa", "Uttar Pradesh", "Himachal Pradesh",
]


def rewrite_query(q: str) -> tuple[str, str, list[str]]:
    """Mirror of apps/api/src/services/rag/rewrite.ts.
    Returns (canonical, embed_text, variants).
    - canonical: typos + abbrevs fixed; LLM-safe (what the user 'meant').
    - embed_text: canonical + domain hints; embedder-only.
    - variants: extra embedder queries to union with embed_text.
    """
    import re as _re
    s = q
    for abbr, full in STATE_ABBREVS.items():
        s = _re.sub(rf"(?<![A-Za-z]){abbr}(?![A-Za-z])", full, s)
    for typo, canonical_form in TYPO_FIXES.items():
        s = _re.sub(rf"\b{_re.escape(typo)}\b", canonical_form, s, flags=_re.IGNORECASE)
    canonical = s.strip()

    appended = []
    for term, expansion in DOMAIN_EXPANSIONS.items():
        if _re.search(rf"\b{term}\b", canonical) and expansion.lower() not in canonical.lower():
            appended.append(expansion)
    embed_text = f"{canonical} ({'; '.join(appended)})" if appended else canonical

    variants: list[str] = []
    has_manuf = any(_re.search(rf"\b{m}\b", canonical, _re.IGNORECASE) for m in MANUFACTURERS)
    has_year = bool(_re.search(r"\b(FY|fiscal|20\d{2}|20\d{2}[-–]\d{2})\b", canonical))
    has_state = any(st.lower() in canonical.lower() for st in STATES_FULL)
    if has_manuf and has_year:
        variants.append(f"Manufacturer-wise capacity addition contribution MW during the year {canonical}")
        variants.append(f"Make and Year-wise WEG Installations in India table by manufacturer for FY year {canonical}")
    if has_manuf and has_state:
        variants.append(f"State and Make-wise WEG Installations table by manufacturer and state {canonical}")
    if has_manuf and not has_year and not has_state:
        variants.append(f"Manufacturer cumulative total installations and FY 2024-25 contribution MW summary {canonical}")
        variants.append(f"State and Make-wise WEG Installations cumulative total by manufacturer {canonical}")
    if _re.search(r"\bmast(s)?\b", canonical, _re.IGNORECASE) or _re.search(r"\bmonitoring\b", canonical, _re.IGNORECASE):
        variants.append(f"NIWE total wind monitoring masts installed locations India {canonical}")
    if _re.search(r"\b(percent|percentage|%|share|ratio|potential)\b", canonical, _re.IGNORECASE):
        variants.append(f"Important facts and figures of Indian windpower percentage of estimated potential {canonical}")
    if _re.search(r"\bhow many\b", canonical, _re.IGNORECASE) and _re.search(r"\b(manufacturer|maker|company|companies|vendors?)\b", canonical, _re.IGNORECASE):
        variants.append(f"List of WEG manufacturers offering wind electric generators in India ratings hub heights total models active {canonical}")
    return canonical, embed_text, variants


def normalize(s: str) -> str:
    """Lowercase + strip thousands separators so '50,038' matches '50038'.
    Also collapses whitespace. We intentionally do NOT strip the substring
    we're checking — the question author writes substrings the way they
    expect to find them; normalization runs on both haystack and needle."""
    s = s.lower()
    s = re.sub(r"(?<=\d)[,\s](?=\d{3}\b)", "", s)  # 50,038 -> 50038; 50 038 -> 50038
    s = re.sub(r"\s+", " ", s)
    return s


def has_all(haystack: str, needles: Iterable[str]) -> tuple[bool, list[str]]:
    hn = normalize(haystack)
    missing = [n for n in needles if normalize(n) not in hn]
    return (not missing, missing)


def embed_query(client, text: str) -> list[float]:
    r = client.embeddings.create(model=EMBED_MODEL, input=text)
    return r.data[0].embedding


def build_filter(spec: dict[str, Any] | None):
    if not spec:
        return None
    from qdrant_client.http import models as rest
    must = []
    y = spec.get("year")
    if isinstance(y, int):
        must.append(rest.FieldCondition(key="year", match=rest.MatchValue(value=y)))
    elif isinstance(y, list) and len(y) == 2:
        must.append(rest.FieldCondition(key="year", range=rest.Range(gte=y[0], lte=y[1])))
    return rest.Filter(must=must) if must else None


def retrieve(qdrant, collection: str, vector: list[float], top_k: int, qfilter):
    # qdrant-client >=1.10 dropped .search() in favor of .query_points().
    resp = qdrant.query_points(
        collection_name=collection,
        query=vector,
        limit=top_k,
        with_payload=True,
        query_filter=qfilter,
    )
    return resp.points


def build_user_prompt(question: str, hits) -> str:
    parts = []
    for i, h in enumerate(hits, 1):
        p = h.payload or {}
        header = f"[{i}] {p.get('source_file','')} ({p.get('year','?')}) — {p.get('section','')}"
        parts.append(f"{header}\n{p.get('text','')}")
    passages = "\n\n---\n\n".join(parts) if parts else "(no passages retrieved)"
    return f"Question: {question}\n\nPassages:\n\n{passages}"


def generate(openai_client, system: str, user: str) -> str:
    resp = openai_client.chat.completions.create(
        model=GEN_MODEL,
        # 4096 matches apps/api/src/services/rag/generate.ts. o4-mini's
        # reasoning tokens count against this budget; lower values leave
        # complex multi-source queries with empty content.
        max_completion_tokens=4096,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", type=Path, default=ROOT / "golden_questions.json")
    ap.add_argument("--top-k", type=int, default=15)
    ap.add_argument(
        "--no-generate",
        action="store_true",
        help="Skip OpenAI generation; only evaluate retrieval hit rate.",
    )
    args = ap.parse_args()

    spec = json.loads(args.questions.read_text(encoding="utf-8"))
    questions = spec["questions"]
    print(f"loaded {len(questions)} questions from {args.questions.relative_to(REPO)}")

    openai_client, qdrant, collection = _clients()

    retrieval_pass = 0
    answer_pass = 0
    detail: list[dict[str, Any]] = []

    for q in questions:
        qid = q["id"]
        question = q["question"]
        print(f"\n── {qid} ───────────────────────────────────────────")
        print(f"Q: {question}")

        t0 = time.time()
        canonical, embed_text, variants = rewrite_query(question)
        if canonical != question:
            print(f"   canonical: {canonical}")
        if variants:
            print(f"   variants: {len(variants)}")
        qfilter = build_filter(q.get("filter"))
        per_query = max(args.top_k, 10)
        merged: dict[Any, tuple[Any, float]] = {}
        for qtext in [embed_text, *variants]:
            v = embed_query(openai_client, qtext)
            for h in retrieve(qdrant, collection, v, per_query, qfilter):
                prev = merged.get(h.id)
                if prev is None or h.score > prev[1]:
                    merged[h.id] = (h, h.score)
        hits = [h for h, _ in sorted(merged.values(), key=lambda x: -x[1])][: args.top_k]
        ret_ms = int((time.time() - t0) * 1000)

        combined_chunks = "\n\n".join((h.payload or {}).get("text", "") for h in hits)
        ret_ok, ret_missing = has_all(combined_chunks, q.get("expect_in_chunks", []))
        if ret_ok:
            retrieval_pass += 1
        print(f"retrieval: {'OK' if ret_ok else 'FAIL'} ({ret_ms}ms, {len(hits)} chunks)"
              + (f" — missing: {ret_missing}" if not ret_ok else ""))

        ans_ok = None
        answer = ""
        if not args.no_generate:
            # Pass the canonical (typo/abbrev-fixed) question to the LLM so
            # it doesn't get tripped up when the user's spelling differs
            # from the corpus's canonical spelling (e.g. "Suzion" vs "Suzlon").
            user_prompt = build_user_prompt(canonical, hits)
            t1 = time.time()
            answer = generate(openai_client, SYSTEM_PROMPT, user_prompt)
            gen_ms = int((time.time() - t1) * 1000)
            ans_ok, ans_missing = has_all(answer, q.get("expect_in_answer", []))
            if ans_ok:
                answer_pass += 1
            short = answer.replace("\n", " ")[:140]
            print(f"answer:    {'OK' if ans_ok else 'FAIL'} ({gen_ms}ms) — {short}…"
                  + (f"\n           missing: {ans_missing}" if not ans_ok else ""))

        detail.append({
            "id": qid,
            "retrieval_ok": ret_ok,
            "answer_ok": ans_ok,
            "answer": answer,
        })

    n = len(questions)
    print("\n══ summary ══════════════════════════════════════════")
    print(f"retrieval hit rate: {retrieval_pass}/{n} ({100*retrieval_pass/n:.0f}%)")
    if not args.no_generate:
        print(f"answer hit rate:    {answer_pass}/{n} ({100*answer_pass/n:.0f}%)")

    report = ROOT / "last_run.json"
    report.write_text(json.dumps({"detail": detail,
                                  "retrieval_pass": retrieval_pass,
                                  "answer_pass": answer_pass,
                                  "n": n}, indent=2),
                      encoding="utf-8")
    print(f"\nfull report -> {report.relative_to(REPO)}")


if __name__ == "__main__":
    main()
