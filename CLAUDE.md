## RAG Chatbot Subsystem

We're adding a RAG (Retrieval-Augmented Generation) chatbot trained on 25 years 
of wind energy PDF directories (~17,500 pages total, mixed text + tables + scans).

### Architecture
- **Ingestion (Python, one-time / re-runnable):** lives in `/ingestion`. 
  Parses PDFs with Docling, chunks, embeds with OpenAI `text-embedding-3-small`, 
  pushes to Qdrant.
- **Vector DB:** Qdrant — runs locally in Docker during development
  (`ingestion/docker-compose.yml`, bound to `127.0.0.1` only), and on the
  Hostinger VPS for production. Migration is purely an `.env` change
  (`QDRANT_URL` + `QDRANT_API_KEY`); ingestion code reads both from env.
  Collection: `wind_energy_v1`. 1536-dim vectors, cosine distance. 
  Payload indexes on `year` (integer) and `source_file` (keyword).
- **Query API (TypeScript/Bun):** new `/chat` route in existing server.
  Embeds query → searches Qdrant → optional rerank → streams from Claude/GPT.

### Key files
- `ingestion/ingest_one.py` — single-PDF ingestion (start here, then scale)
- `ingestion/data/pdfs/<year>/` — source PDFs organized by year
- `ingestion/data/parsed/` — cached parsed markdown (gitignored)
- `src/services/rag/` — TS retrieval + generation (to be built)
- `src/routes/chat.ts` — chat endpoint (to be built)

### Environment
- `OPENAI_API_KEY` — embeddings
- `ANTHROPIC_API_KEY` — generation (Claude Haiku 4.5 default, Sonnet 4.6 for hard queries)
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
- Embeddings: ~$0.30 total for full 25-PDF corpus. Cheap.
- Per chat message: target <$0.01 with Haiku, <$0.03 with Sonnet.
- Never embed in a loop without batching (batch size 64).

### Testing protocol
- Before scaling to all 25 PDFs, run `ingest_one.py` on ONE PDF with `--dry-run`.
- Open `data/parsed/<pdf>.chunks.jsonl` and manually verify:
  1. Tables render as markdown tables with numbers intact
  2. OCR on scanned pages is legible
  3. Section headings are meaningful
  4. A known fact (e.g., a state's capacity in a known year) is findable via grep
- Only proceed to full ingestion after these pass.
