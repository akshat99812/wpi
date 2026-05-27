import { QdrantClient } from "@qdrant/js-client-rest";

let client: QdrantClient | null = null;

export const COLLECTION = process.env.QDRANT_COLLECTION || "wind_energy_v1";

export function getQdrant(): QdrantClient {
  if (client) return client;
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url) throw new Error("QDRANT_URL is not set");
  if (!apiKey) throw new Error("QDRANT_API_KEY is not set");
  client = new QdrantClient({ url, apiKey });
  return client;
}
