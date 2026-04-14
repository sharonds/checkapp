# Overnight Build — Phase 2 + 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 (skill improvements + docs) and Phase 3 (batch checking, configurable thresholds, keyword density, better output) — a fully polished open-source product by morning.

**Architecture:** All work in a worktree `feature/phase-2-3`. Merge to `main` at the end after full test suite passes.

**Tech Stack:** Bun, TypeScript strict, MiniMax M2.7 / Anthropic Claude Haiku, Exa AI, bun:sqlite, Ink + React

**Testing protocol (every task):**
1. `bun test` — all tests pass
2. E2e: `bun run src/index.tsx /tmp/test-article.txt` — no crashes, output format correct
3. Open `article-checker-report.html` in browser — visual check
4. Commit with descriptive message

**MiniMax gotchas (from Phase 1):**
- Always use `getTextBlock()` + `parseJsonResponse()` from `src/skills/llm.ts`
- Set `max_tokens >= 1024` — thinking tokens count against the limit
- `info` findings are hidden from the HTML report — use `warn` for actionable items

---

## PHASE 2 — Skill Improvements

### Task 1: Content Summary Skill

A new `SummarySkill` that tells users what their article is about before they look at quality scores. Uses MiniMax/Claude.

**Files:**
- Create: `src/skills/summary.ts`
- Create: `src/skills/summary.test.ts`
- Modify: `src/config.ts` — add `summary: boolean` to `SkillsConfig`, default `false`
- Modify: `src/check.tsx` — add `SummarySkill` to registry when enabled
- Modify: `src/report.ts` — add `ENGINE_LABEL` entry + dedicated summary info block

- [ ] **Step 1: Write test**

```typescript
// src/skills/summary.test.ts
import { describe, it, expect } from "bun:test";
import { buildSummaryPrompt } from "./summary.ts";

describe("buildSummaryPrompt", () => {
  it("includes article text in prompt", () => {
    const p = buildSummaryPrompt("Vitamin D is essential for bone health.");
    expect(p).toContain("Vitamin D");
  });
  it("requests structured JSON with topic and audience", () => {
    const p = buildSummaryPrompt("text");
    expect(p).toContain('"topic"');
    expect(p).toContain('"audience"');
    expect(p).toContain('"tone"');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
bun test src/skills/summary.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/skills/summary.ts
import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, getTextBlock, parseJsonResponse } from "./llm.ts";

export function buildSummaryPrompt(articleText: string): string {
  return `Analyze this article and return a brief structured summary.

ARTICLE:
${articleText.slice(0, 4000)}

Reply with ONLY this JSON, no other text:
{
  "topic": "<one sentence — what is this article about>",
  "argument": "<one sentence — the main claim or thesis>",
  "audience": "<target reader in 5 words or less>",
  "tone": "<one word: informational/persuasive/conversational/technical/promotional>"
}`;
}

interface SummaryResponse {
  topic: string;
  argument: string;
  audience: string;
  tone: string;
}

export class SummarySkill implements Skill {
  readonly id = "summary";
  readonly name = "Content Summary";

  async run(text: string, config: Config): Promise<SkillResult> {
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "warn", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to enable content summary" }],
        costUsd: 0,
      };
    }

    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildSummaryPrompt(text) }],
    });

    const raw = getTextBlock(response.content);
    let parsed: SummaryResponse;
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse content summary",
        findings: [], costUsd: 0.001,
      };
    }

    return {
      skillId: this.id,
      name: this.name,
      score: 100,
      verdict: "pass",
      summary: parsed.topic,
      findings: [
        { severity: "info", text: `Main argument: ${parsed.argument}` },
        { severity: "info", text: `Target audience: ${parsed.audience}` },
        { severity: "info", text: `Tone: ${parsed.tone}` },
      ],
      costUsd: 0.001,
    };
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun test src/skills/summary.test.ts
```

- [ ] **Step 5: Register the skill**

In `src/config.ts`:
- Add `summary: boolean` to `SkillsConfig` interface
- Add `summary: false` to `DEFAULT_SKILLS`

