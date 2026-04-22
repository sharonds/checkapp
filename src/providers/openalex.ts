import type { SSPaper } from "./semanticscholar.ts";

export interface OaSearchOptions {
  mailto?: string;
}

interface OaAuthorship { author?: { display_name?: string } }

interface OaWork {
  id: string;
  doi?: string | null;
  title: string | null;
  publication_year?: number;
  authorships?: OaAuthorship[];
  primary_location?: { landing_page_url?: string };
}

interface OaResponse { results?: OaWork[] }

/**
 * Search OpenAlex for papers matching a query.
 *
 * OpenAlex is a free, open academic-metadata service with ~250M indexed works.
 * Using the polite pool (via `mailto` param) grants 100k requests/day. No API
 * key is required for the polite pool; the `mailto` identifies the client for
 * soft rate limiting.
 *
 * Returns up to `limit` papers in the same `SSPaper` shape as `ssSearch` so
 * callers can swap providers without changing downstream logic. Returns an
 * empty array on any error — caller treats zero results as a warn (no academic
 * support for this claim), not a hard failure.
 */
export async function oaSearch(
  query: string,
  limit = 3,
  opts: OaSearchOptions = {},
): Promise<SSPaper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,doi,title,publication_year,authorships,primary_location,type");
  url.searchParams.set("filter", "type:article|review");
  if (opts.mailto) url.searchParams.set("mailto", opts.mailto);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const json = (await res.json()) as OaResponse;
    const works = json.results ?? [];
    return works.map((w) => ({
      paperId: w.id,
      title: w.title ?? "",
      year: w.publication_year,
      authors: (w.authorships ?? [])
        .map((a) => ({ name: a.author?.display_name ?? "" }))
        .filter((a) => a.name.length > 0),
      externalIds: w.doi ? { DOI: w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") } : undefined,
      url: w.primary_location?.landing_page_url ?? (w.doi ?? undefined),
    }));
  } catch {
    return [];
  }
}
