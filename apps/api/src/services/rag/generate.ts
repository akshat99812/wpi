import OpenAI from "openai";

// Generation is provider-chained: try xAI Grok first (when XAI_API_KEY is set),
// and on any failure or rate-limit before the first token is emitted, fall back
// to OpenAI o4-mini. If XAI_API_KEY is unset, OpenAI is the only provider.
// Embeddings always use OpenAI (see embed.ts), so OPENAI_API_KEY is required
// regardless. Eval (eval/run_eval.py) still uses OpenAI directly.

type Provider = "xai" | "openai";

const XAI_MODEL = process.env.XAI_MODEL || "grok-4-fast-reasoning";
const HAS_XAI = Boolean(process.env.XAI_API_KEY);
const HAS_OPENAI = Boolean(process.env.OPENAI_API_KEY);

const MODEL_FOR: Record<Provider, string> = {
  xai: XAI_MODEL,
  openai: "o4-mini",
};

const clients: Partial<Record<Provider, OpenAI>> = {};

function clientFor(provider: Provider): OpenAI {
  const existing = clients[provider];
  if (existing) return existing;
  if (provider === "xai") {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error("XAI_API_KEY is not set");
    return (clients.xai = new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" }));
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return (clients.openai = new OpenAI({ apiKey }));
}

// Primary first, fallback second. Grok preferred when its key is present.
function providerChain(): Provider[] {
  const chain: Provider[] = [];
  if (HAS_XAI) chain.push("xai");
  if (HAS_OPENAI) chain.push("openai");
  if (chain.length === 0) {
    throw new Error("No generation provider configured: set XAI_API_KEY and/or OPENAI_API_KEY");
  }
  return chain;
}

// Model label reported to the client in the SSE `meta` event — the primary
// provider's model. A silent fallback to OpenAI won't update this label.
export const MODELS = {
  mini: HAS_XAI ? XAI_MODEL : "o4-mini",
} as const;
export type ModelKey = keyof typeof MODELS;

export interface StreamOptions {
  system: string;
  user: string;
  model?: ModelKey;
  maxTokens?: number;
}

// Yields text deltas as they arrive. Caller pipes each delta to SSE.
// Both backends accept the OpenAI chat.completions schema. Differences:
//   - OpenAI o-series uses max_completion_tokens; xAI Grok accepts max_tokens.
// Fallback only happens before the first delta is emitted — once the client
// has seen partial output we cannot safely restart on a different provider.
export async function* streamAnswer(opts: StreamOptions): AsyncGenerator<string> {
  // 8192 covers long table dumps (101-row mast tables ~5-7k visible tokens
  // plus reasoning overhead). Short answers won't use the headroom.
  const budget = opts.maxTokens ?? 8192;
  const chain = providerChain();
  let lastErr: unknown;

  for (const [i, provider] of chain.entries()) {
    const isLast = i === chain.length - 1;
    let emitted = false;
    try {
      const tokenParam =
        provider === "xai"
          ? { max_tokens: budget }
          : { max_completion_tokens: budget };
      const stream = await clientFor(provider).chat.completions.create({
        model: MODEL_FOR[provider],
        stream: true,
        ...tokenParam,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emitted = true;
          yield delta;
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      if (emitted || isLast) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[chat] generation provider "${provider}" failed (${msg}); falling back to "${chain[i + 1]}"`,
      );
    }
  }
  throw lastErr;
}
