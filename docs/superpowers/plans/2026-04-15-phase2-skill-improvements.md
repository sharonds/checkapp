# Phase 2 — Skill Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the quality of every existing skill, add a content summary skill, polish the HTML report further, and publish documentation for writing custom skills.

**Architecture:** Each improvement is self-contained within its skill file. The content summary is a new 7th skill. HTML report improvements build on the existing `report.ts`. Custom skill documentation is a new `docs/custom-skills.md`.

**Tech Stack:** Bun, TypeScript, MiniMax M2.7 (via Anthropic SDK), Exa AI, existing skill interface

---

## Lessons Learned (from Phase 1 + MiniMax integration)

- MiniMax M2.7 is an extended-thinking model: always use `getTextBlock()` + `parseJsonResponse()` from `src/skills/llm.ts`
- Increase `max_tokens` to at least 1024 for any MiniMax call — thinking tokens count against the limit
- All skills must handle the "no API key" case and return a `warn` result with a helpful setup hint
- `info` severity findings are now hidden from the HTML report — use `warn` for anything actionable
- Each skill change requires: update tests → run `bun test` → run e2e → update README

---

## File Structure

**Modified:**
- `src/skills/seo.ts` — more SEO best practice checks
- `src/skills/legal.ts` — richer category labels and improved prompt
- `src/skills/factcheck.ts` — confidence score per claim
- `src/report.ts` — improved HTML design (already improved in this PR, more to do)
- `README.md` — updated skill descriptions, new skill table rows

**Created:**
- `src/skills/summary.ts` — content summary skill (MiniMax)
- `src/skills/summary.test.ts` — unit tests
- `docs/custom-skills.md` — guide for building and registering custom skills

---

## Task 1: Content Summary Skill

Write a new `SummarySkill` that uses MiniMax to generate a brief analysis of the article: what it's about, the main argument, and the target audience. This gives every report a "What is this article?" answer even before looking at quality scores.

**Files:**
- Create: `src/skills/summary.ts`
- Create: `src/skills/summary.test.ts`
- Modify: `src/check.tsx` — add `SummarySkill` to the registry (enabled by default when LLM key set)
- Modify: `src/config.ts` — add `summary: false` to `DEFAULT_SKILLS`
- Modify: `README.md` — add row to Skills table

- [ ] **Step 1: Write the failing test**

```typescript
// src/skills/summary.test.ts
import { describe, it, expect } from "bun:test";
import { buildSummaryPrompt } from "./summary.ts";

describe("buildSummaryPrompt", () => {
  it("includes article text in the prompt", () => {
    const prompt = buildSummaryPrompt("Article about vitamin D.");
    expect(prompt).toContain("vitamin D");
  });

  it("requests JSON output", () => {
    const prompt = buildSummaryPrompt("text");
    expect(prompt).toContain('"topic"');
    expect(prompt).toContain('"audience"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/skills/summary.test.ts
```
Expected: FAIL — "Cannot find module './summary.ts'"

- [ ] **Step 3: Implement the skill**

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
  "argument": "<one sentence — the main claim or point being made>",
  "audience": "<who this article is written for>",
  "tone": "<one word: informational/persuasive/conversational/technical/promotional>"
}`;
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
        findings: [{ severity: "warn", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable content summary" }],
        costUsd: 0,
      };
    }

    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildSummaryPrompt(text) }],
    });

    const raw = getTextBlock(response.content);
    let parsed: { topic: string; argument: string; audience: string; tone: string };
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse content summary",
        findings: [], costUsd: 0.001,
      };
    }

    const summary = parsed.topic;
    const findings = [
      { severity: "info" as const, text: `Main argument: ${parsed.argument}` },
      { severity: "info" as const, text: `Target audience: ${parsed.audience}` },
      { severity: "info" as const, text: `Tone: ${parsed.tone}` },
    ];

    return {
      skillId: this.id, name: this.name,
      score: 100, verdict: "pass",
      summary, findings, costUsd: 0.001,
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/skills/summary.test.ts
```
Expected: 2 tests passing

- [ ] **Step 5: Add to DEFAULT_SKILLS and registry**

In `src/config.ts`, add `summary: false` to `DEFAULT_SKILLS` and `summary: boolean` to `SkillsConfig`.

In `src/check.tsx`, import `SummarySkill` and add it to the registry when `config.skills.summary` is true.

- [ ] **Step 6: Update report.ts — add engine label for summary**

