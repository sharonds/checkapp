# Decision Matrix — CheckApp Provider Replacement Programme

**Programme:** Plan 3 of the fact-check → integration → expansion research programme
**Date:** 2026-04-22
**Author:** Sharon Sciammas (with Claude Code assistance)
**Status:** DRAFT pending external review (see bottom)

This document synthesizes all four replacement POCs plus the prior fact-check research
(Plan 1). It is the primary deliverable of Plan 3 and feeds Gate 4 of the stage-gates
document.

---

## One-page summary

| API / Skill | Current provider | **Verdict** | Recommended combined architecture |
|---|---|---|---|
| Fact-check (core) | Exa + LLM | **replace** | Gemini 3.1 Pro grounded (Plan 2 in progress) |
| Plagiarism | Copyscape csearch | **combine** | Always run Copyscape + Gemini grounded in parallel. One unified verdict with sentence-level attribution, merged URL list, combined similarity score |
| AI Detection | Copyscape aicheck | **combine** | Always run Copyscape + **GPT-5.4** (not Gemini) in parallel. One unified probability + highlighted passages. No 4-state ambiguity surface |
| Academic Citations | Semantic Scholar | **replace + combine** | Replace SS with OpenAlex (forced — SS broken). Always run OpenAlex sync + Gemini grounded async. User sees one unified citation list, OpenAlex results immediate, Gemini canonical-source upgrades merge in when ready |
| LLM skills — tone | MiniMax-M2.7 | **replace** | GPT-5.4 |
| LLM skills — legal (with policy) | MiniMax-M2.7 | **keep** | MiniMax (cheapest, narrow win) |
| LLM skills — legal (no policy) | not offered | **new capability** | GPT-5.4 (only provider that scores > 2/5) |
| LLM skills — summary | MiniMax-M2.7 | **replace** | GPT-5.4 |
| LLM skills — brief | MiniMax-M2.7 | **replace** | GPT-5.4 |
| LLM skills — purpose | MiniMax-M2.7 | **replace** | GPT-5.4 |
| Legal premium tier | — | **reject** | Deep Research tested on both modes, scored 2.78/5 no-policy; DO NOT adopt for legal |
| Grammar | LanguageTool | **not tested** | No change (rule-based, LLM overkill) |
| Self-plagiarism | Cloudflare Vectorize | **not tested** | No change (user's private index, grounding can't access) |

### Cross-cutting architectural finding

**Gemini 3.1 Pro's strength is web grounding, not text classification.** It dominates
fact-check, plagiarism, and citations (where Google Search grounding is decisive), and
underperforms on every pure-text-analysis task (skills, AI detection). Do NOT adopt
Gemini as a general-purpose LLM provider.

---

## Per-verdict detail and evidence strength

### Fact-check — **replace** (incumbent Exa → Gemini 3.1 Pro)

From Plan 1 research:
- Engine B (Gemini 3.1 Pro + Google Search grounding) achieved **100% accuracy on 20
  synthetic claims across 5 fields**
- Engine A (Exa + Gemini) achieved 55% on same corpus
- Gap: 45 percentage points; p < 0.01 on sign test
- Engine B caught 7 ground-truth errors the author made while writing the corpus

| Column | Value |
|---|---|
| Evidence strength | **Strong** — n=20, cross-field, statistically significant |
| Production readiness | **Plan 2 in progress** — behind feature flag, controlled rollout |
| Rollback path | Feature flag off → Basic tier (Engine A) remains intact |
| Dependency impact | Adds GEMINI_API_KEY as required env var; EXA_API_KEY becomes optional (fallback only) |

---

### Plagiarism — **combine**

POC 1 results (16 articles incl. Hebrew and non-Wikipedia sources, 119 sentences):
- Copyscape: 98.3% sentence accuracy, 95.3% recall — but 0% on one near-verbatim article
- Gemini: 100% sentence accuracy, 100% recall
- Cost: Gemini 3.8× more expensive, 30× slower
- Zero false positives for both engines

| Column | Value |
|---|---|
| Evidence strength | **Strong** — n=16 diverse articles, Hebrew + English, 0 FPs across both engines |
| Production readiness | Hybrid requires secondary-check orchestration code (new) |
| Rollback path | Disable Gemini secondary → Copyscape-only behavior (current production) |
| Dependency impact | GEMINI_API_KEY shared with fact-check — no new dependency |

