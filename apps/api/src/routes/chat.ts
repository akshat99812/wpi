import { Router, Request, Response } from "express";
import { requirePro } from "../middleware/requirePro";
import { retrieve } from "../services/rag/retrieve";
import { SYSTEM_PROMPT, buildUserPrompt } from "../services/rag/prompts";
import { MODELS, streamAnswer, type ModelKey } from "../services/rag/generate";

const router = Router();

interface ChatBody {
  query?: unknown;
  year?: unknown;
  model?: unknown;
  topK?: unknown;
}

function parseYear(raw: unknown): number | [number, number] | undefined {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (Array.isArray(raw) && raw.length === 2) {
    const [a, b] = raw;
    if (typeof a === "number" && typeof b === "number") return [a, b];
  }
  return undefined;
}

function parseModel(raw: unknown): ModelKey | undefined {
  return raw === "mini" ? raw : undefined;
}

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /api/chat — RAG-backed chat over the wind-energy corpus. SSE stream.
// Pro-gated. Body: { query: string, year?: number|[number,number], model?: "haiku"|"sonnet", topK?: number }
router.post("/chat", ...requirePro, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as ChatBody;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  const year = parseYear(body.year);
  const model = parseModel(body.model);
  const topK =
    typeof body.topK === "number" && body.topK > 0 && body.topK <= 30
      ? Math.floor(body.topK)
      : 15;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Client disconnect — best-effort cancel.
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    const result = await retrieve(query, { topK, year });
    if (aborted) return;

    sseWrite(res, "meta", {
      model: MODELS[model ?? "mini"],
      rewrite: {
        original: result.original,
        canonical: result.canonical,
        expansions: result.expansions,
      },
      sources: result.chunks.map((c, i) => ({
        n: i + 1,
        source_file: c.source_file,
        year: c.year,
        section: c.section,
        page_start: c.page_start,
        page_end: c.page_end,
        score: Number(c.score.toFixed(4)),
      })),
    });

    // Pass canonical (typo/abbrev-fixed) to LLM so it doesn't get confused
    // when the user's typo doesn't match the corpus's spelling.
    const user = buildUserPrompt(result.canonical, result.chunks);
    for await (const delta of streamAnswer({ system: SYSTEM_PROMPT, user, model })) {
      if (aborted) return;
      sseWrite(res, "delta", { text: delta });
    }
    sseWrite(res, "done", { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    sseWrite(res, "error", { message });
  } finally {
    res.end();
  }
});

export default router;