In `src/check.tsx`:
- Import `SummarySkill`
- Add `config.skills.summary && new SummarySkill()` to the skills array

In `src/report.ts`:
- Add `"summary": { label: "MiniMax", color: "#0891b2" }` to `ENGINE_LABEL`

- [ ] **Step 6: Add dedicated summary info block in report.ts**

Add a `summaryBlock()` function that renders the summary skill's `info` findings as a clean panel (blue background, not in the regular card list). In `generateReport()`, render it above the regular skill cards:

```typescript
function summaryBlock(results: SkillResult[]): string {
  const r = results.find((s) => s.skillId === "summary");
  if (!r || r.verdict !== "pass") return "";
  const infoFindings = r.findings.filter((f) => f.severity === "info");
  if (infoFindings.length === 0) return "";
  return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:16px">
    <div style="font-weight:700;font-size:14px;color:#0369a1;margin-bottom:6px">📋 Content Summary</div>
    <p style="margin:0 0 8px 0;font-size:14px;color:#0f172a;line-height:1.5">${escapeHtml(r.summary)}</p>
    ${infoFindings.map((f) => `<div style="font-size:13px;color:#475569;margin-top:4px">${escapeHtml(f.text)}</div>`).join("")}
  </div>`;
}
```

Then in the HTML body, after the source div:
```
${summaryBlock(record.results)}
```

The summary skill card itself can be excluded from the regular card list since it's rendered separately.

- [ ] **Step 7: Run full test suite + e2e**

```bash
bun test
```
Enable `summary: true` in `~/.article-checker/config.json`, run e2e, verify summary card appears in HTML report.

- [ ] **Step 8: Commit**

```bash
git add src/skills/summary.ts src/skills/summary.test.ts src/config.ts src/check.tsx src/report.ts
git commit -m "feat(skills): add content summary skill — topic, argument, audience, tone via MiniMax"
```

---

### Task 2: Legal Skill — Suggestion Field

Each legal risk finding should include a concrete fix suggestion.

**Files:**
- Modify: `src/skills/legal.ts` — update prompt + findings mapping
- Modify: `src/skills/legal.test.ts` — verify prompt asks for suggestion

- [ ] **Step 1: Update test**

Add to `src/skills/legal.test.ts`:
```typescript
it("prompt requests suggestion field", () => {
  const prompt = buildLegalPrompt("test");
  expect(prompt).toContain('"suggestion"');
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Update prompt**

In `buildLegalPrompt()`, add `"suggestion": "<one concrete fix>"` to the JSON schema in the prompt. Update the risks array example to include suggestion.

- [ ] **Step 4: Update findings mapping**

```typescript
const findings: Finding[] = (parsed.risks ?? []).map((r) => ({
  severity: r.severity as "warn" | "error",
  text: `${r.category}: ${r.reason}${r.suggestion ? ` — Fix: ${r.suggestion}` : ""}`,
  quote: r.quote,
}));
```

- [ ] **Step 5: Run tests + e2e with legal enabled**

- [ ] **Step 6: Commit**

```bash
git add src/skills/legal.ts src/skills/legal.test.ts
git commit -m "feat(legal): add fix suggestion per risk finding in legal skill"
```

---

### Task 3: SEO Skill — Keyword Detection + First Paragraph Check

Extract the top keyword and check if it appears in the first paragraph.

**Files:**
- Modify: `src/skills/seo.ts` — add `extractTopKeyword()`, first-paragraph check
- Modify: `src/skills/seo.test.ts` — add tests

- [ ] **Step 1: Write test**

Add to `src/skills/seo.test.ts`:
```typescript
import { extractTopKeyword } from "./seo.ts";

describe("extractTopKeyword", () => {
  it("extracts most repeated meaningful word", () => {
    expect(extractTopKeyword("vinegar vinegar vinegar apple cider helps blood sugar")).toBe("vinegar");
  });
  it("ignores stop words", () => {
    expect(extractTopKeyword("the the the the the apple")).toBe("apple");
  });
  it("returns empty for very short text", () => {
    expect(extractTopKeyword("hi")).toBe("");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement `extractTopKeyword()`**

```typescript
export function extractTopKeyword(text: string): string {
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of",
    "with","is","are","was","were","be","been","being","have","has","had","do","does","did",
    "will","would","could","should","may","might","shall","can","this","that","these","those",
    "it","its","not","no","from","by","as","if","then","than","so","up","out","about","also",
    "just","more","most","very","much","many","some","other","into","over","such","only","your",
    "their","which","when","what","where","who","how","each","every","both","after","before"]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "";
}
```

- [ ] **Step 4: Add first-paragraph check to `SeoSkill.run()`**

```typescript
const topKeyword = extractTopKeyword(text);
if (topKeyword) {
  const firstPara = text.split(/\n\s*\n/)[0] ?? "";
  if (!firstPara.toLowerCase().includes(topKeyword)) {
    findings.push({
      severity: "warn",
      text: `Top keyword "${topKeyword}" missing from the first paragraph — Google weighs the opening heavily for topic relevance`,
    });
  }
}
```

- [ ] **Step 5: Run tests + e2e**

- [ ] **Step 6: Commit**

```bash
git add src/skills/seo.ts src/skills/seo.test.ts
git commit -m "feat(seo): add keyword extraction and first-paragraph keyword check"
```

---

### Task 4: Custom Skill Documentation

The open-source enabler — teach users how to build their own skills.

**Files:**
- Create: `docs/custom-skills.md`
- Modify: `README.md` — link to the guide

- [ ] **Step 1: Write the guide**

Must cover:
1. The `Skill` interface (from `src/skills/types.ts`)
2. Minimal example: "Brand Jargon Checker" (offline skill that scans for banned words)
3. LLM-based example: "Readability Advisor" (uses MiniMax to suggest rewrites)
4. How to register: add to `SkillsConfig`, `DEFAULT_SKILLS`, check.tsx skills array
5. Testing patterns: mock config, test prompt builder, test result shape
6. MiniMax tips: `getLlmClient()`, `getTextBlock()`, `parseJsonResponse()`, `max_tokens >= 1024`

- [ ] **Step 2: Add link in README.md**

In the existing "Add your own skill" section, link to `docs/custom-skills.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/custom-skills.md README.md
git commit -m "docs: add custom skill authoring guide with examples and testing patterns"
```

---

## PHASE 3 — Product Features

### Task 5: Batch Checking (`--batch` flag)

Check all files in a directory. Results summary printed as a table, individual HTML reports saved per file.

**Files:**
- Modify: `src/index.tsx` — add `--batch <dir>` argument parsing
- Create: `src/batch.ts` — batch runner logic
- Create: `src/batch.test.ts` — unit tests
- Modify: `README.md` — document `--batch`

- [ ] **Step 1: Write test**

```typescript
// src/batch.test.ts
import { describe, it, expect } from "bun:test";
import { discoverArticles } from "./batch.ts";

describe("discoverArticles", () => {
  it("finds .md and .txt files in a directory", () => {
    // Uses demo/ directory which has markdown files
    const files = discoverArticles("demo");
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".md") || f.endsWith(".txt"))).toBe(true);
  });
  it("returns empty for nonexistent dir", () => {
    expect(discoverArticles("/tmp/nonexistent-dir-xyz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement `batch.ts`**

```typescript
// src/batch.ts
import { readdirSync, existsSync, statSync } from "fs";
import { join, extname } from "path";

export function discoverArticles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const exts = new Set([".md", ".txt"]);
  return readdirSync(dir)
    .filter((f) => exts.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .sort();
}
```

- [ ] **Step 4: Add `--batch` flag to `src/index.tsx`**

When `--batch <dir>` is passed:
1. Call `discoverArticles(dir)` to find all `.md`/`.txt` files
2. For each file, run the same check flow as a single file (readArticle → registry.runAll → save to DB → write report)
3. Name each report `article-checker-report-{filename}.html`
4. After all checks, print a summary table:

```
────────────────────────────────────────────────
Batch: 4 articles checked

  demo/english.md        58/100  ⚠ WARN
  demo/hebrew.md         72/100  ✅ PASS
  demo/test-article.md   31/100  ❌ FAIL
  demo/news-article.md   85/100  ✅ PASS

Average: 61/100 | API cost: $0.324
────────────────────────────────────────────────
```

- [ ] **Step 5: Run tests + e2e**

```bash
bun test
bun run src/index.tsx --batch demo/
```

- [ ] **Step 6: Update README with `--batch` docs**

Add to the Usage section:
```bash
# Check all articles in a directory
article-checker --batch ./articles/
```

- [ ] **Step 7: Commit**

```bash
git add src/batch.ts src/batch.test.ts src/index.tsx README.md
git commit -m "feat: add --batch flag for checking all articles in a directory"
```

---

### Task 6: Configurable Thresholds

Let users set custom pass/warn/fail cutoffs per skill in config.

**Files:**
- Modify: `src/config.ts` — add `thresholds` to Config
- Create: `src/thresholds.ts` — threshold logic
- Create: `src/thresholds.test.ts` — tests
- Modify: `src/check.tsx` — apply thresholds after skill results
- Modify: `README.md` — document thresholds

- [ ] **Step 1: Write test**

```typescript
// src/thresholds.test.ts
import { describe, it, expect } from "bun:test";
import { applyThreshold } from "./thresholds.ts";

describe("applyThreshold", () => {
  it("overrides verdict based on custom threshold", () => {
    const result = applyThreshold(
      { skillId: "seo", score: 65, verdict: "pass" },
      { pass: 80, warn: 60 }
    );
    expect(result.verdict).toBe("warn");
  });
  it("keeps original verdict when no threshold set", () => {
    const result = applyThreshold(
      { skillId: "seo", score: 65, verdict: "pass" },
      undefined
    );
    expect(result.verdict).toBe("pass");
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/thresholds.ts
import type { SkillResult, Verdict } from "./skills/types.ts";

export interface Threshold {
  pass: number; // score >= this → pass
  warn: number; // score >= this → warn (below pass)
  // below warn → fail
}

export function applyThreshold(
  result: Pick<SkillResult, "skillId" | "score" | "verdict">,
  threshold: Threshold | undefined
): { verdict: Verdict } {
  if (!threshold) return { verdict: result.verdict as Verdict };
  if (result.score >= threshold.pass) return { verdict: "pass" };
  if (result.score >= threshold.warn) return { verdict: "warn" };
  return { verdict: "fail" };
}
```

- [ ] **Step 3: Add to config**

In `src/config.ts`, add:
```typescript
thresholds?: Partial<Record<string, Threshold>>;
```

In `readConfig()`, read `THRESHOLDS` from config file (JSON object, optional).

- [ ] **Step 4: Apply thresholds in check.tsx**

After `registry.runAll()`, loop through results and apply thresholds:
```typescript
import { applyThreshold } from "./thresholds.ts";
results = results.map((r) => ({
  ...r,
  verdict: applyThreshold(r, config.thresholds?.[r.skillId]).verdict,
}));
```

- [ ] **Step 5: Run tests + e2e**

- [ ] **Step 6: Document in README**

Add a "Custom Thresholds" section:
```json
// ~/.article-checker/config.json
{
  "thresholds": {
    "seo": { "pass": 80, "warn": 60 },
    "plagiarism": { "pass": 90, "warn": 70 }
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/thresholds.ts src/thresholds.test.ts src/config.ts src/check.tsx README.md
git commit -m "feat: add configurable pass/warn/fail thresholds per skill"
```

---

### Task 7: Fact-Check Confidence Score

Currently fact-check just says supported/unsupported. Add a confidence level per claim (high/medium/low based on number of corroborating sources).

**Files:**
- Modify: `src/skills/factcheck.ts` — add confidence logic
- Modify: `src/skills/factcheck.test.ts` — test confidence function

- [ ] **Step 1: Write test**

```typescript
import { claimConfidence } from "./factcheck.ts";

describe("claimConfidence", () => {
  it("returns high for 3+ corroborating sources", () => {
    expect(claimConfidence(3, true)).toBe("high");
  });
  it("returns low for 0 sources", () => {
    expect(claimConfidence(0, null)).toBe("low");
  });
});
```

- [ ] **Step 2: Implement `claimConfidence()`**

```typescript
export function claimConfidence(sourceCount: number, supported: boolean | null): "high" | "medium" | "low" {
  if (supported === false) return "low";
  if (supported === null) return "low";
  if (sourceCount >= 3) return "high";
  if (sourceCount >= 1) return "medium";
  return "low";
}
```

- [ ] **Step 3: Include confidence in findings**

Update the findings loop to include confidence:
```typescript
const confidence = claimConfidence(searchResults.length, supported);
findings.push({
  severity: supported === false ? "error" : supported === null ? "warn" : "info",
  text: `${supported ? "Verified" : supported === false ? "Unsupported" : "Unverified"} (${confidence} confidence): "${claim}" — ${note}`,
});
```

- [ ] **Step 4: Run tests + e2e**

- [ ] **Step 5: Commit**

```bash
git add src/skills/factcheck.ts src/skills/factcheck.test.ts
git commit -m "feat(factcheck): add confidence level (high/medium/low) per claim"
```

---

### Task 8: Full Documentation Sync

After all feature tasks, do a full README audit and update.

**Files:**
- Modify: `README.md`
- Modify: `docs/custom-skills.md` (if any APIs changed)

- [ ] **Step 1: Update Skills table**

Add Content Summary row. Verify all engines, costs, and defaults match `src/config.ts`.

- [ ] **Step 2: Update Real Results examples**

Run e2e with all skills enabled. Copy the actual terminal output into the README. Replace Example 1 with a fresh 5-skill run output.

- [ ] **Step 3: Update Usage section**

Add `--batch` docs and threshold config example.

- [ ] **Step 4: Update Roadmap**

Move completed items (batch checking, configurable thresholds, content summary, keyword density) from roadmap to "Done" or remove them. Keep future items.

- [ ] **Step 5: Update Pricing table**

Add Content Summary cost row.

- [ ] **Step 6: Verify all .env examples list all env vars**

Cross-check `src/config.ts` `readConfig()` env var reads against all `.env` examples in the README.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/custom-skills.md
git commit -m "docs: full documentation sync after Phase 2+3 features"
```

---

### Task 9: Final Integration Test

Run the complete test suite and a full e2e with all skills enabled.

**Files:** None — test only

- [ ] **Step 1: Run full test suite**

```bash
bun test
```
All tests must pass.

- [ ] **Step 2: Enable all skills for e2e**

Set in `~/.article-checker/config.json`:
```json
{
  "skills": {
    "plagiarism": true,
    "aiDetection": true,
    "seo": true,
    "factCheck": true,
    "tone": false,
    "legal": true,
    "summary": true
  }
}
```

- [ ] **Step 3: Run e2e with MiniMax + Exa enabled**

```bash
bun run src/index.tsx /tmp/test-article.txt
```

Expected: all 6 enabled skills fire, no crashes, HTML report generated with summary block + all skill cards.

- [ ] **Step 4: Run batch e2e**

```bash
bun run src/index.tsx --batch demo/
```

Expected: all demo articles checked, summary table printed.

- [ ] **Step 5: Open HTML report in browser — visual check**

Verify:
- Circular score indicator
- Summary info block (blue panel)
- All skill cards with engine badges
- Footer with links and disclaimer
- No visual bugs

- [ ] **Step 6: Merge to main**

If all tests pass and e2e looks good:
```bash
git checkout main
git merge feature/phase-2-3 --no-edit
bun test
```

---

## Execution Order

| Order | Task | Phase | Est. Complexity |
|-------|------|-------|----------------|
| 1 | Content Summary Skill | P2 | Medium |
| 2 | Legal Suggestions | P2 | Low |
| 3 | SEO Keywords | P2 | Low |
| 4 | Custom Skill Docs | P2 | Low (docs only) |
| 5 | Batch Checking | P3 | Medium |
| 6 | Configurable Thresholds | P3 | Medium |
| 7 | Fact-Check Confidence | P3 | Low |
| 8 | Full Docs Sync | P3 | Low (docs only) |
| 9 | Final Integration Test | P3 | Low (test only) |