**Architecture:** Always run both engines in parallel on every article. Merge into one
unified plagiarism result:
- Similarity score: combined (prefer Gemini's semantic estimate, supplement with
  Copyscape's statistical match where it's higher)
- Matched URLs: union of both engines' source lists, deduplicated by hostname
- Sentence-level attribution: prefer Gemini (per-sentence JSON output), fall back to
  Copyscape span mapping
- Confidence indicator: "both agree" / "minor divergence" / "major divergence" —
  internal telemetry only, not user-facing

**Why combine rather than hybrid-with-trigger:** Copyscape's aggregate similarity % is
unreliable across non-Wikipedia sources (26% on Britannica vs 65% on equivalent
Wikipedia). A trigger-based secondary check would miss cases where Copyscape wrongly
reports low confidence. Running both always eliminates that failure mode at modest
cost.

---

### AI Detection — **combine Copyscape + GPT-5.4 (not Gemini)**

POC 2 results (20 samples, 10 AI / 10 HUMAN, 4 provenance types):

| Metric | Copyscape | Gemini | **GPT-5.4** |
|---|---|---|---|
| Accuracy | 90% | 80% | **90%** |
| Recall | **100%** | 60% | 80% |
| Precision | 83.3% | 100% | 100% |
| Spearman calibration | 0.896 | 0.747 | 0.875 |

**Failure-mode complementarity:**
- Copyscape: over-flags 2/5 human-then-polished samples as AI (false positives)
- Gemini: misses 4/5 AI-then-edited samples (missed AI with added personal details)
- GPT-5.4: misses 2/5 AI-then-edited samples (strictly better than Gemini, caught cooking + budget cases)

| Column | Value |
|---|---|
| Evidence strength | **Moderate** — n=20, all AI samples from Claude (one LLM family); production should validate 100+ |
| Production readiness | Single unified verdict output. No ambiguity-surface in UI |
| Rollback path | Disable GPT-5.4 side → Copyscape-only binary output |
| Dependency impact | OPENAI_API_KEY added (same as used in skills) |

**Architecture:** Always run both engines on every article. Merge into one unified result:
- Probability score: weighted average (Copyscape weight 0.55, GPT-5.4 weight 0.45 —
  proportional to their Spearman calibration 0.896 / 0.875)
- Verdict: AI if combined probability > 50%, otherwise HUMAN
- Highlighted passages: union of Copyscape's high-AI-score segments and GPT-5.4's
  identified AI passages
- User-facing UI: single probability number + highlighted passages. No 4-state
  ambiguity — where the engines disagree, the weighted score captures it in one number.

**Cost note:** GPT-5.4 at $0.0025/sample is slightly cheaper than Gemini ($0.003) and
meaningfully cheaper than Copyscape ($0.010) for this specific task.

---

### Academic Citations — **replace** (SS → OpenAlex) **+ combine** (with Gemini)

POC 3 results (10 claims across medical/scientific/financial):

| Metric | OpenAlex | Gemini |
|---|---|---|
| Exact-gold Recall@3/@5 | 10% | **70%** |
| Acceptable-support Recall@3/@5 | 80% | **100%** |
| Latency | **~1s** | ~55s median (25–108s) |
| Cost/claim | **$0** | $0.038 |

**Semantic Scholar's free tier is production-unusable** — returned HTTP 429 on every
call from a shared IP. Forces the baseline swap regardless of Gemini question.

**OpenAlex is a viable drop-in for SS:** same API shape, 200M+ works, no rate limiting
observed in this POC (polite pool with `mailto` parameter).

| Column | Value |
|---|---|
| Evidence strength | **Moderate** — n=10 claims, judge bias noted on acceptable-support metric |
| Production readiness | Requires async merge pattern (OpenAlex instant, Gemini merges when ready ~60s later) |
| Rollback path | Disable Gemini side → OpenAlex-only output (80% acceptable-support still) |
| Dependency impact | Drops SEMANTIC_SCHOLAR_API_KEY requirement; GEMINI_API_KEY shared |

**Architecture:** Every citation request fires both engines simultaneously. OpenAlex
results return in ~1s and render immediately (80% acceptable-support, instant feel).
Gemini returns ~60s later and **merges into the same citation list**, promoting its
canonical-paper finds to the top. User sees one list that gets better. Not a separate
"premium tier" — this is the default citation experience for paid users.

Free-tier users get OpenAlex only (no Gemini cost). Paid tier gets the combined result.

