## RAG Chatbot Subsystem

We're adding a RAG (Retrieval-Augmented Generation) chatbot trained on 25 years 
of wind energy PDF directories (~17,500 pages total, mixed text + tables + scans).

### Architecture
- **Ingestion (Python, one-time / re-runnable):** lives in `/ingestion`. 
  Parses PDFs with Docling, chunks, embeds with OpenAI `text-embedding-3-small` 
  (1536-dim native, cosine), pushes to Qdrant.
- **Vector DB:** Qdrant — runs locally in Docker during development
  (`ingestion/docker-compose.yml`, bound to `127.0.0.1` only), and on the
  Hostinger VPS for production. Migration is purely an `.env` change
  (`QDRANT_URL` + `QDRANT_API_KEY`); ingestion code reads both from env.
  Collection: `wind_energy_v1`. 1536-dim vectors, cosine distance. 
  Payload indexes on `year` (integer) and `source_file` (keyword).
- **Query API (TypeScript/Bun):** `/api/chat` route on the existing Bun/Express
  server (Pro-gated via `requirePro` middleware). Embeds query (OpenAI) →
  searches Qdrant → streams answer from OpenAI o4-mini over SSE.

### Key files
- `ingestion/ingest_one.py` — single-PDF ingestion (start here, then scale)
- `ingestion/ingest_all.py` — multi-PDF driver (phase A parallel parse, phase B sequential embed+upsert)
- `ingestion/data/pdfs/<year>/` — source PDFs organized by year
- `ingestion/data/parsed/` — cached parsed markdown (gitignored)
- `apps/api/src/services/rag/` — TS retrieval + generation
- `apps/api/src/routes/chat.ts` — SSE chat endpoint
- `apps/web/app/chat/page.tsx` — Pro-gated chat UI (consumes SSE)
- `eval/golden_questions.json` + `eval/run_eval.py` — quality regression harness

### Environment
- `OPENAI_API_KEY` — embeddings (`text-embedding-3-small`, same at ingest and query time) AND generation (`o4-mini`). One key, two uses.
- `QDRANT_URL`, `QDRANT_API_KEY` — vector DB
- `QDRANT_COLLECTION=wind_energy_v1`

### Conventions
- Chunk text always prefixed with `Year: <N>. Section: <heading>.` so embeddings 
  capture temporal + structural context.
- Chunk IDs are deterministic sha1 hashes — re-running ingestion is idempotent.
- Always cache parsed markdown to `data/parsed/`. Docling parsing is slow (5–30 min 
  per 700-page PDF) — never re-parse unless source PDF changed.
- For Qdrant filters: prefer `must=[FieldCondition(key="year", range=Range(gte=X, lte=Y))]`.

### Cost guardrails
- Embeddings: OpenAI `text-embedding-3-small` at $0.02/M tokens —
  the full ~17.5k-page / ~45k-chunk corpus costs ~$0.30 one-time.
  (Switched off Gemini free tier — its 1000 embed reqs/day cap can't
  fit the corpus in one run.)
- Generation: OpenAI `o4-mini` (reasoning model). Per chat message target
  <$0.02 including reasoning tokens. `max_completion_tokens=2048` in the
  chat route — note that o4-mini's reasoning tokens count against this
  budget, so don't drop it below ~1024 without testing.
- Always batch embed calls (batch size 128; OpenAI accepts up to ~2048
  inputs per request).

### Testing protocol
- Before scaling to all 25 PDFs, run `ingest_one.py` on ONE PDF with `--dry-run`.
- Open `data/parsed/<pdf>.chunks.jsonl` and manually verify:
  1. Tables render as markdown tables with numbers intact
  2. OCR on scanned pages is legible
  3. Section headings are meaningful
  4. A known fact (e.g., a state's capacity in a known year) is findable via grep
- Only proceed to full ingestion after these pass.
