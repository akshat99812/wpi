# RAG Ingestion Rebuild — Implementation Spec

## Context for you (Claude Code)

We have a RAG chatbot over 25 years of wind energy reports. The current pipeline ingests PDFs via Docling and the retrieval quality is poor — **tables are missing or mangled in retrieval results**, which is the #1 user complaint. We've diagnosed the root cause: PDF table extraction is unreliable (visual reverse-engineering, OCR corruption on scans, table-splitting during chunking).

**We have the same content available as .docx files.** Docx tables are structured XML (`<w:tbl>`), not visual layout, so we're switching the primary ingestion source to docx. PDFs become fallback only for content that doesn't exist in docx form.

This is a rebuild of the ingestion pipeline, not the retrieval or generation layers. The TS query API, SSE chat route, and Qdrant collection schema stay the same. We're swapping out **how chunks get into Qdrant**, not what Qdrant looks like downstream.

**Take whatever time and resources are needed. Accuracy over speed.** If you're unsure between two approaches, pick the one more likely to preserve table integrity and document it. If something needs my decision, stop and ask — don't guess.

---

## Non-negotiable success criteria

Before declaring this done, all of the following must be true:

1. **Table fidelity:** For a sampled docx with known tables, every numeric cell from the source survives into exactly one chunk in `data/parsed/<doc>.chunks.jsonl`. No silent drops, no OCR-style corruption, no split tables without repeated headers.
2. **Header co-location:** Every chunk containing table rows also contains the column header row of that table. No orphan rows.
3. **Semantic captioning:** Every table chunk has a natural-language caption prepended describing what the table contains (section, what columns mean, time range if applicable). Raw `| 4521 | 12.3 |` rows never get embedded without a caption.
4. **Idempotency:** Re-running ingestion on the same docx produces the same chunk IDs (sha1-based) and Qdrant upserts overwrite cleanly.
5. **Eval pass:** `eval/run_eval.py` against `eval/golden_questions.json` shows improved retrieval recall on table-dependent questions vs the current PDF-based ingestion. Baseline the current numbers before you start so we can compare.
6. **Spot-check passes:** Manual grep for 10 known numbers from source tables finds them in chunks, and the chunk also contains the header row and section name.

---

## Architecture decisions already made (do not relitigate)

- **Source format:** docx primary, PDF fallback. Use `python-docx` for docx parsing.
- **Embedding model:** OpenAI `text-embedding-3-small`, 1536-dim, cosine. Unchanged.
- **Vector store:** Qdrant collection `wind_energy_v1`. Unchanged. Schema unchanged.
- **Chunk ID strategy:** Deterministic sha1 of `(source_file, chunk_index, content)`. Unchanged.
- **Chunk prefix:** `Year: <N>. Section: <heading>.` for prose. For tables, extended to `Year: <N>. Section: <heading>. Table: <caption>.` See phase 2.
- **Language:** Python for ingestion (matches existing `/ingestion` directory). Do not introduce new languages.
- **Batching:** OpenAI embeddings batched at 128 inputs/request.

---

## What you must NOT do

- Do not change the Qdrant collection schema or recreate it. Upsert into the existing `wind_energy_v1`.
- Do not change the TS query/generation layer in `apps/api/`. Out of scope.
- Do not modify the embedding model. Same model at ingest and query time is critical.
- Do not delete or overwrite the existing PDF ingestion code (`ingest_one.py`, `ingest_all.py`). Add new files alongside. We may need to fall back.
- Do not silently skip content you can't parse. Log it, surface it in a report, ask.

---

## Phase 0 — Baseline and setup

Goals: know what we're starting from, set up the new code path without breaking the old one.

1. Run the current eval harness against the current PDF-ingested Qdrant collection. Save the output to `eval/baseline_pdf_<timestamp>.json`. This is what we're beating.
2. Inventory the docx files: list `ingestion/data/docx/<year>/` (create the directory structure if needed and confirm with me where the docx files live before assuming). Produce `ingestion/data/docx_inventory.json` with filename, year, size, page-ish length, and a flag for whether a matching PDF exists.
3. Pick **one** representative docx — ideally one with several tables, a scanned-page equivalent in the PDF version, and a known fact we can verify. Call this the *canary doc*. All Phase 1–2 work uses this doc only.
4. Create a new branch `rag-docx-ingestion`. All new code goes there.

