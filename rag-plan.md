# Wind Energy RAG Chatbot — Plan

## Goal
Build a chatbot for the company website that answers questions using 25 years of 
wind energy directories (one PDF per year, ~700 pages each, total ~17,500 pages). 
PDFs contain a mix of clean text, numerical tables, and scanned/image-based pages.

## Architecture Decision: Hybrid Python + TypeScript

```
[Hostinger VPS]
   └── Qdrant (Docker, port 6333)         ← vector DB, persistent storage

[One-time / re-runnable on dev machine]
   └── Python ingestion (/ingestion)      ← Docling parse, chunk, embed, push

[Production (Vercel or VPS)]
   └── Bun API (existing /src)            ← adds /chat route
        ├── embed user query (OpenAI)
        ├── search Qdrant (top-K, filter by year if requested)
        ├── optional rerank (Cohere or bge-reranker)
        └── stream answer from Claude/GPT with citations
```

**Why hybrid:** Python has Docling, Unstructured, and PaddleOCR — the JS ecosystem 
is significantly weaker on scanned-PDF + table extraction. But the query path 
(embed → search → LLM) is trivial in TypeScript and keeps the chat endpoint 
inside the existing Bun stack.

## Stack

| Layer            | Choice                              | Why                                    |
|------------------|-------------------------------------|----------------------------------------|
| PDF parsing      | Docling (primary)                   | Handles text, tables, OCR in one lib   |
| Chunking         | LlamaIndex-style token splitter     | 800 tokens, 100 overlap                |
| Embeddings       | OpenAI `text-embedding-3-small`     | $0.02/1M tokens, 1536 dims, great qual |
| Vector DB        | Qdrant (self-host on VPS)           | Free, Rust-fast, payload filters       |
| Reranker         | Cohere Rerank v3 (free tier OK)     | Big quality boost, low effort          |
| LLM (generation) | Claude Haiku 4.5 → Sonnet 4.6       | Cheap default, smart fallback          |
| Backend          | FastAPI? No — extend existing Bun   | One stack to operate                   |

## Sizing
- ~17,500 pages → ~50k–80k chunks → ~80k vectors at 1536 dims
- Qdrant RAM: ~1.5 GB total (vectors + payload + overhead)
- Even 2GB VPS is sufficient

## Cost Estimates
- Embedding entire corpus (one-time): **~$0.30**
- Per chat message: **$0.001–0.005** (Haiku), **$0.01–0.03** (Sonnet)
- Qdrant: **$0** (self-host)
- Reranker: free tier covers expected traffic

## Build Order

### Phase 1 — Parsing quality (THIS IS WHERE 70% OF EFFORT GOES)
1. Spin up Qdrant on VPS via Docker Compose. Verify reachable.
2. Run `ingestion/ingest_one.py` on ONE PDF with `--dry-run`.
3. **Manually inspect** `data/parsed/<pdf>.chunks.jsonl`:
   - Tables: are numbers preserved? Do markdown pipes render?
   - OCR: are scanned pages legible or word-salad?
   - Sections: are headings extracted meaningfully?
   - Sanity grep: is a known fact (e.g. "Tamil Nadu" capacity in a known year) findable?
4. If quality is poor, tune Docling settings (OCR engine, table mode) BEFORE scaling.
5. Only then run embed + push for that one PDF.

### Phase 2 — Optional table enrichment
If table chunks look like dense pipe-soup that embeddings won't handle well:
- Add a step that detects table-heavy chunks (has_table=True)
- Passes them through Claude Haiku to convert to natural-language summaries
- Stores BOTH the original table chunk AND the summary chunk
- Cost: ~$5–10 one-time for full corpus

### Phase 3 — Scale to all 25 PDFs
- Build `run_ingestion.py` that loops over `data/pdfs/<year>/*.pdf`
- Idempotent — re-running on same PDF just upserts
- Parallelize parsing (Docling uses CPU heavily; 2–4 workers max)

### Phase 4 — Eval set
- Hand-write ~30 questions with known correct answers from the PDFs
- Mix: factual lookups, multi-year comparisons, table-data queries, ambiguous
- Save to `eval/golden_questions.json`
- Build `eval/run_eval.py` that runs the full RAG pipeline and reports:
  - Hit rate (correct chunk in top-K?)
  - Answer quality (LLM-as-judge: 1–5)
- Re-run after every meaningful change.

### Phase 5 — TypeScript chat endpoint
Add to existing Bun server:
- `src/services/rag/qdrant.ts` — Qdrant client wrapper (typed)
- `src/services/rag/embed.ts` — OpenAI embedding call
- `src/services/rag/retrieve.ts` — search + optional rerank
- `src/services/rag/generate.ts` — Anthropic/OpenAI call with streaming
- `src/services/rag/prompts.ts` — system prompt with citation requirements
- `src/routes/chat.ts` — SSE streaming endpoint

### Phase 6 — Production hardening
- Rate limiting per IP / per session
- Conversation context (last N turns) — careful with token bloat
- Query rewriting (resolve "it", "that year") before embedding
- Logging: store all (query, retrieved_chunks, answer) for offline review
- Vercel function timeout caveat: chat may need to live on VPS not Vercel

## Open Questions / Decisions Pending
- [ ] OCR engine: Tesseract (default, free) vs PaddleOCR (better on tables-in-scans)
- [ ] Reranker: Cohere managed vs self-hosted bge-reranker-v2-m3
- [ ] Deploy chat endpoint to Vercel (timeout risk) or VPS alongside Qdrant
- [ ] Conversation memory: stateless per-request vs session store

## Security Notes
- Qdrant API key is REQUIRED — Qdrant has no auth by default
- Firewall port 6333 to known IPs OR bind to localhost + reverse proxy
- Never log full user queries with PII to public logs
- Sanitize/escape user input in prompts (basic prompt injection defense)