---

### LLM skills — **reject Gemini**, **replace MiniMax → GPT-5.4** (most skills), **keep MiniMax** (legal-with-policy), **new capability** (legal-no-policy)

POC 4 results (3 articles × 6 skill-modes × 3 providers = 54 cells, judge = gpt-5.4-mini):

| Skill | MiniMax | Gemini | **GPT-5.4** | Winner |
|---|---|---|---|---|
| tone | 2.94 | 3.06 | **4.17** | GPT-5.4 |
| legal (with policy) | **3.44** | 2.67 | 2.89 | MiniMax |
| legal (no policy) | 1.78 | 1.50 | **3.11** | GPT-5.4 (only viable) |
| summary | 4.22 | 3.67 | **4.33** | GPT-5.4 |
| brief | 4.33 | 3.50 | **4.83** | GPT-5.4 |
| purpose | 3.75 | 3.08 | **4.17** | GPT-5.4 |

**Pairwise head-to-head:** MiniMax beats Gemini 13–1–4. GPT-5.4 beats MiniMax 12–4–2.
GPT-5.4 beats Gemini 18–0–0 (a complete sweep).

| Column | Value |
|---|---|
| Evidence strength | **Moderate** — n=3 articles × 5 skills, per-skill CIs wide. Trends clear, magnitude noisy |
| Production readiness | Prompts unchanged; only provider wiring in `getLlmClient()` |
| Rollback path | `LLM_PROVIDER` env toggle back to MiniMax |
| Dependency impact | OPENAI_API_KEY becomes required; MiniMax retained for legal-with-policy |

**Deep Research legal — tested both modes:**

Mode A (with policy): DR lost to MiniMax (3.33 vs 4.33) and Gemini (2.00 vs 4.33),
tied with GPT-5.4.

Mode B (no policy): DR mean 2.78/5. Beat MiniMax narrowly (3.00 vs 2.67) and Gemini
(2.67 vs 1.00, Gemini unusable), but **lost to GPT-5.4** (2.67 vs 3.00). Judge
reasoning consistent: DR "overstates enforcement risk" and "offers limited concrete
rewrite guidance".