**Gate before proceeding:** confirm with me which docx is the canary and the baseline eval numbers.

---

## Phase 1 — Docx parser (canary doc only)

Goals: get one docx into a clean intermediate markdown form that preserves every table perfectly.

1. New file: `ingestion/parse_docx.py`. Takes a docx path, emits markdown to `data/parsed/<doc>.md` and a structured intermediate to `data/parsed/<doc>.elements.jsonl` (one JSON object per element: paragraph, heading, table, with metadata).
2. Walk the docx in document order. python-docx's `document.element.body` gives you paragraphs and tables in order — do NOT just iterate `document.paragraphs` then `document.tables`, that loses interleaving.
3. For each element:
   - **Heading** (style starts with "Heading"): emit `{"type": "heading", "level": N, "text": ...}`. Track current heading stack.
   - **Paragraph**: emit `{"type": "paragraph", "text": ..., "section_path": [...]}`.
   - **Table**: emit `{"type": "table", "rows": [[...]], "header_row": [...], "section_path": [...], "caption": ...}`. Detect the header row (usually the first row, but check for `tbl.rows[0].cells[0]._tc.tcPr` for header markers if available; otherwise default to first row).
4. Generate a caption for each table automatically: `"Table in section '<section>': columns are <col1>, <col2>, ...; <N> rows; appears to cover <inferred from data>"`. Make this best-effort — if you can't infer well, just list section + columns.
5. Render the markdown version with tables as proper GitHub-flavored markdown tables (pipe-delimited with separator row).
6. Handle merged cells: python-docx returns the same text in each merged cell. Detect this and either keep duplication (safer) or annotate. Document your choice.
7. Handle embedded images: log them with their location and a placeholder `[IMAGE: <description if alt-text exists, else 'no alt-text'>]`. Do not OCR images at this stage — flag in a report instead.
8. Handle text boxes and shapes: python-docx misses these by default. Use `docx.oxml.ns` to walk for `w:txbxContent` elements and extract their text. If you find any in the canary, flag in the report.

**Verification before phase 2:**
- Open `<doc>.md` and visually compare every table against the source docx. Every cell must match.
- Run a grep for 10 specific numbers from source tables. All 10 must be in the markdown.
- Show me the elements.jsonl for the canary and at least 2 rendered tables.

---

## Phase 2 — Chunker (canary doc only)

Goals: convert elements.jsonl into chunks that an embedding model can usefully retrieve.

1. New file: `ingestion/chunk_doc.py`. Reads `<doc>.elements.jsonl`, writes `<doc>.chunks.jsonl`.
2. **Tables are atomic-ish.** Rules:
   - A table with ≤25 rows = exactly one chunk. Never split.
   - A table with >25 rows = split by row groups of ~20 rows, but **every chunk includes the header row at the top** AND a continuation marker like `(Table continued, rows 21–40 of 87)`.
   - The caption (from phase 1) is prepended to every chunk of that table.
   - Chunk text format for tables:
     ```
     Year: <N>. Section: <heading>. Table: <caption>.

     | col1 | col2 | col3 |
     |------|------|------|
     | ...  | ...  | ...  |
     ```
3. **Prose chunking.** Group paragraphs under the same heading. Target chunk size ~500 tokens, hard max 800. Break on paragraph boundaries, never mid-paragraph. Prefix with `Year: <N>. Section: <heading>.`
4. **Headings themselves** are not chunks. They become part of the `section_path` metadata and the prefix of nearby chunks.
5. Each chunk record: `{"id": <sha1>, "source_file": ..., "year": ..., "section_path": [...], "type": "prose"|"table"|"table_continuation", "text": ..., "token_count": ..., "metadata": {...}}`.
6. ID generation: `sha1(source_file + "::" + chunk_index + "::" + text)`. Deterministic.

**Verification before phase 3:**
- For each table in the canary: confirm the table exists as either one chunk or N contiguous chunks-with-repeated-headers. Zero orphan rows.
- Grep test from phase 1 must still pass on chunks.jsonl (all 10 numbers findable, and the chunk containing each number also contains the header row).
- Token count distribution looks sane (no 50-token chunks, no 3000-token chunks).

