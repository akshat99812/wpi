import OpenAI from "openai";

// Generation backend is env-gated:
//   - If XAI_API_KEY is set → xAI Grok (OpenAI-compatible API, baseURL https://api.x.ai/v1).
//   - Else → OpenAI o4-mini (the original path).
// This keeps the chat working until the xAI key is provisioned, then flips
// over automatically on restart. Eval (eval/run_eval.py) still uses OpenAI.

let client: OpenAI | null = null;

const USING_XAI = Boolean(process.env.XAI_API_KEY);
const XAI_MODEL = process.env.XAI_MODEL || "grok-4-fast-reasoning";

export const MODELS = {
  mini: USING_XAI ? XAI_MODEL : "o4-mini",
} as const;
export type ModelKey = keyof typeof MODELS;

function getClient(): OpenAI {
  if (client) return client;
  if (USING_XAI) {
    client = new OpenAI({
      apiKey: process.env.XAI_API_KEY!,
      baseURL: "https://api.x.ai/v1",
    });
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export interface StreamOptions {
  system: string;
  user: string;
  model?: ModelKey;
  maxTokens?: number;
}

// Yields text deltas as they arrive. Caller pipes each delta to SSE.
// Both backends accept the OpenAI chat.completions schema. Differences:
//   - OpenAI o-series uses max_completion_tokens; xAI Grok models accept
//     max_tokens. We send max_tokens to xAI for compatibility, and
//     max_completion_tokens to OpenAI o-series (deprecated max_tokens
//     for o-series returns an error).
export async function* streamAnswer(opts: StreamOptions): AsyncGenerator<string> {
  const model = MODELS[opts.model ?? "mini"];
  // 8192 covers long table dumps (101-row mast tables ~5-7k visible tokens
  // plus reasoning overhead). Short answers won't use the headroom; the
  // model stops on EOS.
  const budget = opts.maxTokens ?? 8192;
  const tokenParam = USING_XAI
    ? { max_tokens: budget }
    : { max_completion_tokens: budget };
  const stream = await getClient().chat.completions.create({
    model,
    stream: true,
    ...tokenParam,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
