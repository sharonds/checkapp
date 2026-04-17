# Writing a Custom Skill

This guide walks you through creating your own CheckApp skill -- from a zero-dependency offline checker to a full LLM-based analyzer. By the end you will know how to implement, register, and test a custom skill.

---

## 1. The Skill Interface

Every skill implements the `Skill` interface defined in `src/skills/types.ts`:

```typescript
import type { Config } from "../config.ts";

type Verdict = "pass" | "warn" | "fail";
type Severity = "info" | "warn" | "error";

interface Finding {
  severity: Severity;
  text: string;
  quote?: string;    // optional — the exact text from the article that triggered this finding
}

interface SkillResult {
  skillId: string;   // must match your Skill.id (e.g. "jargon")
  name: string;      // human-readable label shown in the report (e.g. "Brand Jargon")
  score: number;     // 0-100, where 100 is perfect
  verdict: Verdict;  // "pass" (score >= 75), "warn" (50-74), or "fail" (< 50)
  summary: string;   // one-sentence summary shown in terminal and HTML report
  findings: Finding[];
  costUsd: number;   // API cost for this skill run (0 for offline skills)
  error?: string;    // set only when the skill itself errored
}

interface Skill {
  id: string;
  name: string;
  run(text: string, config: Config): Promise<SkillResult>;
}
```

**Field notes:**

