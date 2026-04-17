# Architecture

Technical reference for contributors and integrators.

## Overview

CheckApp is a single-binary CLI that checks AI-generated articles for plagiarism before they go live. It accepts a Google Doc URL, exports the plain text, submits it to Copyscape's content-search API, and renders a scored verdict in the terminal. An optional second layer using Parallel AI's Extract API enriches each match with the specific sentences that overlap between the article and the flagged source pages.

The tool is intentionally minimal: no database, no server, no cloud dependency beyond the APIs it calls. All state lives in one JSON file on disk.

---

## Engine Decision Log

| Engine | Cost | Decision | Reason |
|--------|------|----------|--------|
| **Copyscape** | ~$0.09 / 800-word article | **Primary engine** | Industry-standard verbatim plagiarism detection. Simple pay-as-you-go API, no subscription required, no Enterprise gate. Already integrated. |
| **Originality.ai** | $179/mo (Enterprise) | **Rejected** | Their public plans ($14.95/mo, $30 one-time credits) do not include API access. API is Enterprise-only at $179/month — not viable for a per-use CLI tool. Use the web UI manually if needed. |
| **Parallel Extract** | $0.001/URL | **Added (optional)** | Fills the evidence gap: Copyscape reports "89 words matched at healthline.com" but does not show *which* words. Parallel Extract fetches the full page text so a passage matcher can surface the exact copied sentences. Optional — if the key is absent the tool behaves identically to before. |
| **Parallel Search** | $0.005 / 10 results | **Future** | Semantic search layer for AI-convergence detection — finds structurally similar content that is not verbatim. Out of scope for the current release. |

---

## Data Flow

```
Google Doc URL
        │
        ▼
┌───────────────────────┐
│   gdoc.ts             │  Extract doc ID from URL, fetch plain text via
│   fetchGoogleDoc()    │  /export?format=txt (no auth for public docs),
│   countWords()        │  strip HTML, normalise whitespace
└──────────┬────────────┘
           │  plain text + word count
┌──────────▼────────────┐
│   copyscape.ts        │  POST to copyscape.com/api/ (csearch),
│   checkCopyscape()    │  parse XML response, compute similarity %,
│   parseResponse()     │  apply verdict thresholds
└──────────┬────────────┘
           │  CopyscapeResult { matches, similarityPct, verdict }
           │
           ├──────── no parallelApiKey? ─────────────────────────────────┐
           │                                                              │
┌──────────▼────────────┐  (optional — requires parallelApiKey in config)│
│   parallel.ts         │  POST top-3 match URLs to                      │
│   extractPages()      │  api.parallel.ai/v1beta/extract,               │
│                       │  return { url, content } for each              │
└──────────┬────────────┘                                                │
           │  ExtractPage[]                                              │
┌──────────▼────────────┐                                                │
│   passage.ts          │  Split article into sentences, find those      │
│   findMatchingPassages│  that appear verbatim (case-insensitive,       │
│                       │  >= 8 words) in each fetched page              │
└──────────┬────────────┘                                                │
           │  MatchedPassage[] { url, passages[] }                       │
           └─────────────────────────────────────────────────────────────┘
                                        │
                               ┌────────▼────────┐
                               │   check.tsx      │
                               │   Report         │  Ink/React component:
                               │                  │  verdict, word count,
                               │                  │  match list, passages
                               └─────────────────-┘
```

---

## Module Responsibilities

| File | Responsibility |
|------|---------------|
| `src/index.tsx` | Entry point. Parses CLI args (`--setup`, doc URL). Routes to `runSetup()` or `runCheck()`. Prints usage help when called with no arguments. |
| `src/config.ts` | Reads and writes `~/.checkapp/config.json`. Exports `Config` interface, `configExists()`, `readConfig()`, `saveConfig()`, `configPath()`. |
| `src/gdoc.ts` | Extracts the doc ID from any Google Docs URL format, fetches plain text via the public export endpoint, cleans the text, counts words. Throws with a human-readable message on auth errors or redirect-to-login responses. |
| `src/copyscape.ts` | Posts article text to the Copyscape content-search API, parses the XML response into a typed `CopyscapeResult`, applies verdict thresholds, handles the "insufficient credits" error as a non-fatal warning. |
| `src/setup.tsx` | Ink/React interactive wizard that collects Copyscape username, Copyscape API key, and (optionally) a Parallel AI API key. Saves all credentials to disk via `config.ts`. |
| `src/check.tsx` | Ink/React component that orchestrates the full check flow: reading → checking → enriching (optional) → done/error. Renders the `Report` component with the final result and any matched passages. |
| `src/parallel.ts` | *(planned)* Parallel Extract API client. Accepts a list of URLs and an API key, POSTs to `https://api.parallel.ai/v1beta/extract`, returns `ExtractPage[]` with `{ url, content }`. |
| `src/passage.ts` | *(planned)* Passage matcher. Splits article text into sentences, filters those with fewer than 8 words, and returns those that appear verbatim (case-insensitive) in a given page content string. |