In `src/report.ts`, add to `ENGINE_LABEL`:
```typescript
"summary": { label: "MiniMax", color: "#0891b2" },
```

Note: Summary findings are `info` severity and will be hidden from the HTML report's findings list by the current filter. That's intentional — the summary shows in the `summary` field of the card. If we want to show them, we'd need to add a dedicated display block for `info` findings with a lighter style.

- [ ] **Step 7: Run full test suite + e2e**

```bash
bun test
```
Expected: all existing tests pass + 2 new summary tests

Enable in config for e2e: set `skills.summary: true` in `~/.article-checker/config.json`, run:
```bash
bun run src/index.tsx /path/to/test-article.txt
```
Expected: Content Summary skill appears in output.

- [ ] **Step 8: Commit**

```bash
git add src/skills/summary.ts src/skills/summary.test.ts src/check.tsx src/config.ts src/report.ts
git commit -m "feat(skills): add content summary skill via MiniMax"
```

---

## Task 2: Legal Skill — Richer Categories and Prompt Improvements

The legal skill already categorizes findings, but the prompt can be improved to catch more nuanced risks and provide more actionable advice per finding.

**Files:**
- Modify: `src/skills/legal.ts` — improved prompt, add `suggestion` field per risk

- [ ] **Step 1: Update the prompt to request suggestions**

Modify `buildLegalPrompt()` in `src/skills/legal.ts` to add a `suggestion` field to each risk:

```typescript
export function buildLegalPrompt(articleText: string): string {
  return `You are a content legal risk reviewer. Scan the article below for these risk categories:
1. Unsubstantiated health claim — promises a medical outcome without evidence ("cures", "prevents", "guaranteed to heal")
2. Defamatory statement — false statements of fact about a named person or company presented as true
3. False promise — unconditional guarantee of a business result ("you will earn", "100% success")
4. GDPR/privacy risk — implies collecting personal data without consent language
5. Price/offer misrepresentation — advertised price or offer that could mislead

ARTICLE:
${articleText.slice(0, 5000)}

Reply with ONLY this JSON, no other text:
{
  "score": <0-100, 100=no risks>,
  "verdict": <"pass" if score>=80, "warn" if 60-79, "fail" if <60>,
  "summary": "<one sentence>",
  "risks": [
    {
      "category": "<category name>",
      "severity": <"warn" or "error">,
      "quote": "<the problematic text>",
      "reason": "<why it is a risk>",
      "suggestion": "<one concrete fix — what to replace it with>"
    }
  ]
}`;
}
```

- [ ] **Step 2: Update the `run()` method to include suggestion in finding text**

In `LegalSkill.run()`, update the findings map:

```typescript
const findings: Finding[] = (parsed.risks ?? []).map((r) => ({
  severity: r.severity as "warn" | "error",
  text: `${r.category}: ${r.reason}${r.suggestion ? ` — Fix: ${r.suggestion}` : ""}`,
  quote: r.quote,
}));
```

- [ ] **Step 3: Update the test**

In `src/skills/legal.test.ts`, add a test that verifies the prompt includes "suggestion":

```typescript
it("prompt requests suggestion field", () => {
  const prompt = buildLegalPrompt("test");
  expect(prompt).toContain('"suggestion"');
});
```

- [ ] **Step 4: Run tests**

```bash
bun test src/skills/legal.test.ts
```
Expected: all legal tests pass

- [ ] **Step 5: Run e2e to verify suggestion field appears**

Enable legal in config, test with an article that has a health claim.

- [ ] **Step 6: Commit**

```bash
git add src/skills/legal.ts src/skills/legal.test.ts
git commit -m "feat(legal): add suggestion field per risk finding"
```

---

## Task 3: SEO Skill — Keyword Density and First-Paragraph Check

Add keyword-related analysis. Since we don't know the target keyword, we extract the most repeated meaningful word (simple approach) and check if it appears in the first paragraph.

**Files:**
- Modify: `src/skills/seo.ts` — add keyword detection, first-paragraph check
- Modify: `src/skills/seo.test.ts` — add tests for new functions

- [ ] **Step 1: Add keyword extraction function with tests**

```typescript
// Add to seo.ts
export function extractTopKeyword(text: string): string {
  const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at",
    "to", "for", "of", "with", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "this", "that", "these", "those", "it", "its",
    "not", "no", "from", "by", "as", "if", "then", "than", "so", "up", "out"]);
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !stopWords.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
```