**Conclusion:** Deep Research is unsuitable for legal skill at either mode. DR's
comprehensive regulatory citation becomes a liability — produces legal textbook
overviews rather than article-specific fixes. DR's premium-tier value remains
**fact-check only** (Plan 1's Engine C).

---

## Cost impact analysis

### Per-article cost — combined architecture, always-on

| Provider change | Before | After | Δ per article |
|---|---|---|---|
| Fact-check Exa → Gemini | $0.055 | $0.155 | +$0.100 |
| Plagiarism Copyscape alone → **combine** CS + Gemini | $0.010 | $0.048 | +$0.038 |
| AI detection Copyscape alone → **combine** CS + GPT-5.4 | $0.010 | $0.013 | +$0.003 |
| Citations SS broken → OpenAlex + Gemini combined (paid tier) | $0 | $0.038 | +$0.038 |
| LLM skills MiniMax → GPT-5.4 (4 of 5 skills) | $0.004 | $0.060 | +$0.056 |
| **Per-article delta** | **$0.079** | **$0.314** | **+$0.235** |

### Monthly cost at scale

For a team publishing 100 articles/month through CheckApp:

| Scenario | Current (MiniMax-based) | Recommended (combined) | Delta |
|---|---|---|---|
| Free tier (OpenAlex, Copyscape-only plagiarism/AI) | ~$1 | ~$1 | $0 |
| Paid tier (combined everything + fact-check) | ~$8 | ~$31 | +$23 |
| Enterprise tier (above + Deep Research fact-check avg 10/mo) | ~$23 | ~$46 | +$23 |

~4× cost increase on the paid tier. Justified by quality/confidence: the user gets
ONE unified verdict per check, not two different answers to reconcile.

### API key changes

**Currently required:** COPYSCAPE_USER, COPYSCAPE_KEY, MINIMAX_API_KEY, EXA_API_KEY,
(SEMANTIC_SCHOLAR indirect), (LANGUAGETOOL free).

**After adoption of all "replace" verdicts:**
- **Add:** OPENAI_API_KEY (GPT-5.4 skills + AI detection secondary), GEMINI_API_KEY
  (fact-check + plagiarism secondary + citations premium)
- **Drop:** EXA_API_KEY (fallback only — no longer required)
- **Drop:** SEMANTIC_SCHOLAR dependency (replaced by OpenAlex, which needs only `mailto`)
- **Retain:** COPYSCAPE_USER/KEY (plagiarism primary + AI detection primary),
  MINIMAX_API_KEY (legal-with-policy only)

Net: +2 keys required, -2 keys optional. User complexity neutral.

---

## Plan 2 follow-on tasks

For each replace/augment verdict, concrete task lists to extend Plan 2. These should be
behind **new feature flags**, not promoted to default until the same gating process as
fact-check completes.

### Follow-on A — Plagiarism combined verdict

1. Add `--plagiarism-combined` flag (default on for paid tier; off for free)
2. Always run Copyscape + Gemini grounded in parallel on every article
3. Response schema: single `PlagiarismResult` with merged fields
   - `similarityPct` = combined score (see algorithm below)
   - `matchedUrls` = union, deduplicated by hostname
   - `sentences[]` = per-sentence attribution from Gemini + Copyscape span mapping
   - `_debug.perEngine` = raw Copyscape + Gemini outputs (internal-only, not exposed)
4. Combination algorithm:
   - If Copyscape ≥ 30% AND Gemini flags ≥ 1 sentence → similarity = max(CS pct, Gemini pct)
   - If Copyscape < 10% AND Gemini flags 0 sentences → similarity = CS pct (likely clean)
   - Ambiguous zone (one engine flags, other doesn't) → take max of the two, prefer
     Gemini's sentence-level output for user display
5. Dashboard UI: one number, one list of sources, one list of flagged sentences
6. Telemetry: internal disagreement rate (should be < 20% based on POC 1 data)

### Follow-on B — AI Detection combined verdict (GPT-5.4, not Gemini)

1. Add `--ai-detection-combined` flag (default on for paid tier)
2. Always run Copyscape aicheck + GPT-5.4 in parallel on every article
3. Response: single `AiDetectorResult` with combined output
   - `aiProbability` = weighted average (0.55 × Copyscape + 0.45 × GPT-5.4, weights
     proportional to Spearman calibration)
   - `verdict` = "ai" | "human" based on 50% threshold
   - `flaggedPassages[]` = union of Copyscape high-AI segments + GPT-5.4 identified passages
   - `_debug.perEngine` = raw outputs (internal, not user-facing)
4. User-facing UI: single probability number + highlighted passages in the article. No
   ambiguity states, no disagreement display, no "consulted secondary" banner
5. Validation on 100+ production samples before flag-default-on
6. Dependency: ensure `OPENAI_API_KEY` is configured

### Follow-on C — Citations: OpenAlex replacement + Gemini combined

1. Replace Semantic Scholar client entirely — see `src/providers/semanticscholar.ts`.
   New file: `src/providers/openalex.ts`. Interface unchanged for upstream callers.
2. For every citation request (paid tier): fire OpenAlex + Gemini grounded in parallel
   - OpenAlex returns in ~1s, render immediately
   - Gemini returns in ~60s, **merges into the same citation list**, promoting any
     canonical paper it found to the top
3. Job state machine for the Gemini side: `pending | in_progress | completed | failed`
   (reuse the Deep Audit pattern from Plan 2)
4. UI: one citation list. OpenAlex results appear first (with subtle "loading more..."
   indicator). Gemini's canonical-paper hits slot in when ready. No separate tabs,
   no separate buttons.
5. Optional notification on Gemini completion (email / push) for articles the user
   already navigated away from
6. Telemetry: OpenAlex hit rate (acceptable-support), Gemini upgrade rate (canonical
   paper found that OpenAlex missed), Gemini median + p95 latency
7. Free tier: OpenAlex only, no Gemini cost. Paid tier: combined.

### Follow-on D — LLM skills: MiniMax → GPT-5.4

1. Introduce per-skill provider config — not an all-or-nothing LLM swap
2. New matrix (modify `src/providers/resolve.ts`):
   ```
   tone        → openai:gpt-5.4
   legal       → minimax (when policy doc present)
                | openai:gpt-5.4 (when no policy doc)
   summary     → openai:gpt-5.4
   brief       → openai:gpt-5.4
   purpose     → openai:gpt-5.4
   factcheck   → gemini (Plan 2)
   ```
3. Provider fallback chain: OpenAI → MiniMax → Gemini (if OpenAI unavailable, degrade
   gracefully to MiniMax which beats Gemini on most skills)
4. Per-skill prompts unchanged — only provider selection changes
5. Cost telemetry per skill call for cost alerting

### Follow-on E — Legal premium "Deep Legal Audit" ~~CANCELLED~~

**Decision: do NOT implement.** Deep Research tested on both legal modes — scored 2.78/5
in no-policy mode (below the 4.0 adoption threshold) and lost to standard LLMs in both
modes. Documented in `04-llm-skills-swap/RESULTS.md` and `04-llm-skills-swap/dr-nopolicy-judgement-*.json`.

Legal-no-policy will be served by GPT-5.4 (3.11 mean, 3.00 on 01-health head-to-head
vs DR's 2.67) with an appropriate "best-effort, not legal advice" disclaimer.

DR remains the right premium tier for fact-check (Plan 1's Engine C, validated there).

---

## What we explicitly did NOT test

- **Grammar** — rule-based LanguageTool serves this. LLM would be overkill.
- **Self-plagiarism** — requires the user's private Cloudflare Vectorize index.
  Grounding cannot access user-private data.
- **Deep Research for citations** — cost/time profile wrong for A/B testing at corpus scale.
- **GPT-5.4 on plagiarism and citations (POC 1 and POC 3)** — the story there is
  "semantic search beats legacy" — adding GPT as a second AI option would confirm
  but not change the architectural direction.
- **Deep Research on legal-no-policy** — flagged as the highest-value untested case
  ($1.50 × 1 = cheap to run) but deferred pending commit to premium-tier product decision.

---

## External review (required before Plan 3 close)

Per the stage-gates document:
> Decision matrix (Plan 3 final deliverable) reviewed by at least one non-author reviewer

**Review checklist:**
- [ ] Reviewer 1 (name + date): ______________
  - [ ] Verdicts defensible given evidence strength?
  - [ ] Cost impact numbers sanity-check?
  - [ ] Follow-on tasks cover the identified gaps?
  - [ ] Anything missing or wrong?
- [ ] Reviewer 2 (optional, recommended for the GPT-5.4 recommendations): ______________

**Known review weaknesses (flagged for the reviewer):**
1. n sizes are modest across POCs (16/20/10/15). Directional but not definitive.
2. Judge bias: POC 4 judge is gpt-5.4-mini, same family as one contender. Gap sizes
   are large enough to rule out bias-alone, but a non-OpenAI judge would strengthen
   the case.
3. Deep Research evaluated only in the mode it's least likely to win.
4. All AI samples in POC 2 were Claude-generated. GPT- or Llama-generated samples
   should be added before production deployment.
5. Hebrew coverage in POC 1 relied on he.wikipedia.org + idi.org.il. Direct Israeli
   news sites (ynet/mako/calcalist) were unreachable via WebFetch — untested.

---

## Programme budget actuals

Plan 3 target: ≤ $15 in API costs across all 4 POCs.

| POC | Spend |
|---|---|
| POC 1 — Plagiarism (initial + extended) | $0.77 |
| POC 2 — AI Detection (initial + GPT-5.4 supplement) | $0.31 |
| POC 3 — Academic Citations | $0.68 |
| POC 4 — LLM Skills Swap + Deep Research | $1.85 |
| **Total** | **$3.61 / $15.00** |

Budget well within ceiling. Room for the Deep Research Mode B test ($1.50) if the product
team wants to validate the premium-tier hypothesis.

---

## Relationship to prior plans

- **Plan 1 (fact-check research)** — establishes Gemini's dominance on web-grounded tasks.
  Feeds into POC 1 and POC 3 verdicts.
- **Plan 2 (fact-check integration)** — in progress; Gate 2 gating the default-flip.
  This decision matrix informs the broader integration strategy.
- **Plan 3 (this)** — produces the matrix; does NOT commit to integration. Integration
  decisions follow from the reviewer sign-off and the product roadmap.

---

## Gate 4 check

Per stage-gates.md Gate 4: "Deciding to replace other providers beyond fact-check
requires:"
- [x] All four POCs complete with RESULTS.md and clear verdicts
- [ ] For any "replace" verdict: new skill tests passing — **deferred to Plan 2 extensions**
- [x] Budget actuals documented — $3.61 / $15
- [ ] Decision matrix reviewed by at least one non-author reviewer — **pending**
- [ ] No production integration until matrix + follow-on plan are explicitly approved — **status: not started**

**Plan 3 status: complete pending external review.**
