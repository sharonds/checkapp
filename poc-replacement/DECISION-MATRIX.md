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

| API / Skill | Current provider | **Verdict** | Recommended replacement / augmentation |
|---|---|---|---|
| Fact-check (core) | Exa + LLM | **replace** | Gemini 3.1 Pro grounded (Plan 2 in progress) |
| Plagiarism | Copyscape csearch | **augment** | Keep Copyscape. Add Gemini grounded for near-verbatim detection when CS returns <10% similarity |
| AI Detection | Copyscape aicheck | **augment** | Keep Copyscape. Add **GPT-5.4** (not Gemini) as secondary signal — complementary failure modes |
| Academic Citations | Semantic Scholar | **replace (forced)** + **augment** | Replace SS with OpenAlex (SS free tier unusable). Add Gemini grounded as async "deep citation search" premium |
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

### Plagiarism — **augment**

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

**Key design constraint:** Copyscape's aggregate similarity % is unreliable across
non-Wikipedia sources (26% on Britannica content vs 65% on equivalent Wikipedia).
Trigger Gemini secondary in the 10–30% similarity band where Copyscape confidence is weakest.

---

### AI Detection — **augment with GPT-5.4 (not Gemini)**

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
| Production readiness | Requires 4-state UX (both-AI / CS-AI-only / GPT-AI-only / both-HUMAN) |
| Rollback path | Return to Copyscape-only binary output |
| Dependency impact | OPENAI_API_KEY added (same as used in skills) |

**Cost note:** GPT-5.4 at $0.0025/sample is slightly cheaper than Gemini ($0.003) and
meaningfully cheaper than Copyscape ($0.010) for this specific task.

---

### Academic Citations — **replace** (Semantic Scholar → OpenAlex) **+ augment** (Gemini)

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
| Production readiness | Requires async job pattern for Gemini premium tier (~60s latency) |
| Rollback path | Fall back to OpenAlex default (free, instant, 80% acceptable-support) |
| Dependency impact | Drops SEMANTIC_SCHOLAR_API_KEY requirement; GEMINI_API_KEY shared |

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

### Per-article cost if every "replace" verdict adopted

Baseline: one article, full audit pass through all skills.

| Provider change | Before | After | Δ per article |
|---|---|---|---|
| Fact-check Exa → Gemini | $0.055 | $0.155 | +$0.10 |
| Plagiarism Copyscape alone → CS + occasional Gemini | $0.01 | $0.01 + $0.038 × 20% = $0.018 | +$0.008 |
| AI detection Copyscape alone → CS + GPT-5.4 | $0.01 | $0.01 + $0.0025 = $0.013 | +$0.003 |
| Citations SS free → OpenAlex default | $0 | $0 | $0 |
| Citations + Gemini premium (opt-in, 20% of articles) | $0 | $0.038 × 20% = $0.008 | +$0.008 |
| LLM skills MiniMax → GPT-5.4 (4 of 5 skills) | $0.004 | $0.060 | +$0.056 |
| **Per-article delta** | | | **+~$0.18** |

### Monthly cost at scale

For a team publishing 100 articles/month through CheckApp:

| Scenario | Current (MiniMax-based) | Recommended (GPT-5.4-based) | Delta |
|---|---|---|---|
| Basic tier (free citations + minimal skills) | ~$5 | ~$5 | $0 |
| Standard tier (all skills + fact-check) | ~$6 | ~$24 | +$18 |
| Premium tier (+ Deep Research audits, avg 10/month) | ~$21 | ~$39 | +$18 |

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

### Follow-on A — Plagiarism hybrid (augment verdict)

1. Add `--plagiarism-hybrid` flag that enables secondary Gemini check
2. Trigger rule: Copyscape similarity ∈ [10%, 30%] OR matches include non-Wikipedia
   domain → fire Gemini grounded check
3. Response schema extension: add `secondarySignal: {engine, similarity, copiedSentences}`
4. Dashboard: show secondary findings when primary is ambiguous
5. Rollback playbook: flag off restores Copyscape-only behavior
6. Telemetry: flagged-sentence overlap between engines (should be > 80% where both run)

### Follow-on B — AI Detection hybrid (GPT-5.4 as secondary)

1. Add `--ai-detection-hybrid` flag, default off
2. Trigger rule: always when flag is on (cheap, $0.0025/call)
3. Response: 4-state combined verdict (both-AI / CS-only / GPT-only / both-HUMAN)
4. UI copy for each state:
   - both-AI: "Very likely AI-generated"
   - CS-only: "Statistical markers suggest AI, but prose reads human — possibly AI with human polish"
   - GPT-only: "Prose patterns suggest AI, but statistical signals are weaker — possibly AI with heavy editing" (note: never happened in POC)
   - both-HUMAN: "Likely human-authored"
5. Validation on 100+ production samples before flag-default-on
6. Dependency: ensure `OPENAI_API_KEY` is configured

### Follow-on C — Citations: OpenAlex replacement + Gemini premium

1. Replace Semantic Scholar client entirely — see `src/providers/semanticscholar.ts`.
   New file: `src/providers/openalex.ts`. Interface unchanged.
2. Add `--citations-deep-search` premium flag that queues a Gemini grounded citation
   search as an async job (60s typical, can go to 240s)
3. Job state machine (reuse the Deep Audit pattern from Plan 2): `pending | in_progress |
   completed | failed | stale`
4. UI: show OpenAlex results instantly; "Find canonical source" button kicks off Gemini job
5. Email / in-app notification on Gemini completion
6. Telemetry: OpenAlex hit rate (acceptable-support), Gemini upgrade rate, Gemini
   median-vs-p95 latency

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
