import OpenAI from "openai";

let client: OpenAI | null = null;

const MODEL = "text-embedding-3-small";

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  client = new OpenAI({ apiKey });
  return client;
}

export async function embedQuery(text: string): Promise<number[]> {
  const resp = await getClient().embeddings.create({ model: MODEL, input: text });
  const vec = resp.data[0]?.embedding;
  if (!vec) throw new Error("OpenAI returned no embedding");
  return vec;
}
