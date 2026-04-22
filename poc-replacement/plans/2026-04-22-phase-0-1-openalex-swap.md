# Citations Fix: OpenAlex Replaces Semantic Scholar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Semantic Scholar with OpenAlex as the academic-citations provider to fix the production bug where SS's free tier returns HTTP 429 on every call from shared IPs. Preserve the existing Semantic Scholar code path as a legacy fallback for users with an explicit `providers.academic` config entry. Zero default-behavior change when `OPENALEX_MAILTO` is unset.

**Architecture:** Add OpenAlex as a first-class provider in `ProviderId` and the registry. Create `src/providers/openalex.ts` mirroring the existing `ssSearch` interface so callers can swap providers with no downstream shape change. Extend `resolveProvider` to prefer OpenAlex for the `academic` skill when `openalexMailto` is configured. Academic skill reads the resolver's result and dispatches to the correct client.

**Tech Stack:** TypeScript strict, Bun, `bun:test`, existing Node `fetch` (no new deps). Test mocking uses the repo's existing `src/testing/mock-fetch.ts` helpers (`mockFetch` + `urlRouter` + `jsonResponse`).

**Prerequisites:** Plan 3 research is complete. See `poc-replacement/DECISION-MATRIX.md` for the verdict rationale and `poc-replacement/03-academic-citations/RESULTS.md` for the full POC data (OpenAlex 1s latency, 80% acceptable-support recall, 10% exact-gold recall vs Semantic Scholar which was completely unreachable).

### Explicit scope decision: **no paid Semantic Scholar auth in this plan**

The existing `ssSearch` implementation in `src/providers/semanticscholar.ts` makes unauthenticated requests only — there is no `SEMANTIC_SCHOLAR_API_KEY` field in `Config` and no header/query plumbing for it. Adding authenticated-SS support is a distinct workstream (Config field + env loader + header wiring + test coverage) and is intentionally deferred to a later plan if the product team decides a paid-SS tier is worth maintaining alongside OpenAlex.

Throughout this document, "legacy SS fallback" means the existing **unauthenticated** SS code path. Users whose `config.providers.academic` is explicitly set to `{ provider: "semantic-scholar" }` continue to hit SS via the unauthenticated call — same as today, same 429 risk as today. This plan does not improve or degrade that path; it only adds OpenAlex as a new default.

---

## File Structure

**Files to create:**
- `src/providers/openalex.ts` — OpenAlex search client (mirrors `ssSearch` shape)
- `src/providers/openalex.test.ts` — unit tests for the client
- `tests/integration/academic-openalex.test.ts` — live-API integration test (gated on env key)

**Files to modify:**
- `src/providers/types.ts` — add `"openalex"` to `ProviderId` union
- `src/config.ts` — add `openalexMailto?: string` to `Config` interface and load logic
- `src/providers/registry.ts` — register OpenAlex metadata for the `academic` skill
- `src/providers/resolve.ts` — extend `LEGACY_MAP` for `academic → openalex` when `openalexMailto` is set
- `src/providers/resolve.test.ts` — new test cases for the academic routing
- `src/skills/academic.ts` — branch on resolved provider; call `oaSearch` when resolver returns `"openalex"`, fall back to `ssSearch` otherwise
- `src/skills/academic.test.ts` — add tests for the OpenAlex path
- `.env.example` — document `OPENALEX_MAILTO`
- `README.md` — citations section explaining why we prefer OpenAlex

**Memory checkpoint (no file mod — documentation step):**
- `~/checkapp/.remember/remember.md` — append "Phase 1 complete" entry
- `~/.claude/projects/-Users-sharonsciammas-checkapp/memory/project_checkapp_plan3_pocs.md` — append production status entry

---

## Task 1: Add `"openalex"` to `ProviderId` union

**Files:**
- Modify: `src/providers/types.ts:6-11`

- [ ] **Step 1: Write the failing test**

Add the test to verify the type exists. Create `src/providers/types.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { ProviderId } from "./types.ts";

describe("ProviderId", () => {
  test("accepts openalex as a provider", () => {
    const p: ProviderId = "openalex";
    expect(p).toBe("openalex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/providers/types.test.ts`
Expected: FAIL with TypeScript error — `Type '"openalex"' is not assignable to type 'ProviderId'`.

- [ ] **Step 3: Add `"openalex"` to the union**

Edit `src/providers/types.ts` line 10 (the `"semantic-scholar"` line). Change:

```typescript
  | "semantic-scholar"
```

to:

```typescript
  | "semantic-scholar" | "openalex"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/providers/types.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/types.test.ts
git commit -m "feat(providers): add openalex to ProviderId union"
```

---

## Task 2: Add `openalexMailto` to Config

**Files:**
- Modify: `src/config.ts` — Config interface (around line 27) and loader (around line 100)

- [ ] **Step 1: Write the failing test**

Add to `src/config.test.ts`. Append this test case:

```typescript
test("loads OPENALEX_MAILTO from env", () => {
  const saved = process.env.OPENALEX_MAILTO;
  process.env.OPENALEX_MAILTO = "research@example.com";
  try {
    const config = readConfig();
    expect(config.openalexMailto).toBe("research@example.com");
  } finally {
    if (saved === undefined) delete process.env.OPENALEX_MAILTO;
    else process.env.OPENALEX_MAILTO = saved;
  }
});

test("openalexMailto is undefined when env unset", () => {
  const saved = process.env.OPENALEX_MAILTO;
  delete process.env.OPENALEX_MAILTO;
  try {
    const config = readConfig();
    expect(config.openalexMailto).toBeUndefined();
  } finally {
    if (saved !== undefined) process.env.OPENALEX_MAILTO = saved;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/config.test.ts`
Expected: FAIL — two tests fail, either TypeScript error on `config.openalexMailto` or `undefined` returned by loader that doesn't read the env var.

- [ ] **Step 3: Extend the `Config` interface**

Edit `src/config.ts`. Find the `Config` interface (around line 22). Add after `openrouterApiKey?: string;`:

```typescript
  openalexMailto?: string;
```

- [ ] **Step 4: Extend the loader**

In the same file, find the loader block (around line 100 where `anthropicApiKey` / `minimaxApiKey` are set from env). Add:

```typescript
    openalexMailto: process.env.OPENALEX_MAILTO ?? file.openalexMailto,
```

Place it next to the other optional-key loaders so the grouping stays readable.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/config.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Run full test suite to verify no regression**

Run: `bun test`
Expected: all existing tests still pass, new test count = baseline + 2.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(config): add openalexMailto, load from OPENALEX_MAILTO env"
```

---

## Task 3: Register OpenAlex metadata in the provider registry

**Files:**
- Modify: `src/providers/registry.ts`
- Test: `src/providers/registry.test.ts` (may or may not exist — check before writing)

- [ ] **Step 1: Read the existing registry shape**

Run: `cat src/providers/registry.ts | head -60`
Read the structure so you know where to add the new entry. Confirm the shape matches `ProviderMetadata` from `types.ts`.

- [ ] **Step 2: Write the failing test**

Add to `src/providers/registry.test.ts` (create file if it doesn't exist):

```typescript
import { describe, test, expect } from "bun:test";
import { getProvider } from "./registry.ts";

