#!/usr/bin/env python3
"""
audit_tables.py — comprehensive probe of every major data table in the
2025 Indian Windpower Directory. For each table, ask the bot a specific
question whose answer is verifiable from the PDF, then record the result.

Output: a table of (table_name, question, expected_substring, pass/fail,
answer_excerpt). Reveals which tables the RAG can reliably surface vs
which still have gaps from OCR damage or weak retrieval.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / "ingestion" / ".env")
sys.path.insert(0, str(REPO / "eval"))

from run_eval import (  # noqa: E402
    SYSTEM_PROMPT,
    build_filter,
    build_user_prompt,
    embed_query,
    retrieve,
    rewrite_query,
)
from openai import OpenAI  # noqa: E402
from qdrant_client import QdrantClient  # noqa: E402


# Each probe targets ONE specific table and a fact known to be in the PDF.
# expect_in_answer is a case-insensitive substring (with normalize() applied
# the same way run_eval does it — commas inside numbers stripped).
PROBES = [
    {
        "table": "Make & Year-wise WEG Installations (Active)",
        "question": "How many turbines did Suzlon install in FY 2016-17?",
        "expect_answer": ["847"],
        "expect_truth_hint": "Suzlon FY 2016-17: 847 turbines / 1778.700 MW",
    },
    {
        "table": "Manufacturer contribution prose (FY 2024-25)",
        "question": "What was Inox's contribution during 2024-25?",
        "expect_answer": ["98"],
        "expect_truth_hint": "Inox contributed 98 MW in FY 2024-25",
    },
    {
        "table": "State & Make-wise WEG Installations (Active, cumulative)",
        "question": "How many Suzlon turbines are installed in Tamil Nadu cumulatively?",
        "expect_answer": ["2065"],
        "expect_truth_hint": "Suzlon in Tamil Nadu: 2065 turbines / 2787.5 MW (from cumulative State&Make table)",
    },
    {
        "table": "State & Make-wise Installation during 2024-25",
        "question": "How much capacity did Senvion install in Gujarat during 2024-25?",
        "expect_answer": ["290"],
        "expect_truth_hint": "Senvion Gujarat 2024-25: 290.600 MW",
    },
    {
        "table": "All India State-wise Cumulative Capacity",
        "question": "What is Gujarat's cumulative installed wind capacity as on 31.03.2025?",
        "expect_answer": ["13450", "13,450"],
        "expect_truth_hint": "Gujarat cumulative: 13,450.120 MW",
    },
    {
        "table": "Tamil Nadu cumulative (state-wise)",
        "question": "What is Tamil Nadu's total installed wind capacity?",
        "expect_answer": ["11739", "11,739", "11609", "11,609"],
        "expect_truth_hint": "Tamil Nadu cumulative: directory has both 11,739.91 MW (state-wise table) and 11,609.575 MW (year-wise growth table)",
    },
    {
        "table": "Karnataka cumulative",
        "question": "What is Karnataka's total installed wind capacity?",
        "expect_answer": ["6869", "6,869"],
        "expect_truth_hint": "Karnataka cumulative: 6,869.405 MW",
    },
    {
        "table": "State & Year-wise Installed Capacity (last 5 years)",
        "question": "What was Maharashtra's installed wind capacity as on 31 March 2024?",
        "expect_answer": ["5"],  # narrow expectation; just want some numeric mention
        "expect_truth_hint": "Maharashtra 31.03.2024 — table has it",
    },
    {
        "table": "Percentage Contribution by States",
        "question": "What percentage of India's installed wind capacity is in Gujarat?",
        "expect_answer": ["%"],
        "expect_truth_hint": "Gujarat share of total — should yield a percent",
    },
    {
        "table": "Worldwide Windpower Installed Capacity (Global Scenario)",
        "question": "Which country had the highest installed wind capacity globally as on December 2024?",
        "expect_answer": ["China"],
        "expect_truth_hint": "China rank 1 with 510,266 MW per Worldwide table",
    },
    {
        "table": "Worldwide table — total global capacity",
        "question": "What was the total worldwide installed wind power capacity?",
        "expect_answer": ["1120072", "1,120,072", "11,20,072"],
        "expect_truth_hint": "Worldwide total: 11,20,072 MW (Indian numbering)",
    },
    {
        "table": "Year & Rating-wise WEG Installations (last 40 years)",
        "question": "How many 800 kW rating WEGs were installed in FY 2007-08?",
        "expect_answer": ["363"],
        "expect_truth_hint": "From table: 800 kW row, 2007-08 column = 363",
    },
    {
        "table": "Manufacturer & Rating-wise Number of WEGs (FY 2024-25)",
        "question": "How many 5200 kW WEGs were installed by Adani Green during 2024-25?",
        "expect_answer": ["150"],
        "expect_truth_hint": "Adani Green 5200 kW row in 2024-25 Manuf-Rating table = 150",
    },
    {
        "table": "SECI Tender Results (different tranches)",
        "question": "How many tranches of SECI wind tenders have been conducted?",
        "expect_answer": ["tranche"],
        "expect_truth_hint": "SECI section lists multiple tranches I, II, III, IV, etc.",
    },
    {
        "table": "State & Month-wise installations during FY 2024-25",
        "question": "How much capacity was installed in Gujarat in March 2025?",
        "expect_answer": ["Gujarat"],
        "expect_truth_hint": "Gujarat March 2025 entry in State-Month table",
    },
    {
        "table": "NIWE wind monitoring masts (headline)",
        "question": "How many wind monitoring masts has NIWE installed?",
        "expect_answer": ["996"],
        "expect_truth_hint": "NIWE total: 996 masts",
    },
    {
        "table": "Total installed capacity headline",
        "question": "India's total installed wind power capacity as of 31 March 2025?",
        "expect_answer": ["5003"],
        "expect_truth_hint": "50,038 MW per MNRE / 50,037.82 per state sum",
    },
]


def normalize(s: str) -> str:
    import re
    s = s.lower()
    s = re.sub(r"(?<=\d)[,\s](?=\d{3}\b)", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def has_any(haystack: str, needles: list[str]) -> bool:
    hn = normalize(haystack)
    return any(normalize(n) in hn for n in needles)


def main() -> None:
    oc = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    qd = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"])

    rows: list[dict] = []
    for p in PROBES:
        q = p["question"]
        print(f"\n→ [{p['table']}] {q}")
        canonical, embed_text, variants = rewrite_query(q)
        merged: dict = {}
        for qt in [embed_text, *variants]:
            v = embed_query(oc, qt)
            for h in retrieve(qd, "wind_energy_v1", v, 15, build_filter({"year": 2025})):
                if h.id not in merged or h.score > merged[h.id][1]:
                    merged[h.id] = (h, h.score)
        hits = [h for h, _ in sorted(merged.values(), key=lambda x: -x[1])][:15]

        user_prompt = build_user_prompt(canonical, hits)
        t0 = time.time()
        resp = oc.chat.completions.create(
            model="o4-mini",
            max_completion_tokens=4096,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        ms = int((time.time() - t0) * 1000)
        ans = resp.choices[0].message.content or ""
        ok = has_any(ans, p["expect_answer"])
        short = ans.replace("\n", " ")[:160]
        status = "PASS" if ok else "FAIL"
        print(f"  {status} ({ms}ms) — {short}…")
        rows.append({
            "table": p["table"],
            "question": q,
            "expect": p["expect_answer"],
            "truth": p["expect_truth_hint"],
            "status": status,
            "answer": ans,
        })

    print("\n" + "═" * 70)
    print("AUDIT SUMMARY")
    print("═" * 70)
    passed = sum(1 for r in rows if r["status"] == "PASS")
    print(f"{passed}/{len(rows)} probes passed\n")
    for r in rows:
        marker = "✓" if r["status"] == "PASS" else "✗"
        print(f"{marker} {r['table']:55} expect: {r['expect']}")
        if r["status"] == "FAIL":
            print(f"   truth: {r['truth']}")
            print(f"   answer: {r['answer'][:200]}")

    import json
    (REPO / "eval" / "audit_last.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"\nfull report -> eval/audit_last.json")


if __name__ == "__main__":
    main()