---

## Phase 3 — Embed and upsert (canary doc only)

Goals: get the canary's chunks into Qdrant and prove retrieval works.

1. New file: `ingestion/embed_and_upsert.py`. Reads chunks.jsonl, embeds with `text-embedding-3-small` in batches of 128, upserts to `wind_energy_v1`.
2. **Before upserting**, delete existing points where `source_file == <canary>` so we don't double-index. Use Qdrant's filter-based delete.
3. Payload per point: `{year, source_file, section_path, type, text, token_count}`. Match existing payload schema.
4. After upsert: run 5–10 hand-written test queries against Qdrant directly (Python script, not the full chat API). For each query, print top 5 results and verify the right chunk is in there. Especially queries that should retrieve table data.

**Verification before phase 4:**
- All 5–10 hand queries return relevant chunks in top 5.
- Eval harness run against canary-only: show me the delta vs baseline. (It may not be dramatic on one doc, but should not regress.)

---

## Phase 4 — Scale to all docx files

Goals: process the full corpus.

1. New file: `ingestion/ingest_all_docx.py`. Driver script.
2. Phase A: parallel parse all docx → elements.jsonl + md. Phase B: sequential chunk. Phase C: batched embed + upsert (still sequential to keep OpenAI rate limits sane, but batch within).
3. Resume-ability: skip docs whose parsed/chunked output exists and is newer than the source docx. Add a `--force` flag.
4. Produce a final report `ingestion/data/ingestion_report_<timestamp>.json` with: docs processed, docs skipped, docs failed, total chunks, total tokens embedded, estimated cost, list of warnings (text boxes found, images skipped, etc.).
5. Cost check: estimate before running. Should be in the same ballpark as the ~$0.30 we estimated for PDFs (probably less since docx has less boilerplate). If estimate is wildly off (>$2), stop and ask.

**Verification before declaring done:**
- Full eval harness run. Show me numbers vs baseline. Must improve on table-dependent questions.
- Random sample 5 docs from the full set: for each, do the grep-for-known-numbers test.
- Confirm Qdrant point count is reasonable (rough sanity: ~2-3 chunks per page equivalent).

---

## Phase 5 — Handle gaps (PDF fallback)

Goals: any content that exists only in PDF (not docx) still gets ingested.

1. From the inventory in phase 0, identify PDFs without docx equivalents and pages in docx files that are image-only (where data lives in charts/images).
2. For PDF-only docs: run the existing PDF pipeline (`ingest_one.py`) on just those. They go into the same collection with the same payload schema.
3. For image-only content within docx: this is a known limitation. Document it in `KNOWN_LIMITATIONS.md` and surface it in the ingestion report. Do not try to OCR in this rebuild — out of scope.

---

## Reporting back to me

At the end of each phase, send a status update with:
- What was done
- Verification results (numbers, not vibes)
- Any decisions you made that weren't pre-specified, and why
- Anything that surprised you about the data
- What you need from me to proceed

If you hit a fork in the road where two approaches are both reasonable and the choice matters, stop and ask. Do not pick silently.

---

## File layout when you're done

```
ingestion/
  parse_docx.py             # NEW — phase 1
  chunk_doc.py              # NEW — phase 2
  embed_and_upsert.py       # NEW — phase 3
  ingest_all_docx.py        # NEW — phase 4
  ingest_one.py             # UNCHANGED (PDF, kept as fallback)
  ingest_all.py             # UNCHANGED (PDF, kept as fallback)
  data/
    docx/<year>/*.docx      # NEW source location
    pdfs/<year>/*.pdf       # UNCHANGED
    parsed/<doc>.md         # NEW format
    parsed/<doc>.elements.jsonl  # NEW
    parsed/<doc>.chunks.jsonl    # SAME format, new content
    docx_inventory.json     # NEW
    ingestion_report_*.json # NEW
KNOWN_LIMITATIONS.md        # NEW
```

---

## One more thing

Read `parse_docx.py` like it's the most important file in the project. It is. Everything downstream — chunking, embedding, retrieval, the LLM's ability to answer questions about tables — depends on this step being lossless. If parsing is wrong, no amount of clever chunking or retrieval tuning will recover. Spend disproportionate care there.