describe("getProvider", () => {
  test("returns metadata for academic + openalex", () => {
    const meta = getProvider("academic", "openalex");
    expect(meta).toBeDefined();
    expect(meta?.id).toBe("openalex");
    expect(meta?.freeTier).toBe(true);
    expect(meta?.requiresKey).toBe(false);
    expect(meta?.endpoint).toContain("api.openalex.org");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/providers/registry.test.ts`
Expected: FAIL — `getProvider("academic", "openalex")` returns `undefined`.

- [ ] **Step 4: Add the OpenAlex entry to the registry**

In `src/providers/registry.ts`, find the block where `academic` providers are registered (search for `"academic"` and `"semantic-scholar"`). Add an entry for OpenAlex immediately after the Semantic Scholar entry:

```typescript
  openalex: {
    id: "openalex",
    label: "OpenAlex",
    speed: "fast",
    costPerCheckUsd: 0,
    costLabel: "Free (polite pool with mailto)",
    depth: "standard",
    freeTier: true,
    requiresKey: false,
    endpoint: "https://api.openalex.org/works",
  },
```

Match the existing indentation and object shape — if the Semantic Scholar entry uses `speed: "medium"`, OpenAlex uses `"fast"` (confirmed in POC: ~1s latency).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/providers/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: green, no regression.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts src/providers/registry.test.ts
git commit -m "feat(providers): register OpenAlex metadata for academic skill"
```

---

## Task 4: Create OpenAlex client `oaSearch`

**Files:**
- Create: `src/providers/openalex.ts`
- Test: `src/providers/openalex.test.ts`

- [ ] **Step 1: Write the failing test — happy path**

Create `src/providers/openalex.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { oaSearch } from "./openalex.ts";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response | Promise<Response>) {
  globalThis.fetch = mock(() => Promise.resolve(response)) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("oaSearch", () => {
  test("returns papers in SSPaper shape", async () => {
    const body = {
      results: [
        {
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.1136/bmj.i6583",
          title: "Vitamin D supplementation to prevent acute respiratory tract infections",
          publication_year: 2017,
          authorships: [{ author: { display_name: "Martineau AR" } }, { author: { display_name: "Jolliffe DA" } }],
          primary_location: { landing_page_url: "https://www.bmj.com/content/356/bmj.i6583" },
        },
      ],
    };
    mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    const papers = await oaSearch("vitamin d respiratory", 5, { mailto: "me@example.com" });
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toContain("Vitamin D supplementation");
    expect(papers[0].year).toBe(2017);
    expect(papers[0].authors).toHaveLength(2);
    expect(papers[0].authors[0].name).toBe("Martineau AR");
    expect(papers[0].externalIds?.DOI).toBe("10.1136/bmj.i6583");
    expect(papers[0].url).toBe("https://www.bmj.com/content/356/bmj.i6583");
  });

  test("returns empty array when API returns no results", async () => {
    mockFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const papers = await oaSearch("no match", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on non-OK response", async () => {
    mockFetch(new Response("server error", { status: 500 }));
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on network throw", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on malformed JSON response", async () => {
    mockFetch(new Response("<html>not json</html>", { status: 200 }));
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("includes mailto in URL when provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    await oaSearch("q", 3, { mailto: "x@y.com" });
    expect(capturedUrl).toContain("mailto=x%40y.com");
  });

  test("omits mailto when not provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    await oaSearch("q", 3);
    expect(capturedUrl).not.toContain("mailto");
  });

  test("strips https://doi.org/ prefix from DOI field", async () => {
    const body = {
      results: [{
        id: "W1", doi: "https://doi.org/10.1000/xyz",
        title: "t", publication_year: 2020, authorships: [], primary_location: {},
      }],
    };
    mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    const papers = await oaSearch("q", 1);
    expect(papers[0].externalIds?.DOI).toBe("10.1000/xyz");
  });
});
```

- [ ] **Step 2: Run test to verify all fail**

Run: `bun test src/providers/openalex.test.ts`
Expected: FAIL — `Module not found: src/providers/openalex.ts`.

- [ ] **Step 3: Create the OpenAlex client**

Create `src/providers/openalex.ts` with this exact content:

```typescript
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/providers/openalex.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: green, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/providers/openalex.ts src/providers/openalex.test.ts
git commit -m "feat(providers): add OpenAlex search client (SSPaper-compatible)"
```

- [ ] **Step 7: Subagent review**

Dispatch the `feature-dev:code-reviewer` agent on the new files. Use prompt:

> Review `src/providers/openalex.ts` and `src/providers/openalex.test.ts`. This is a new HTTP client that must mirror the SSPaper return shape of `src/providers/semanticscholar.ts`. Check for: (1) silent failures (errors that swallow useful info), (2) DOI normalization edge cases, (3) URL construction correctness for the OpenAlex polite pool. Report any high-priority issues.

If the agent surfaces high-priority issues, fix them in a follow-up commit and re-run step 6.

---

## Task 5: Extend `resolveProvider` to route `academic` to OpenAlex when `openalexMailto` is set

**Files:**
- Modify: `src/providers/resolve.ts`
- Modify: `src/providers/resolve.test.ts`

- [ ] **Step 1: Read the current resolver**

Run: `cat src/providers/resolve.ts`
Confirm the `LEGACY_MAP` shape — we need to add a `keyOf` entry that reads `openalexMailto` for the `academic` skill.

- [ ] **Step 2: Write the failing test**

Append these cases to `src/providers/resolve.test.ts` inside the existing `describe("resolveProvider", ...)` block (before the closing `})`):

```typescript
  test("routes academic → openalex when openalexMailto is set", () => {
    const r = resolveProvider(
      { ...base, openalexMailto: "me@example.com" },
      "academic"
    );
    expect(r?.provider).toBe("openalex");
    expect(r?.apiKey).toBe("me@example.com");
  });

  test("academic falls back to null when no openalexMailto and no explicit provider", () => {
    const r = resolveProvider({ ...base }, "academic");
    expect(r).toBeNull();
  });

  test("explicit providers[academic] still wins over openalexMailto", () => {
    const r = resolveProvider(
      {
        ...base,
        openalexMailto: "me@example.com",
        providers: { academic: { provider: "semantic-scholar", apiKey: "ss-key" } },
      } as Config,
      "academic"
    );
    expect(r?.provider).toBe("semantic-scholar");
    expect(r?.apiKey).toBe("ss-key");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/providers/resolve.test.ts`
Expected: FAIL — first two new tests fail (resolver returns null for academic). Third may pass already because the explicit-provider branch is existing behavior.

- [ ] **Step 4: Extend `LEGACY_MAP`**

In `src/providers/resolve.ts`, find the `LEGACY_MAP` constant (around line 9). Add a new entry:

```typescript
  academic: { provider: "openalex", keyOf: (c) => c.openalexMailto },
```

The entry goes after `plagiarism`, matching the existing alphabetical / pragmatic ordering.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/providers/resolve.test.ts`
Expected: PASS, all new tests green.

- [ ] **Step 6: Commit**

```bash
git add src/providers/resolve.ts src/providers/resolve.test.ts
git commit -m "feat(providers): route academic skill to OpenAlex when mailto set"
```

---

## Task 6: Wire OpenAlex into the academic skill

**Files:**
- Modify: `src/skills/academic.ts`
- Modify: `src/skills/academic.test.ts`

- [ ] **Step 1: Read the academic skill's SS call site**

Run: `grep -n "ssSearch" src/skills/academic.ts`
Expected: 2 matches — the import and the single call site (around line 55).

Run: `sed -n '50,70p' src/skills/academic.ts` to inspect the exact context.

- [ ] **Step 2: Write the failing test**

Append these cases to `src/skills/academic.test.ts`. If the file doesn't have a `describe` block for OpenAlex routing, wrap them in one.

**Use the repo's existing `mockFetch` + `urlRouter` pattern** (see `src/skills/academic.test.ts` for reference). Do NOT mutate ESM bindings — the repo does not do that.

```typescript
import { describe, test, expect } from "bun:test";
import { AcademicSkill } from "./academic.ts";
import type { Config } from "../config.ts";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";

const baseConfig: Config = {
  copyscapeUser: "", copyscapeKey: "",
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    academic: true,
  },
};

const sampleText = "Vitamin D supplementation reduces the risk of acute respiratory tract infections.";

describe("AcademicSkill provider routing", () => {
  test("routes to OpenAlex when openalexMailto is configured", async () => {
    let openalexCalls = 0;
    let ssCalls = 0;
    mockFetch(urlRouter({
      "api.openalex.org": async () => {
        openalexCalls++;
        return jsonResponse({
          results: [{
            id: "https://openalex.org/W1",
            doi: "https://doi.org/10.1136/bmj.i6583",
            title: "Vitamin D supplementation to prevent acute respiratory tract infections",
            publication_year: 2017,
            authorships: [{ author: { display_name: "Martineau AR" } }],
            primary_location: { landing_page_url: "https://www.bmj.com/content/356/bmj.i6583" },
          }],
        });
      },
      "api.semanticscholar.org": async () => {
        ssCalls++;
        return jsonResponse({ data: [] });
      },
    }));

    const skill = new AcademicSkill();
    const result = await skill.enrich(sampleText, { ...baseConfig, openalexMailto: "test@example.com" }, []);

    expect(openalexCalls).toBeGreaterThan(0);
    expect(ssCalls).toBe(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  test("routes to Semantic Scholar via legacy explicit providers config (no openalexMailto)", async () => {
    let openalexCalls = 0;
    let ssCalls = 0;
    mockFetch(urlRouter({
      "api.openalex.org": async () => {
        openalexCalls++;
        return jsonResponse({ results: [] });
      },
      "api.semanticscholar.org": async () => {
        ssCalls++;
        return jsonResponse({
          data: [{
            paperId: "S1", title: "Some SS paper", year: 2019, authors: [{ name: "X" }],
          }],
        });
      },
    }));

    const skill = new AcademicSkill();
    await skill.enrich(sampleText, {
      ...baseConfig,
      providers: { academic: { provider: "semantic-scholar", apiKey: "ss-key" } },
    } as Config, []);

    expect(ssCalls).toBeGreaterThan(0);
    expect(openalexCalls).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/skills/academic.test.ts`
Expected: FAIL — `oaSpy` is not called because the skill still hardcodes `ssSearch`.

- [ ] **Step 4: Modify `src/skills/academic.ts` to dispatch on resolver**

Open `src/skills/academic.ts`. Make two changes:

**Change A — add the OpenAlex import at the top of the file (after the existing `ssSearch` import):**

```typescript
import { oaSearch } from "../providers/openalex.ts";
```

**Change B — replace the single `ssSearch` call site (around line 55) with a dispatch on the resolved provider.** Find this block:

```typescript
      const papers = await ssSearch(target.claim, 3);
```

Replace with:

```typescript
      const papers = resolved.provider === "openalex"
        ? await oaSearch(target.claim, 3, { mailto: resolved.apiKey })
        : await ssSearch(target.claim, 3);
```

Note: `resolved` is the value already returned by `resolveProvider(config, "academic")` near the top of the `enrich` method. `resolved.apiKey` carries the `openalexMailto` value because Task 5's `LEGACY_MAP` entry uses `keyOf: (c) => c.openalexMailto`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/skills/academic.test.ts`
Expected: PASS — both new routing tests green, existing tests unchanged.

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: green, no regression.

- [ ] **Step 7: Commit**

```bash
git add src/skills/academic.ts src/skills/academic.test.ts
git commit -m "feat(academic): dispatch to OpenAlex when resolver returns openalex"
```

- [ ] **Step 8: Subagent review**

Dispatch the `feature-dev:code-reviewer` agent. Use prompt:

> Review the changes in `src/skills/academic.ts` and the added tests in `src/skills/academic.test.ts`. This wires OpenAlex as an alternative provider behind the existing `resolveProvider` contract. Check: (1) the ssSearch fallback path is preserved for legacy users, (2) no silent error swallowing, (3) test isolation is correct — mock restoration happens after each test. Report any high-priority issues.

Fix any critical issues in a follow-up commit.

---

## Task 7: Golden-file regression test (flag-off behavior preserved)

**Goal:** prove that users without `OPENALEX_MAILTO` get byte-identical behavior after the change.

**Files:**
- Create: `tests/golden/academic-ss-baseline.json` (captured output)
- Create: `tests/golden/academic-ss-baseline.test.ts` (comparison test)

- [ ] **Step 1: Capture baseline using the repo's fetch-mocking pattern**

Create `tests/golden/academic-ss-baseline.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { AcademicSkill } from "../../src/skills/academic.ts";
import { mockFetch, urlRouter, jsonResponse } from "../../src/testing/mock-fetch.ts";
import type { Config } from "../../src/config.ts";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const config: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { academic: { provider: "semantic-scholar", apiKey: "ss-key" } },
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    academic: true,
  },
};

const fixturePath = join(import.meta.dir, "academic-ss-baseline.json");
const sampleText = "Vitamin D reduces the risk of acute respiratory infections. A 2017 meta-analysis in BMJ confirmed this.";

describe("academic skill — SS path regression", () => {
  test("output shape matches captured baseline when using SS", async () => {
    mockFetch(urlRouter({
      "api.semanticscholar.org": async () => jsonResponse({
        data: [{
          paperId: "S-fixed",
          title: "Vitamin D supplementation",
          year: 2017,
          authors: [{ name: "Martineau AR" }],
          externalIds: { DOI: "10.1136/bmj.i6583" },
          url: "https://www.bmj.com/content/356/bmj.i6583",
        }],
      }),
    }));

    const skill = new AcademicSkill();
    const result = await skill.enrich(sampleText, config, []);

    // Strip timing-dependent fields before snapshot compare.
    const canonical = JSON.stringify({
      skillId: result.skillId,
      name: result.name,
      verdict: result.verdict,
      findings: result.findings.map((f) => ({
        text: f.text,
        claimType: f.claimType,
        citations: f.citations ?? [],
      })),
    }, null, 2);

    if (!existsSync(fixturePath)) {
      writeFileSync(fixturePath, canonical);
      console.log(`Wrote initial baseline → ${fixturePath}. Re-run to compare.`);
      return;
    }
    const baseline = readFileSync(fixturePath, "utf8");
    expect(canonical).toBe(baseline);
  });
});
```

- [ ] **Step 2: Run to capture baseline**

Run: `bun test tests/golden/academic-ss-baseline.test.ts`
Expected: first run writes `tests/golden/academic-ss-baseline.json` and prints "Wrote initial baseline". Test passes because it returns before the compare.

- [ ] **Step 3: Verify the fixture was created and looks sane**

Run: `cat tests/golden/academic-ss-baseline.json | head -30`
Expected: valid JSON with `skillId`, `findings` array, and citation data sourced from `fakePapers`.

- [ ] **Step 4: Re-run to confirm the comparison passes**

Run: `bun test tests/golden/academic-ss-baseline.test.ts`
Expected: PASS on comparison (canonical === baseline).

- [ ] **Step 5: Widen the `test` npm script to include `tests/golden/`**

**Important:** `package.json` has an explicit allowlist for the `test` script — it does NOT glob `tests/golden/` or `tests/integration/`. Without this step, the phase-gate `bun test` run would silently skip the new regression test.

Open `package.json`. Find the `"test"` script (around line 45). Append ` tests/golden/*.test.ts` to the end of the existing command. Before:

```json
"test": "bun test src/*.test.ts src/skills/*.test.ts src/utils/*.test.ts src/providers/*.test.ts src/cli/*.test.ts src/cost/*.test.ts tests/e2e/*.test.ts",
```

After:

```json
"test": "bun test src/*.test.ts src/skills/*.test.ts src/utils/*.test.ts src/providers/*.test.ts src/cli/*.test.ts src/cost/*.test.ts tests/e2e/*.test.ts tests/golden/*.test.ts",
```

Integration tests (`tests/integration/*.test.ts`) stay out of this script — they require network and are gated by env flag; CI runs them in a separate step.

- [ ] **Step 6: Verify the widened script picks up the new test**

Run: `bun test`
Expected: all tests pass, count increases by 1 (the new golden test).

- [ ] **Step 7: Commit**

```bash
git add tests/golden/academic-ss-baseline.json tests/golden/academic-ss-baseline.test.ts package.json
git commit -m "test(academic): golden-file regression for Semantic Scholar path

Widens npm 'test' script to include tests/golden/*.test.ts (was an
allowlist that silently skipped this directory)."
```

---

## Task 8: Integration test on live OpenAlex API

**Files:**
- Create: `tests/integration/academic-openalex.test.ts`

**Note:** This test hits the real OpenAlex API. It is gated on `OPENALEX_INTEGRATION=1` to avoid running on every developer's machine.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/academic-openalex.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { oaSearch } from "../../src/providers/openalex.ts";

const RUN = process.env.OPENALEX_INTEGRATION === "1";
const mailto = process.env.OPENALEX_MAILTO;

describe.skipIf(!RUN)("OpenAlex live API", () => {
  test("returns a well-formed paper list for a well-known medical query", async () => {
    const papers = await oaSearch(
      "Vitamin D supplementation acute respiratory tract infections",
      5,
      { mailto }
    );
    // Soft invariants — don't assert a specific paper rank, since search ordering can drift.
    expect(papers.length).toBeGreaterThan(0);
    // Every returned paper has the expected SSPaper shape:
    for (const p of papers) {
      expect(typeof p.paperId).toBe("string");
      expect(p.paperId.length).toBeGreaterThan(0);
      expect(typeof p.title).toBe("string");
      expect(p.title.length).toBeGreaterThan(0);
      expect(Array.isArray(p.authors)).toBe(true);
    }
    // At least one result is topical (contains "vitamin" OR "respiratory" in title).
    const topical = papers.some((p) =>
      /vitamin|respiratory|infection/i.test(p.title)
    );
    expect(topical).toBe(true);
  }, 15000);

  test("does not throw for a low-signal query", async () => {
    // We avoid asserting [] because the OpenAlex index can return fuzzy matches
    // even for garbage strings. The invariant is "no throw, returns an array".
    const papers = await oaSearch("zxqvwypqxcvbnmasdfgklqwerty", 3, { mailto });
    expect(Array.isArray(papers)).toBe(true);
  }, 15000);
});
```

- [ ] **Step 2: Run locally with real API**

Run: `OPENALEX_INTEGRATION=1 OPENALEX_MAILTO=sharon.spirit@gmail.com bun test tests/integration/academic-openalex.test.ts`
Expected: PASS, 2 tests. First test confirms the BMJ Martineau 2017 paper is found.

- [ ] **Step 3: Verify the test is skipped by default**

Run (without the env flag): `bun test tests/integration/academic-openalex.test.ts`
Expected: 2 tests skipped, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/academic-openalex.test.ts
git commit -m "test(openalex): live-API integration test (gated on OPENALEX_INTEGRATION)"
```

---

## Task 9: Update `.env.example` and README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add `OPENALEX_MAILTO` to `.env.example`**

Open `.env.example`. Find the section where other optional keys are documented. Add only the OpenAlex line:

```bash
# OpenAlex — academic citations provider (default, recommended).
# Free service; the mailto identifies your client for the polite pool
# (100k requests/day). No API key required.
OPENALEX_MAILTO=your-email@example.com
```

**Do not** add a `SEMANTIC_SCHOLAR_API_KEY` entry — this plan does not wire authenticated SS requests (see the scope decision in the plan header). Users who already have an explicit `providers.academic = semantic-scholar` entry in their config continue to hit SS unauthenticated, same as before.

- [ ] **Step 2: Add a citations section to README.md**

Open `README.md`. Find the skills documentation section (look for `Academic Citations` or `academic` skill). Add or update this subsection:

```markdown
### Academic Citations

CheckApp finds peer-reviewed supporting papers for scientific, medical, and financial claims.

**Default provider: OpenAlex.** Free, ~250M indexed works, no API key required. Set `OPENALEX_MAILTO=your@email.com` in your `.env` to use the polite pool (100k req/day).

**Legacy provider: Semantic Scholar.** Users with an explicit `providers.academic = { provider: "semantic-scholar" }` config continue to hit SS. Note: the free tier of SS has aggressive per-IP rate limiting and is effectively unusable on shared IPs — that's why OpenAlex is the new default. Authenticated (paid) SS requests are not currently wired in the client; support for a paid SS API key is a separate workstream.

See `poc-replacement/03-academic-citations/RESULTS.md` for the comparison data that drove this decision.
```

- [ ] **Step 3: Verify docs render correctly**

Run: `head -100 README.md | grep -A 6 "Academic"`
Expected: the new section is present with the OpenAlex mailto guidance.

Run: `grep -c "OPENALEX_MAILTO" .env.example`
Expected: `1` or greater.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs(citations): OpenAlex default provider, SS as legacy fallback"
```

---

## Task 10: Phase-gate verification

**Files:** no code changes — this task is the verification gate.

**Important:** the npm `test` script is an explicit allowlist (it does NOT glob `tests/integration/` at all, and only globs `tests/golden/` after Task 7 widens it). The phase-gate must run the specific test paths that matter, not rely on `bun test` covering everything by accident.

- [ ] **Step 1: Run the main unit-test suite**

Run: `bun test`
Expected: all tests pass. Record the count: `__________`. Confirm it includes `tests/golden/academic-ss-baseline.test.ts` (should appear in the output — Task 7 widened the script).

- [ ] **Step 2: Run the new provider tests explicitly**

Run: `bun test src/providers/openalex.test.ts src/providers/resolve.test.ts src/providers/registry.test.ts src/skills/academic.test.ts src/providers/types.test.ts src/config.test.ts`
Expected: PASS, no skipped.

- [ ] **Step 3: Run the golden-file regression test explicitly**

Run: `bun test tests/golden/academic-ss-baseline.test.ts`
Expected: PASS (comparison against the committed baseline).

- [ ] **Step 4: Run the live-API integration test**

Run: `OPENALEX_INTEGRATION=1 OPENALEX_MAILTO=sharon.spirit@gmail.com bun test tests/integration/academic-openalex.test.ts`
Expected: PASS, 2 tests (not skipped).

- [ ] **Step 5: Run the dashboard test suite**

Run: `bun run test:dashboard`
Expected: green, no regression from Plan 2 baseline.

- [ ] **Step 6: Manual smoke test — user WITHOUT OPENALEX_MAILTO**

Use `bun src/index.tsx` (the non-watch entry point — do NOT use `bun run dev`, that's the watch-mode launcher per `package.json:44`).

```bash
# Ensure OPENALEX_MAILTO is unset for this test:
unset OPENALEX_MAILTO
bun src/index.tsx check poc/articles/01-health.md --skills academic > /tmp/smoke-before.json
```

Expected: JSON output with citations from Semantic Scholar (or "skipped" with a clear message if no explicit `providers.academic` config exists). Identical to behavior before this plan for the default-config case.

- [ ] **Step 7: Manual smoke test — user WITH OPENALEX_MAILTO**

```bash
OPENALEX_MAILTO=sharon.spirit@gmail.com bun src/index.tsx check poc/articles/01-health.md --skills academic > /tmp/smoke-after.json
```

Expected: JSON output with citations from OpenAlex. At least one citation should be returned (topical to vitamin D / respiratory infection claims in the article). Do NOT assert a specific DOI — OpenAlex ranking can drift.

- [ ] **Step 8: Compare smoke-test results**

Run: `diff /tmp/smoke-before.json /tmp/smoke-after.json | head -20`
Expected: non-empty diff — the "after" version contains citations (OpenAlex worked), the "before" either is skipped or contains SS results (possibly empty due to 429).

- [ ] **Step 9: Dispatch `superpowers:code-reviewer` on the full phase diff**

Run: `git log --oneline main..HEAD`
Record the commit range, then dispatch the agent with this prompt:

> Review the full diff for the SS→OpenAlex swap: `git diff main...HEAD` in `sharonds/checkapp`. This is the production fix for the Semantic Scholar 429 bug. Check: (1) no silent failures or swallowed errors; (2) the legacy SS path is truly preserved (users without OPENALEX_MAILTO see no behavior change); (3) type safety around the new ProviderId union member and Config field; (4) test coverage for both happy path and fallback. Report only high-priority issues.

If the agent surfaces any critical issue, fix it as a new atomic commit, then re-run steps 1 and 2.

- [ ] **Step 10: Dispatch `pr-review-toolkit:pr-test-analyzer`**

Use prompt:

> Analyze the test coverage in this PR (`git diff main...HEAD`). Focus on: OpenAlex error paths (network failures, 429s, malformed JSON), the academic skill's provider-routing branch, and the golden-file regression test. Identify any critical test gaps. Do not complain about trivial gaps.

Fix any critical gaps as a new atomic commit.

---

## Task 11: Memory checkpoint + PR

**Files:**
- Modify: `~/checkapp/.remember/remember.md`
- Modify: `~/.claude/projects/-Users-sharonsciammas-checkapp/memory/project_checkapp_plan3_pocs.md`

- [ ] **Step 1: Append to `.remember/remember.md`**

Open `~/checkapp/.remember/remember.md`. Append at the end:

```markdown

## Phase 0+1 complete — YYYY-MM-DD

**Branch:** `feat/plan3-phase-0-1-openalex-swap` merged to `main` via PR #___.

**Changes shipped:**
- Added `openalex` to `ProviderId`
- Added `openalexMailto` to `Config` (read from `OPENALEX_MAILTO`)
- New client: `src/providers/openalex.ts` (mirrors `ssSearch` shape)
- `resolveProvider` routes `academic` to OpenAlex when `openalexMailto` is set
- `AcademicSkill` dispatches to `oaSearch` or `ssSearch` based on resolver
- `.env.example` + README updated

**Behavior:**
- Users with `OPENALEX_MAILTO`: citations work (OpenAlex polite pool).
- Users without: unchanged (SS legacy path, still subject to SS 429 issue).

**Production action:** set `OPENALEX_MAILTO=sharon.spirit@gmail.com` in deployment env.

**Cost impact:** $0 per citation call (OpenAlex polite pool is free).

**Next:** Phase 2 — GPT-5.4 skill migration. Write a separate implementation plan
following the same writing-plans discipline as this one.
```

Replace `YYYY-MM-DD` with today's date and `#___` with the actual PR number.

- [ ] **Step 2: Append to the Plan 3 memory file**

Open `~/.claude/projects/-Users-sharonsciammas-checkapp/memory/project_checkapp_plan3_pocs.md`. Append at the end:

```markdown

## Phase 0+1 production status — YYYY-MM-DD

**SS → OpenAlex swap shipped.**

- OpenAlex client live at `src/providers/openalex.ts`
- Provider routing: `src/providers/resolve.ts` LEGACY_MAP now includes `academic → openalex` when `openalexMailto` is set
- Skill integration: `src/skills/academic.ts` dispatches based on resolved provider
- Golden-file test at `tests/golden/academic-ss-baseline.test.ts` preserves SS path regression guard
- Integration test at `tests/integration/academic-openalex.test.ts` (gated on `OPENALEX_INTEGRATION=1`)
- `.env.example` documents `OPENALEX_MAILTO`; README has a citations section

**Deployment checklist:**
- [ ] Production `.env` includes `OPENALEX_MAILTO=sharon.spirit@gmail.com`
- [ ] Post-deploy telemetry check: academic skill call success rate > 95% for 7 days
- [ ] If any user reports SS still being hit unexpectedly, confirm their env var set
```

- [ ] **Step 3: Commit the memory files**

```bash
git add poc-replacement/plans/2026-04-22-phase-0-1-openalex-swap.md  # the plan itself, if not already committed
cd ~/checkapp
git add ~/.claude/projects/-Users-sharonsciammas-checkapp/memory/project_checkapp_plan3_pocs.md
git commit -m "docs(memory): Phase 0+1 complete — SS → OpenAlex swap shipped"
```

Note: `~/checkapp/.remember/remember.md` is local handoff and NOT committed (it lives outside the repo in some layouts). Check with `git check-ignore .remember/remember.md` before deciding whether to commit it.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/plan3-phase-0-1-openalex-swap
```

- [ ] **Step 5: Open the PR**

Run:

```bash
gh pr create --title "Fix citations: OpenAlex replaces Semantic Scholar (Phase 0+1)" --body "$(cat <<'EOF'
## Summary
Fixes the production bug where users get HTTP 429 errors on every academic-citations call. Semantic Scholar's free tier is effectively unreachable from shared IPs; OpenAlex is a free drop-in replacement with the same API shape.

- Adds `openalex` provider (type + client + registry)
- Adds `openalexMailto` to `Config`
- `resolveProvider` routes `academic → openalex` when mailto is configured
- `AcademicSkill` dispatches to `oaSearch` or legacy `ssSearch` based on resolver
- Preserves SS path for users with paid SS API keys (legacy fallback)

## Test plan
- [ ] `bun test` — all tests green including 7 new OpenAlex tests + 3 routing tests
- [ ] `OPENALEX_INTEGRATION=1 OPENALEX_MAILTO=... bun test tests/integration/academic-openalex.test.ts` — live API hit works
- [ ] Golden-file test confirms SS-path behavior unchanged for users without `OPENALEX_MAILTO`
- [ ] Manual smoke: `bun src/index.tsx check poc/articles/01-health.md --skills academic` with and without `OPENALEX_MAILTO` set

## Deployment action
Set `OPENALEX_MAILTO=sharon.spirit@gmail.com` in production `.env` after merge.

## References
- Plan: `poc-replacement/plans/2026-04-22-phase-0-1-openalex-swap.md`
- POC data: `poc-replacement/03-academic-citations/RESULTS.md`
- Decision rationale: `poc-replacement/DECISION-MATRIX.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Confirm CI is green and merge**

Wait for CI to pass, then merge. Use the default merge strategy for the repo (no admin override required for a correctly-tested change).

If the repo policy requires external review, tag a reviewer and wait for approval before merging.

---

## Self-Review Checklist (run before declaring plan done)

**1. Spec coverage**

- [x] Replace SS with OpenAlex as the default for academic citations — Tasks 4–6.
- [x] Preserve SS as legacy fallback — Task 6 step 4, explicit branch.
- [x] Document the new env var — Task 9.
- [x] Test coverage for both paths — Tasks 4, 6, 7, 8.
- [x] Phase-gate verification — Task 10.
- [x] Memory checkpoint — Task 11.

**2. Placeholder scan**

- No "TBD", "later", "similar to Task N".
- Every code step shows the actual code.
- Every test step shows the actual test body.
- Every run command is exact and copyable.

**3. Type consistency**

- `ProviderId` gains `"openalex"` in Task 1 and is referenced consistently in Tasks 3, 5, 6.
- `Config.openalexMailto` added in Task 2, read in Task 5, passed through to `oaSearch` in Task 6.
- `SSPaper` shape returned by `oaSearch` — Task 4's client maps OpenAlex response to `SSPaper` exactly so Task 6's branch doesn't need any shape conversion.
- `resolveProvider` return shape (`{ provider, apiKey, metadata }`) is consistent across Tasks 5 and 6.

**4. Test coverage of critical paths**

- OpenAlex happy path: Task 4 step 1 (mocked) + Task 8 (live, shape-only).
- OpenAlex failure paths (non-OK, network error, malformed JSON): Task 4 step 1.
- Academic skill provider routing: Task 6 step 2 (fetch-based, not ESM mutation).
- SS legacy path regression: Task 7 (golden file, captured via same fetch-mock helper).
- Resolver fallback: Task 5 step 2.
- Test runner coverage: Task 7 step 5 widens `package.json` `test` script to include `tests/golden/*.test.ts` (the script is an explicit allowlist, not a glob).
- Integration tests: gated on `OPENALEX_INTEGRATION=1`, invoked explicitly in Task 10 step 4 (not auto-run by `bun test`).

**5. Rollback path**

If OpenAlex has an outage after deployment:
- Unset `OPENALEX_MAILTO` in the production env → resolver's `LEGACY_MAP` no longer returns an `apiKey` for academic → resolver returns `null` → `AcademicSkill.enrich` returns `verdict: "skipped"` with a clear message.
- Users with a paid SS key and `providers: { academic: { provider: "semantic-scholar", apiKey: "..." } }` in their config are unaffected.
- This rollback is tested by the existing "returns null when no config" case in `resolve.test.ts`.

---

**Plan complete.** Ready to execute via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
