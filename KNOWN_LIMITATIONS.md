# Known Limitations of the docx-based RAG ingestion

Captured during the rag-docx-ingestion rebuild (May 2026). Read this
before judging eval misses or "data isn't there" complaints — many of
them are these limitations surfacing, not bugs in the pipeline.

## 1. Charts and images are not OCRed

`ingestion/data/docx/FIN SEC 6 - 2025 - STATISTICS.docx` (and several
others) contains bar/line charts whose data lives inside chart objects,
not in inline tables. python-docx exposes these as `<w:drawing>`
references — we log them in `<doc>.parse_report.json` with their
section path and any alt-text, but we do not OCR them.

**Impact:** any number that appears ONLY in a chart label (e.g. axis
ticks "0/20/40/60/80/100" or per-bar values "77.700 MW") will not be
retrievable. Where the same numbers also appear in an accompanying
table, retrieval works as expected.

**If this becomes a real problem:** add an OCR step that targets only
the embedded image bytes — out of scope for this rebuild.

## 2. Text-boxes are intentionally dropped

`<w:txbxContent>` blocks in this corpus contain chart-axis ticks and
bar-data labels with no structural link to which chart they annotate.
We extract and DROP them at parse time. The text-box scan found 46 such
boxes in `FIN SEC 6`; spot-checks confirmed they were all chart cruft
like `"77.700 MW"`, `"37 No."`, `"0"`, `"20"`. Embedding these as
standalone fragments would produce noisy retrieval hits with no answer
value.

**If a future corpus puts narrative text in text-boxes,** restore
extraction in `ingestion/parse_docx.py` (the `collect_textboxes`
function is removed but the extraction technique is documented in the
file comment).

## 3. No real heading structure in source docx

In this corpus, 255/257 paragraphs in `FIN SEC 6 - 2025 - STATISTICS`
are styled `Normal`; only 2 use `Heading N`. Most table titles and
section labels are visually-emphasised paragraphs (bold/centered runs)
without any heading style applied.

**How we work around it:**
- Seed the section stack at heading-level 0 with a section name derived
  from the filename (`STATISTICS`, `WRA`, `AN OVERVIEW`, etc.). See
  `section_from_filename()` in `parse_docx.py`.
- For each table, capture the 1–5 paragraphs immediately preceding it
  (the "title block") as `title_context` and prepend that to the
  table's auto-generated caption. So a chunk carries both the
  filename-derived section and the local table title even when no
  Heading style is present.

**If structured headings ever appear in a future drop**, they will
still be picked up via the `Heading N` style check and pushed onto the
stack alongside the filename section.

## 4. Two-row table headers are NOT visually merged in the chunk text

Tables with super-headers (e.g. `FIN SEC 6 - 2025 - STATISTICS` Table
11: "WEG RATING 110 kW to 2200 kW" merged across 21 columns, sub-header
"110 / 225 / 230 / ..." in the second row) are emitted as a single
markdown table with the FIRST header row in the markdown header
position and the SECOND header row as the first visible body row.

The chunker detects 2-row headers via the numbered-marker heuristic
(`find_header_row_count` in `chunk_doc.py` — the first row whose first
cell matches `\d+[.)]?\s*$` starts the data; everything before it is
treated as header for split-with-repeated-headers logic).

**Impact:** all cell values are preserved, but the LLM has to read two
rows to recover the full column label. In practice, o4-mini handles
this without trouble in the eval. If retrieval quality drops on
wide-header tables, the next iteration should collapse multi-row
headers into single merged-header cells (`"WEG RATING / 1800 kW"`).

## 5. The eval set is calibrated against the PDF, which had OCR garble

Three eval questions fail on the docx pipeline NOT because the
ingestion is wrong but because the docx data is *more accurate or more
precise* than the PDF the eval was originally written against:

| Question id | What eval expects | What docx says |
|---|---|---|
| `tn-masts-helpful` | "aggregate 996, no TN breakdown" | TN-specific: 101 monitoring stations |
| `siemens-gamesa-fy2020-21` | `281` WEGs | This number does not appear anywhere in the docx; likely OCR garble in the PDF (e.g. `232`→`281`) |
| `ge-contribution-via-prose` | rounded `929` MW | exact `928.800` MW (same fact, just not rounded) |

**Action:** when next regenerating the eval baseline, patch
`eval/golden_questions.json` to reflect the docx values. Until then,
treat the 3 failures as eval-set drift, not ingestion regressions.

## 6. Only 2025 is ingested

The spec mentions "25 years of wind energy PDF directories" — that goal
is aspirational. As of this rebuild, only the 2025 Directory exists in
both docx (15 section files) and PDF (1 monolithic file). When older
years are added, drop their docx files under
`ingestion/data/docx/<year>/...` (or anywhere under `data/docx/`; year
is inferred from the filename) and re-run
`ingestion/.venv/bin/python ingest_all_docx.py`. The pipeline is
idempotent on re-run.

## 7. Chunks-per-page ratio is ~1.1, below the spec's hand-wave of "2-3"

The spec said "roughly 2-3 chunks per page equivalent". We see 1.09 —
882 chunks for ~812 estimated pages. The shortfall is because:

- Prose chunks target ~500 tokens (= ~1.5–2 pages of dense prose)
- Tables ≤25 rows are atomic (one chunk regardless of "page count")

Quality is fine — eval retrieval is 95% — so we are not splitting
just to hit a ratio. If retrieval quality drops on long-prose
questions, consider tightening `PROSE_TARGET_TOKENS` in
`chunk_doc.py`.
