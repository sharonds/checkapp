import { fetchWithBackoff } from "../utils/fetch-backoff.ts";

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: {
    title?: string;
    url?: string;
    publishedAt?: string;
    snippet?: string;
  };
}

/**
 * Embed text via OpenRouter → OpenAI text-embedding-3-small at 768 dimensions.
 * The `dimensions` parameter truncates to 768 dims (cheaper storage, comparable
 * quality to the 1536-dim default for similarity search).
 */
export async function embed(text: string, openrouterKey: string): Promise<number[]> {
  const res = await fetchWithBackoff("https://openrouter.ai/api/v1/embeddings", {
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`,
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: text.slice(0, 8000),
        dimensions: 768,
      }),
    },
    maxRetries: 3,
    baseDelayMs: 1000,
  });
  if (!res.ok) throw new Error(`Embed ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  if (!json.data?.[0]?.embedding) throw new Error("Embed response missing data[0].embedding");
  return json.data[0].embedding;
}

export interface VectorizeQueryOpts {
  accountId: string;
  indexName: string;
  apiKey: string;
  vector: number[];
  topK?: number;
}

/**
 * Cloudflare Vectorize v2 /query — JSON body, standard REST.
 */
export async function vectorizeQuery(o: VectorizeQueryOpts): Promise<VectorMatch[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${o.accountId}/vectorize/v2/indexes/${o.indexName}/query`;
  const res = await fetchWithBackoff(url, {
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${o.apiKey}`,
      },
      body: JSON.stringify({
        vector: o.vector,
        topK: o.topK ?? 5,
        returnMetadata: "all",
      }),
    },
    maxRetries: 3,
    baseDelayMs: 1000,
  });
  if (!res.ok) throw new Error(`Vectorize query ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { result: { matches: VectorMatch[] } };
  return json.result?.matches ?? [];
}

export interface VectorizeUpsertOpts {
  accountId: string;
  indexName: string;
  apiKey: string;
  vectors: Array<{
    id: string;
    values: number[];
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Cloudflare Vectorize v2 /upsert — multipart/form-data with NDJSON file field.
 *
 * IMPORTANT (Codex R2): v2 upsert does NOT accept a JSON body with a `vectors`
 * array. It requires an NDJSON file upload (one JSON vector per line) as a
 * multipart form field named `vectors`. Earlier plan drafts had this wrong.
 */
export async function vectorizeUpsert(o: VectorizeUpsertOpts): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${o.accountId}/vectorize/v2/indexes/${o.indexName}/upsert`;
  const ndjson = o.vectors.map(v => JSON.stringify(v)).join("\n");
  const blob = new Blob([ndjson], { type: "application/x-ndjson" });
  const form = new FormData();
  form.append("vectors", blob, "vectors.ndjson");
  const res = await fetchWithBackoff(url, {
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${o.apiKey}` },
      // NOTE: do NOT set Content-Type manually — fetch sets multipart boundary
      body: form,
    },
    maxRetries: 3,
    baseDelayMs: 1000,
  });
  if (!res.ok) throw new Error(`Vectorize upsert ${res.status}: ${await res.text()}`);
}
