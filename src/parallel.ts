const PARALLEL_EXTRACT_URL = "https://api.parallel.ai/v1beta/extract";

export interface ExtractPage {
  url: string;
  content: string;
  /** Set when Parallel could not fetch this URL (e.g. paywalled pages) */
  error?: string;
}

interface ParallelExtractResponse {
  extract_id: string;
  results: Array<{
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts?: string[] | null;
    full_content?: string | null;
  }>;
  errors?: Array<{ url: string; message: string }>;
  warnings?: string | null;
  usage?: Array<{ name: string; count: number }>;
}

export async function extractPages(
  urls: string[],
  apiKey: string
): Promise<ExtractPage[]> {
  const response = await fetch(PARALLEL_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      urls,
      objective: "Extract all text content from this page",
      excerpts: false,
      full_content: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Parallel Extract API error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as ParallelExtractResponse;

  const successful: ExtractPage[] = data.results.map((r) => ({
    url: r.url,
    content: r.full_content ?? "",
  }));

  // Surface per-URL failures (paywalls, 403s, etc.) as entries with empty
  // content so callers can show an "unavailable" note rather than silently
  // omitting the source.
  const failed: ExtractPage[] = (data.errors ?? []).map((e) => ({
    url: e.url,
    content: "",
    error: e.message,
  }));

  return [...successful, ...failed];
}