---

## Planned New Modules

### `src/parallel.ts`

Parallel Extract API client.

```typescript
export interface ExtractPage {
  url: string;
  content: string;
}

export async function extractPages(
  urls: string[],
  apiKey: string
): Promise<ExtractPage[]>
```

- Endpoint: `POST https://api.parallel.ai/v1beta/extract`
- Auth header: `x-api-key: <apiKey>`
- Request body: `{ urls, full_content: true, excerpts: false }`
- Maps `full_content ?? ""` for each result
- Throws `"Parallel Extract API error: HTTP <status>"` on non-2xx

### `src/passage.ts`

Sentence-level passage matcher.

```typescript
export function findMatchingPassages(
  articleText: string,
  pageContent: string
): string[]
```

- Splits `articleText` on sentence-ending punctuation (`[.!?]`) followed by whitespace
- Skips sentences with fewer than 8 words
- Returns sentences whose lowercase form appears in the lowercase page content
- Best-effort: false positives are possible for common phrases; the 8-word minimum reduces noise

---

## Config Schema

Stored at `~/.checkapp/config.json`. Created on first run by the setup wizard.

```json
{
  "copyscapeUser": "you@example.com",
  "copyscapeKey": "your-copyscape-api-key",
  "parallelApiKey": "pk_..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `copyscapeUser` | string | Yes | Copyscape account username (email address) |
| `copyscapeKey` | string | Yes | Copyscape API key — found at My Account → API |
| `parallelApiKey` | string | No | Parallel AI API key — enables passage-level evidence; omit to skip enrichment |

The file is written with `JSON.stringify(config, null, 2)`. An existing config that does not include `parallelApiKey` continues to work — the field is typed as optional (`parallelApiKey?: string`) and resolves to `undefined` when absent.

---

## Verdict Thresholds

Defined as constants in `src/copyscape.ts`:

```typescript
const THRESHOLD_REVIEW  = 16;  // 16%+ → review
const THRESHOLD_REWRITE = 26;  // 26%+ → rewrite
```

| Similarity | Verdict | Meaning |
|-----------|---------|---------|
| 0 – 15% | `publish` | No significant overlap. Normal for AI content that draws from common sources. |
| 16 – 25% | `review` | Meaningful overlap with one or more indexed pages. Worth checking the listed sources manually before publishing. |
| 26%+ | `rewrite` | Similarity is high enough to pose a real legal or reputational risk. Rewrite the flagged sections before publishing. |

Similarity is computed as `round((matchedWords / totalWords) * 100)` where `matchedWords` and `totalWords` are returned directly by Copyscape.

To make thresholds configurable at runtime, a config flag approach is tracked in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Adding a New Engine

To add a third plagiarism engine (e.g. Originality.ai if they ever open their API):

1. **Create `src/<engine>.ts`** — export a single `check<Engine>(text, config)` function that returns either `CopyscapeResult` or its own typed result. Keep the interface consistent with the existing result shape if you want to reuse the `Report` component in `check.tsx`.

2. **Add credentials to `Config`** in `src/config.ts` — add optional fields (e.g. `originalityKey?: string`).

3. **Add a setup step** in `src/setup.tsx` — follow the same pattern as the Parallel AI key step (optional, Enter to skip, dimmed hint text).

4. **Wire into `check.tsx`** — check whether the config field is present, call your engine, merge or display results alongside Copyscape output. Make it best-effort (catch errors, don't abort the whole check).

5. **Document in README** under `## Plagiarism Engines` — include cost, what it adds, and how to set it up.

6. **Write tests** — unit tests for response parsing and error handling. See `src/parallel.test.ts` as a model; mock `global.fetch` per test using `bun:test`'s `mock()`.

No shared engine interface is enforced by a TypeScript `interface` today — the codebase is small enough that convention is sufficient. If you are adding a second full peer to Copyscape (not just an enrichment layer), consider defining a shared `EngineResult` interface to keep `check.tsx` manageable.

---

## Cost Model

| Step | Engine | Cost per 800-word article |
|------|--------|--------------------------|
| Plagiarism check | Copyscape | ~$0.09 ($0.03 base + $0.01/extra 100 words above 200) |
| Passage enrichment (3 URLs) | Parallel Extract | ~$0.003 ($0.001 × 3 URLs) |
| **Total with enrichment** | | **~$0.093** |
| **Total without enrichment** | | **~$0.09** |

Copyscape charges per search, not per month. Minimum top-up is $5 (~55 checks). Parallel AI offers a free tier of 16,000 extract requests before billing begins.