Test in `seo.test.ts`:
```typescript
it("extracts top keyword ignoring stop words", () => {
  const text = "Apple cider vinegar vinegar vinegar helps blood sugar levels in diabetic patients";
  expect(extractTopKeyword(text)).toBe("vinegar");
});
```

- [ ] **Step 2: Add first-paragraph keyword check to SeoSkill.run()**

```typescript
const topKeyword = extractTopKeyword(text);
const firstParagraph = text.split(/\n\s*\n/)[0] ?? "";
if (topKeyword && !firstParagraph.toLowerCase().includes(topKeyword)) {
  findings.push({
    severity: "warn",
    text: `Top keyword "${topKeyword}" not found in the first paragraph — Google weighs the opening heavily for topic relevance`,
  });
}
```

- [ ] **Step 3: Run tests**

```bash
bun test src/skills/seo.test.ts
```
Expected: all SEO tests pass

- [ ] **Step 4: Run e2e to confirm keyword appears in output**

- [ ] **Step 5: Commit**

```bash
git add src/skills/seo.ts src/skills/seo.test.ts
git commit -m "feat(seo): add keyword detection and first-paragraph keyword check"
```

---

## Task 4: Custom Skill Documentation

Write a guide explaining how to add a custom skill. This is the most important open-source contribution enabler.

**Files:**
- Create: `docs/custom-skills.md`

- [ ] **Step 1: Write the documentation**

The guide must cover:
1. The `Skill` interface (copy from `src/skills/types.ts`)
2. A minimal working example (a "Brand Jargon" checker)
3. How to register it in `src/check.tsx`
4. How to add it to `SkillsConfig` in `src/config.ts`
5. Testing patterns (mock config, test the prompt builder, test result shape)
6. Tips for MiniMax/Anthropic-based skills: use `getLlmClient()`, `getTextBlock()`, `parseJsonResponse()`, set `max_tokens >= 1024`

- [ ] **Step 2: Add reference to README**

In `README.md`, under the existing "Add your own skill" section, link to `docs/custom-skills.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/custom-skills.md README.md
git commit -m "docs: add custom skill authoring guide"
```

---

## Task 5: Report — Show Summary Skill Info Block

Summary skill findings are `info` severity and currently hidden. Add a dedicated "Article Summary" block at the top of the report that shows the summary skill's findings in a readable way (not as a warnings list).

**Files:**
- Modify: `src/report.ts`

- [ ] **Step 1: Add summary block function**

```typescript
function summaryBlock(r: SkillResult): string {
  // Renders info-severity findings from the summary skill as a clean info panel
  const infoFindings = r.findings.filter((f) => f.severity === "info");
  if (infoFindings.length === 0) return "";
  return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:14px">
    <div style="font-weight:700;font-size:14px;color:#0369a1;margin-bottom:8px">📋 ${escapeHtml(r.name)}</div>
    <p style="margin:0 0 8px 0;font-size:14px;color:#111827;font-style:italic">${escapeHtml(r.summary)}</p>
    ${infoFindings.map((f) => `<div style="font-size:13px;color:#374151;margin-top:4px">${escapeHtml(f.text)}</div>`).join("")}
  </div>`;
}
```

- [ ] **Step 2: Render summary block first in generateReport()**

```typescript
const summaryResult = record.results.find((r) => r.skillId === "summary");
const otherResults = record.results.filter((r) => r.skillId !== "summary");
```

Then in the HTML body: render `summaryBlock(summaryResult)` before the other skill cards.

- [ ] **Step 3: Run tests + e2e**

- [ ] **Step 4: Commit**

```bash
git add src/report.ts
git commit -m "feat(report): add article summary info block at top of report"
```

---

## Testing Protocol (applies to every task)

1. `bun test` — all 67+ tests must pass before and after each commit
2. E2e test — run `bun run src/index.tsx /tmp/test-article.txt` with the relevant skill enabled in `~/.article-checker/config.json`
3. Open `article-checker-report.html` in browser to verify visual output
4. After all tasks: update `README.md` skill table and any affected setup docs

---

## README Updates After All Tasks

Update the Skills table to add the Summary row:

| Skill | Engine | Cost/check | Enabled by default |
|-------|--------|-----------|-------------------|
| **Content Summary** | MiniMax/Claude | ~$0.001 | ❌ requires LLM key |

Update the "Real Results" section with a sample output showing all 6 (or 7) skills.
