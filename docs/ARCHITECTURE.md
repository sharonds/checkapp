# Architecture

Technical reference for contributors and integrators.

## Overview

CheckApp is a local-first content quality application with a CLI, MCP server, and Next.js dashboard. It can check local files or public Google Docs, run configured skills such as plagiarism, fact-checking, AI detection, SEO, tone, legal, brief matching, and summary/purpose analysis, then persist local history/context data in SQLite at `~/.checkapp/history.db`.

The project is still intentionally lightweight: it does not require a hosted CheckApp backend or user authentication. External cloud dependencies are limited to configured providers such as Copyscape, Gemini, Exa, Parallel, LanguageTool, Semantic Scholar, OpenAlex, and optional LLM/vector providers. Copyscape and Parallel remain provider-specific pieces of the plagiarism flow, not the whole application architecture.

---

## Structured Audit Contract

CheckApp supports an additive structured audit contract for fact/plagiarism coverage work. The stable public boundary remains `SkillResult[]` in `results`; audit-producing paths may also return a normal `SkillResult` with an optional versioned `AuditRecord`.

The fact-check and plagiarism paths now emit structured audit data when they perform provider-backed checks. The audit layer segments the source document, records language/direction metadata for Hebrew, English, and mixed content, maps provider claims/passages back to exact document quotes where possible, and records coverage counts, skip reasons, budget stop reasons, provider attempts, evidence, confidence rationale, and suggested rewrites.

Basic and Standard sync fact-checking intentionally default to four checked claims through `src/audit/budget.ts`; this preserves the existing low-cost behavior. Configurable `factAudit.standardMaxClaims`, `factAudit.deepMaxClaims`, and provider-call budget values can change selection. When a budget stops selection, structured coverage uses specific reasons such as `claim_cap` or `provider_call_budget`, and report summaries explain the skip reason.

Core modules:

| File | Responsibility |
|------|---------------|
| `src/audit/types.ts` | Versioned `AuditRecord`, finding extensions, runtime parsing, URL/error sanitizers. |
| `src/audit/document.ts` | Deterministic document segmentation, language/direction detection, quote-to-location mapping, and rewrite helper text. |
| `src/audit/localization.ts` | English/Hebrew labels for structured audit reports, locations, verdict text, and deterministic UI summaries. |
| `src/audit/contribution.ts` | Compatibility layer for skills returning either plain `SkillResult`, `SkillResult & { audit }`, or `{ result, audit }`. |
| `src/audit/coverage.ts` | Deterministic coverage aggregation helpers. |
| `src/audit/budget.ts` | Deterministic cap/budget resolution from optional `factAudit` config. |
| `src/audit/provider-capabilities.ts` | Conservative provider/model capability matrix. |
| `src/audit/provider-contract.ts` | Fake-provider contract helpers for retry/error/evidence normalization. |
| `shared/check-summary.ts` | Single public-summary projection used by dashboard list/search and MCP `list_reports`; excludes full findings, audit records, provider attempts, search queries, and article text. |
| `shared/report-url.ts` | Shared source URL/label sanitizers used by CLI reports, exports, dashboard detail pages, and filenames. |

Persistence:

- `checks.audit_json` stores optional structured audit data beside `results_json`.
- `getCheckById`, dashboard detail APIs, MCP `get_report`, and JSON paths may expose parsed `audit`.
- Recent/list/search APIs omit full audit records and full result findings through the shared `publicCheckSummary()` projection. They expose only summary fields such as score, verdict, cost, and counts.
- Unknown future `AuditRecord.version` values are not rendered as trusted structured audit details.
- Report/dashboard localization is deterministic and limited to CheckApp-owned UI labels. Provider names, URLs, titles, claims, article quotes, evidence snippets, and model output are displayed in their original text with `dir="auto"` where mixed-direction content is expected.

Provider safety:

- Required tests use fake providers only.
- Provider errors are sanitized before persistence or rendering.
- Unsafe source URLs are rejected before display.

---

## Engine Decision Log

| Engine | Cost | Decision | Reason |
|--------|------|----------|--------|
| **Copyscape** | ~$0.09 / 800-word article | **Primary engine** | Industry-standard verbatim plagiarism detection. Simple pay-as-you-go API, no subscription required, no Enterprise gate. Already integrated. |
| **Originality.ai** | $179/mo (Enterprise) | **Rejected** | Their public plans ($14.95/mo, $30 one-time credits) do not include API access. API is Enterprise-only at $179/month — not viable for a per-use CLI tool. Use the web UI manually if needed. |
| **Parallel Extract** | $0.001/URL | **Added (optional)** | Fills the evidence gap: Copyscape reports "89 words matched at healthline.com" but does not show *which* words. Parallel Extract fetches the full page text so a passage matcher can surface the exact copied sentences. Optional — if the key is absent the tool behaves identically to before. |
| **Parallel Search** | $0.005 / 10 results | **Future** | Semantic search layer for AI-convergence detection — finds structurally similar content that is not verbatim. Out of scope for the current release. |

---

## Plagiarism Provider Flow

The diagram below covers the Copyscape + optional Parallel plagiarism path. Other skills use their own provider adapters and are orchestrated through the shared skill registry / `SkillResult` pipeline.

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
| `src/copyscape.ts` | Posts article text to the Copyscape content-search API, parses the XML response into a typed `CopyscapeResult`, applies verdict thresholds, and maps insufficient credits to a skipped result rather than a content-quality pass. |
| `src/setup.tsx` | Ink/React interactive wizard that collects Copyscape username, Copyscape API key, and (optionally) a Parallel AI API key. Saves all credentials to disk via `config.ts`. |
| `src/check.tsx` | Ink/React component that orchestrates the full check flow: reading → checking → enriching (optional) → done/error. Renders the `Report` component with the final result and any matched passages. |
| `src/parallel.ts` | Parallel Extract API client. Accepts a list of URLs and an API key, POSTs to `https://api.parallel.ai/v1beta/extract`, returns `ExtractPage[]` with `{ url, content }`. |
| `src/passage.ts` | Passage matcher. Splits article text into sentences, filters those with fewer than 8 words, and returns those that appear verbatim (case-insensitive) in a given page content string. |

---

## Implemented Plagiarism Support Modules

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

Stored at `~/.checkapp/config.json` with owner-only permissions where the filesystem supports POSIX modes. Created on first run by the setup wizard or dashboard settings.

```json
{
  "copyscapeUser": "you@example.com",
  "copyscapeKey": "your-copyscape-api-key",
  "geminiApiKey": "your-gemini-api-key",
  "factCheckTier": "standard",
  "factCheckTierFlag": true,
  "providers": {
    "fact-check": { "provider": "gemini-grounded" },
    "plagiarism": { "provider": "gemini-grounded-plagiarism" }
  },
  "skills": {
    "plagiarism": true,
    "aiDetection": true,
    "seo": true,
    "factCheck": true
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `copyscapeUser` | string | Yes | Copyscape account username (email address) |
| `copyscapeKey` | string | Yes | Copyscape API key — found at My Account → API |
| `parallelApiKey` | string | No | Parallel AI API key — enables passage-level evidence; omit to skip enrichment |
| `geminiApiKey` | string | No | Gemini API key for Standard/Deep Audit fact-check, Gemini AI detection, and grounded plagiarism when selected |
| `providers` | object | No | Per-skill provider routing; see `src/providers/registry.ts` |
| `skills` | object | No | Per-skill enablement flags |
| `thresholds` | object | No | Per-skill pass/warn thresholds |
| `factCheckTier` / `factCheckTierFlag` | string / boolean | No | Opt-in tier selection for Standard/Deep Audit flows |

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