- **`score`** -- 0 means the article completely failed this check, 100 means it passed perfectly. The overall report score is the average of all skill scores.
- **`verdict`** -- determines the color and icon in the terminal and HTML report. Use `"pass"` for green/checkmark, `"warn"` for yellow/warning, `"fail"` for red/cross.
- **`summary`** -- keep it short. This is the one-liner next to the skill name in terminal output. Example: `"310 words - avg 17-word sentences - readability: Medium"`.
- **`findings`** -- the individual issues found. Each one gets rendered in the HTML report card. See the [Findings Severity Guide](#7-findings-severity-guide) for when to use each level.
- **`costUsd`** -- set to `0` for offline skills. For LLM skills, estimate from input/output token counts. This is summed across all skills and shown in the report header.

---

## 2. Minimal Example: Offline Skill

A "Brand Jargon Checker" that scans for banned corporate buzzwords. No API calls, no cost.

```typescript
// src/skills/jargon.ts
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";

export class JargonSkill implements Skill {
  readonly id = "jargon";
  readonly name = "Brand Jargon";

  async run(text: string, _config: Config): Promise<SkillResult> {
    const banned = ["synergy", "leverage", "disrupt", "paradigm", "ecosystem"];
    const lower = text.toLowerCase();
    const found = banned.filter((w) => lower.includes(w));

    const findings: Finding[] = found.map((w) => ({
      severity: "warn" as const,
      text: `Banned word: "${w}" -- rewrite without corporate jargon`,
    }));

    const score = found.length === 0 ? 100 : Math.max(0, 100 - found.length * 20);
    const verdict = score >= 75 ? "pass" : score >= 50 ? "warn" : "fail";

    return {
      skillId: this.id,
      name: this.name,
      score,
      verdict,
      summary:
        found.length === 0
          ? "No jargon found"
          : `${found.length} banned word${found.length > 1 ? "s" : ""} found`,
      findings,
      costUsd: 0,
    };
  }
}
```

Key points:

- `_config` is unused (prefixed with underscore) because this skill needs no API keys.
- Score decreases by 20 for each banned word found.
- All findings are `"warn"` severity -- jargon is bad but not a blocker.

---

## 3. LLM-Based Example: Readability Advisor

A skill that uses MiniMax or Claude to assess readability and suggest improvements. This demonstrates the LLM helper functions from `src/skills/llm.ts`.

```typescript
// src/skills/readability.ts
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, parseJsonResponse } from "./llm.ts";

interface ReadabilityResponse {
  score: number;
  verdict: "pass" | "warn" | "fail";
  summary: string;
  issues: Array<{
    severity: "info" | "warn" | "error";
    text: string;
    quote?: string;
  }>;
}

export function buildReadabilityPrompt(articleText: string): string {
  return `You are a readability expert. Analyze this article for:
1. Sentence complexity -- flag sentences over 30 words
2. Passive voice overuse
3. Unclear pronoun references
4. Paragraphs longer than 5 sentences

ARTICLE:
${articleText.slice(0, 5000)}

Reply with ONLY this JSON, no other text:
{
  "score": <0-100, 100 = highly readable>,
  "verdict": <"pass" if score>=75, "warn" if 50-74, "fail" if <50>,
  "summary": "<one sentence>",
  "issues": [
    { "severity": <"info" | "warn" | "error">, "text": "<description>", "quote": "<the problematic passage>" }
  ]
}`;
}

export class ReadabilitySkill implements Skill {
  readonly id = "readability";
  readonly name = "Readability Advisor";

  async run(text: string, config: Config): Promise<SkillResult> {
    // 1. Get an LLM client (MiniMax preferred, Anthropic fallback)
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id,
        name: this.name,
        score: 50,
        verdict: "warn",
        summary: "Skipped -- no LLM key configured",
        findings: [
          {
            severity: "info",
            text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable readability analysis",
          },
        ],
        costUsd: 0,
      };
    }

    // 2. Call the LLM with the new llm.call() interface
    const raw = await llm.call(buildReadabilityPrompt(text), 1024);

    // 3. Parse JSON (strips markdown code fences if present)
    const parsed = parseJsonResponse<ReadabilityResponse>(raw);

    // 4. Map to SkillResult
    return {
      skillId: this.id,
      name: this.name,
      score: parsed.score,
      verdict: parsed.verdict,
      summary: parsed.summary,
      findings: parsed.issues.map((i) => ({
        severity: i.severity,
        text: i.text,
        quote: i.quote,
      })),
      costUsd: 0.002,  // approximate cost for a single LLM call
    };
  }
}
```

Key points:

- **`getLlmClient(config)`** returns `null` when no LLM key is configured. Always handle this case with a graceful skip result.
- **`max_tokens: 1024`** -- MiniMax M2.7 needs this or the response is truncated mid-JSON. Always set `max_tokens >= 1024`.
- **Thinking blocks handled automatically** -- MiniMax M2.7 emits thinking blocks, but `llm.call()` extracts and returns only the text content. You never need to handle thinking blocks directly.
- **`parseJsonResponse()`** -- MiniMax sometimes wraps JSON in markdown code fences. This strips them before parsing.
- **`buildReadabilityPrompt()`** is exported as a standalone function so tests can validate the prompt without calling the LLM.

---

## 4. How to Register a New Skill

After writing your skill class, wire it into the system in four steps:

### Step 1: Add the toggle to SkillsConfig

In `src/config.ts`, add your skill key to the `SkillsConfig` interface and the `DEFAULT_SKILLS` object:

```typescript
// src/config.ts

export interface SkillsConfig {
  plagiarism: boolean;
  aiDetection: boolean;
  seo: boolean;
  factCheck: boolean;
  tone: boolean;
  legal: boolean;
  summary: boolean;
  readability: boolean;  // <-- add this
}

const DEFAULT_SKILLS: SkillsConfig = {
  plagiarism: true,
  aiDetection: true,
  seo: true,
  factCheck: false,
  tone: false,
  legal: false,
  summary: false,
  readability: false,  // <-- add this (false = opt-in, true = enabled by default)
};
```

### Step 2: Import and add to the skills array

In `src/check.tsx`, import your skill and add it to the `allSkills` array:

```typescript
// src/check.tsx
import { ReadabilitySkill } from "./skills/readability.ts";

// Inside the run() function:
const allSkills = [
  config.skills.plagiarism && new PlagiarismSkill(),
  config.skills.aiDetection && new AiDetectionSkill(),
  config.skills.seo && new SeoSkill(),
  config.skills.factCheck && new FactCheckSkill(),
  config.skills.tone && new ToneSkill(),
  config.skills.legal && new LegalSkill(),
  config.skills.summary && new SummarySkill(),
  config.skills.readability && new ReadabilitySkill(),  // <-- add this
].filter(Boolean) as /* ... union type including ReadabilitySkill */[];
```

### Step 3: Add an engine label for the HTML report

In `src/report.ts`, add an entry to the `ENGINE_LABEL` map so the HTML report shows the correct engine badge:

```typescript
// src/report.ts
const ENGINE_LABEL: Record<string, { label: string; color: string }> = {
  "plagiarism": { label: "Copyscape", color: "#0078D4" },
  "ai-detection": { label: "Copyscape", color: "#0078D4" },
  "seo": { label: "Offline", color: "#6b7280" },
  "fact-check": { label: "Exa AI", color: "#7c3aed" },
  "tone": { label: "MiniMax", color: "#0891b2" },
  "legal": { label: "MiniMax", color: "#0891b2" },
  "summary": { label: "MiniMax", color: "#0891b2" },
  "readability": { label: "MiniMax", color: "#0891b2" },  // <-- add this
};
```

For offline skills, use `{ label: "Offline", color: "#6b7280" }`.

### Step 4: Enable it

Add to your `~/.checkapp/config.json`:

```json
{
  "skills": {
    "readability": true
  }
}
```

Or set it as `true` in `DEFAULT_SKILLS` if you want it enabled for everyone by default.

---

## 5. Testing

CheckApp uses `bun:test`. There are two testing patterns depending on whether your skill calls an LLM.

### Pattern A: Offline skill tests

Test the logic directly -- no mocks needed. See `src/skills/seo.test.ts` for the full example.

```typescript
// src/skills/jargon.test.ts
import { test, expect } from "bun:test";
import { JargonSkill } from "./jargon.ts";

test("JargonSkill finds banned words", async () => {
  const skill = new JargonSkill();
  const config = {
    copyscapeUser: "",
    copyscapeKey: "",
    skills: {
      plagiarism: false, aiDetection: false, seo: false,
      factCheck: false, tone: false, legal: false, summary: false,
    },
  };

  const result = await skill.run(
    "Our synergy will disrupt the paradigm of the ecosystem.",
    config as any,
  );

  expect(result.skillId).toBe("jargon");
  expect(result.costUsd).toBe(0);
  expect(result.verdict).toBe("fail");   // 4 banned words found
  expect(result.findings.length).toBe(4);
});

test("JargonSkill passes clean text", async () => {
  const skill = new JargonSkill();
  const config = { copyscapeUser: "", copyscapeKey: "", skills: {} };

  const result = await skill.run("A well-written article about cooking.", config as any);

  expect(result.score).toBe(100);
  expect(result.verdict).toBe("pass");
  expect(result.findings).toHaveLength(0);
});
```

### Pattern B: LLM skill tests (prompt validation)

For LLM-based skills, test the prompt builder and the result shape separately. Do not call the actual LLM in unit tests. See `src/skills/legal.test.ts` for the full example.

```typescript
// src/skills/readability.test.ts
import { test, expect } from "bun:test";
import { buildReadabilityPrompt } from "./readability.ts";

test("buildReadabilityPrompt includes the article text", () => {
  const prompt = buildReadabilityPrompt("This is a long complex sentence that should be flagged.");
  expect(prompt).toContain("This is a long complex sentence");
});

test("buildReadabilityPrompt requests JSON output", () => {
  const prompt = buildReadabilityPrompt("text");
  expect(prompt).toContain('"score"');
  expect(prompt).toContain('"verdict"');
  expect(prompt).toContain('"issues"');
});

test("buildReadabilityPrompt mentions key analysis criteria", () => {
  const prompt = buildReadabilityPrompt("text");
  expect(prompt).toContain("Sentence complexity");
  expect(prompt).toContain("Passive voice");
});
```

Run all tests:

```bash
bun test
```

Run a single test file:

```bash
bun test src/skills/jargon.test.ts
```

---

## 6. MiniMax / Anthropic Tips

CheckApp supports multiple LLM providers through the Anthropic SDK. Here is what you need to know when writing LLM-based skills:

| Topic | Details |
|-------|---------|
| **Provider priority** | `getLlmClient(config)` prefers MiniMax when `MINIMAX_API_KEY` is set. Falls back to Anthropic when only `ANTHROPIC_API_KEY` is set. Returns `null` when neither is configured. |
| **llm.call() interface** | Use `await llm.call(prompt, maxTokens)` to call the LLM. This interface handles thinking blocks (MiniMax), text extraction, and response formatting automatically. Pass your prompt string and max tokens (e.g., 1024). Returns raw text ready to parse. |
| **Code fence wrapping** | Some models wrap JSON responses in markdown code fences (` ```json ... ``` `). Use `parseJsonResponse(raw)` to strip them before `JSON.parse`. |
| **max_tokens** | Always pass `>= 1024` to `llm.call()`. Responses are truncated at the token limit, which can break JSON output mid-object. |
| **Model names** | MiniMax: `"MiniMax-M2.7"`. Anthropic: `"claude-haiku-4-5-20251001"`. OpenRouter: configurable. These are defined in `LLM_MODEL` in `src/skills/llm.ts` -- use the constant, do not hardcode. |
| **Base URL** | MiniMax uses the Anthropic SDK with `baseURL: "https://api.minimax.io/anthropic"`. OpenRouter: `"https://openrouter.ai/api/v1"`. These are handled by `getLlmClient()` -- you never need to set them manually. |
| **Cost** | MiniMax: ~$0.001-0.002 per skill call. Anthropic Haiku: ~$0.001-0.002. OpenRouter: varies by model. Set `costUsd` in your result accordingly. |

---

## 7. Findings Severity Guide

Each finding has a `severity` that controls how it appears in the terminal and HTML report:

| Severity | Icon | Meaning | Report visibility |
|----------|------|---------|-------------------|
| `"error"` | :x: | Must fix before publishing. A blocking issue. | Shown in HTML report findings list and terminal |
| `"warn"` | :warning: | Should fix. May affect quality or compliance. | Shown in HTML report findings list and terminal |
| `"info"` | *(none)* | Informational only. A tip or observation. | Terminal only -- hidden from HTML report findings list |

**Guidelines for choosing severity:**

- Use `"error"` for issues that would cause legal, ethical, or factual problems if published. Examples: plagiarized content, defamatory statements, unsubstantiated health claims.
- Use `"warn"` for issues that reduce quality but are not blockers. Examples: corporate jargon, sentences that are too long, missing headings.
- Use `"info"` for suggestions and context. Examples: "Consider adding a meta description", "Article is within ideal word count range". Info findings keep the HTML report clean while still providing value in the terminal.

---

## 9. Phase 7 — Provider-picker skills

New skills should use `resolveProvider(config, skillId)` from `src/providers/resolve.ts` rather than reading flat config fields. Register metadata in `src/providers/registry.ts` (and mirror to `dashboard/src/lib/providers.ts` — `scripts/check-registry-parity.ts` enforces parity in CI).

Skills can return `Finding` entries with any combination of `sources[]` / `rewrite` / `citations[]` / `claimType` / `confidence`. The `enrichFindings()` step in the orchestrator (`src/skills/enrich.ts`) merges citations from enricher skills onto matching fact-check findings, so a single finding can carry all four outputs (the "four-output contract" asserted in `tests/e2e/phase7.test.ts`).

### Enricher pattern

Enrichers implement `EnricherSkill` — a `Skill` variant with `kind: "enricher"` and an `enrich(text, config, priorResults)` method. The orchestrator runs primary skills in parallel, then enrichers with `priorResults` passed in. Academic citations are the canonical example: the skill scans fact-check findings with `claimType: scientific | medical | financial` and attaches `citations[]` to them.

### Cost estimation

Each skill should contribute to the pre-flight cost estimate. Register your skill's cost function in `src/cost/estimator.ts` and mirror to `dashboard/src/lib/cost-estimator.ts`. The drift-guard script only checks provider IDs, so mirror the cost logic manually.
