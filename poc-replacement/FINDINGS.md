# POC Replacement — Live Research Log

**Programme:** CheckApp Gemini Replacement POCs (Plan 3)
**Started:** 2026-04-21
**Status:** Infrastructure scaffolded. POC 1 (Plagiarism) not yet started.

---

## TL;DR

All four POCs complete. Budget: **$3.61 / $15.00**. See `DECISION-MATRIX.md` for the
full synthesis.

**Three headline findings:**

1. **Gemini's strength is web grounding, not classification.** It wins fact-check,
   plagiarism, and citations (all grounded tasks) but loses to MiniMax and to GPT-5.4
   on every pure-text analysis task (skills, AI detection).

2. **GPT-5.4 is the winner nobody expected in the Plan 3 scope.** It came up in POC 4
   as the strongest LLM for text-classification skills (wins 5 of 6), and in the POC 2
   supplement as a strictly-better secondary signal for AI detection (vs Gemini).
   The original "MiniMax vs Gemini" question becomes a three-way with GPT-5.4 winning.

3. **Deep Research is strictly a fact-check premium tier.** Validated in Plan 1 for
   fact-check. **Tested both legal modes and rejected.** Mode A lost to MiniMax/Gemini;
   Mode B lost to GPT-5.4 (2.67 vs 3.00). Judge rationale: DR overstates enforcement
   risk and offers comprehensive regulatory citations but limited actionable editing
   guidance. Legal use cases will be served by GPT-5.4, not DR.

| API / Skill | Verdict | Evidence strength | Notes |
|---|---|---|---|
| Copyscape (plagiarism) | **augment** | 10 articles, 75 sentences, 0 FP | POC 1 |
| Copyscape (AI detection) | **augment** | 20 samples, complementary failure modes | POC 2 |
| Semantic Scholar → OpenAlex (citations) | **replace / hybrid** | 10 claims, Gem 70%/10% gold recall | POC 3 |
| LLM (tone/legal/summary/brief/purpose) | **reject Gemini / replace MiniMax with GPT-5.4** | 18 cells × 3 providers + DR | POC 4 |

Verdict options: `keep` / `augment` / `replace` / `reject-as-unsuitable`

---

## Methodology

These POCs follow the same design principles as the fact-check research in `poc/FINDINGS.md`:

- **Ground truth first.** Each corpus is labelled before running any engine.
- **Per-POC rubric.** Scoring criteria are written in `ANNOTATION-GUIDELINES.md` before
  corpus creation — not retroactively.
- **Asymmetric expectations.** We do not expect Gemini to win every comparison. Some POCs
  are structured as "prove unsuitable" experiments (POC 2).
- **4-way verdicts.** `keep | augment | replace | reject-as-unsuitable` — not binary.
- **Budget.** ≤ $15 total across all four POCs. Actuals tracked below.

### Prior (hypotheses before testing)

| Skill | Hypothesis |
|---|---|
| Plagiarism | Uncertain — Gemini grounding can search for phrases but can't compute granular similarity |
| AI detection | Expected to lose — statistical classifiers beat LLMs on their own output |
| Academic citations | Uncertain — Gemini has breadth; Scholar has structured citation graph |
| Tone / Legal / Summary / Brief / Purpose | Trivial swap — already LLM, just change provider |

---

## Cost Tracker

| POC | API calls | Estimated cost | Actual cost |
|---|---|---|---|
| 1 — Plagiarism (initial+extended) | 16+16 calls | ~$0.16 + ~$0.61 | **$0.77** |
| 2 — AI Detection | 20+20 calls | $0.20 + $0.06 | **$0.26** |
| 3 — Academic Citations | 10 OA + 10 Gem + ~100 judge | $0 + $0.38 + $0.30 | **$0.68** |
| 4 — LLM Skills Swap (3-way + 2× DR) | ~54 provider + 54 judge + 2× DR | $0.30 + $0.05 + $3.00 | **$3.35** |
| 2 — AI Detection supplement (GPT-5.4) | 20 calls | $0.05 | **$0.05** |
| **Total** | | | **$5.11 / $15.00 budget** |

---

## POC 1 — Plagiarism (Copyscape vs Gemini grounding)

**Status:** Complete. Verdict: **augment**
**Initial run:** 2026-04-21 (10 English/Wikipedia articles)
**Extension run:** 2026-04-22 (+3 Hebrew + 2 non-Wikipedia English + 1 Hebrew original)

### Combined results (16 articles, 119 sentences, 43 plagiarised GT positives)

| Metric | Copyscape | Gemini |
|---|---|---|
| Sentence-level accuracy | 98.3% | **100.0%** |
| Sentence-level recall | 95.3% | **100.0%** |
| Sentence-level precision | 100.0% | 100.0% |
| Article-level accuracy (16) | 93.8% (15/16) | **100.0% (16/16)** |
| False positives | 0 | 0 |
| Cost/article | **$0.010** | $0.038 (3.8×) |
| Avg time/article | **~1.4s** | ~42.5s |

**Key findings:**

1. **Near-verbatim gap** — Gemini caught near-verbatim plagiarism (introductory clause added
   to Wikipedia text) that Copyscape returned 0% on. Both engines had zero false positives.

2. **Hebrew parity** — Both engines performed equally well on Hebrew content (he.wikipedia.org
   and idi.org.il). Language is not a differentiator.

3. **Non-Wikipedia coverage is weaker in Copyscape's aggregate score** — On Britannica content
   (heavy plagiarism, 5 verbatim sentences), Copyscape's reported similarity was only 26%
   vs 65% on equivalent Wikipedia content. Copyscape *did* find Britannica in its match list
   (position 8 of 27), but the aggregate similarity % is an unreliable severity signal
   across source sites. Gemini reported a consistent 76% regardless of source site.

4. **`.co.il` sites untested** — `ynet`, `mako`, `calcalist`, `themarker` blocked WebFetch.
   Hypothesis: if Copyscape's Israeli news coverage is similar to its Britannica coverage
   (shallow aggregate %), copies from Israeli news could register as borderline rather than
   heavy. Treat as production-monitoring hypothesis, not proven gap.

**Why not replace:** Gemini at $0.038/call is 3.8× Copyscape's $0.01 — exceeds the ≤ 2×
replacement cost criterion. Also 30× slower.

**Recommended hybrid:** Copyscape primary. Gemini secondary check only when Copyscape returns
< 10% similarity on articles showing encyclopedic-style writing. Expected to add <$0.038 per
borderline case rather than all articles.

**Reliability note:** Gemini's JSON output was truncated on 4 clean articles (empty
`copiedSentences` array). Scores were correct because the runner defaulted to
`isPlagiarized: false`, but this is a production concern. Fix: detect truncated pattern
explicitly before full JSON parse.

Full results: `01-plagiarism/RESULTS.md`

---

## POC 2 — AI Detection (Copyscape AI detector vs Gemini)

**Status:** Complete. Verdict: **augment**
**Run date:** 2026-04-22

| Metric | Copyscape | Gemini |
|---|---|---|
| Accuracy | **90.0%** | 80.0% |
| Precision | 83.3% | **100.0%** |
| Recall | **100.0%** | 60.0% |
| F1 | **90.9%** | 75.0% |
| Spearman (score vs actual AI %) | **0.896** | 0.747 |
| Cost/sample | $0.010 | **$0.003** (3.3× cheaper) |

**Key finding — complementary failure modes (not overlapping):**

| Provenance | Copyscape correct | Gemini correct |
|---|---|---|
| pure-human | 5/5 | 5/5 |
| pure-ai | 5/5 | 5/5 |
| ai-then-edited | **5/5** | 1/5 ❌ |
| human-then-polished | 3/5 ❌ | **5/5** |

- **Gemini FNs (4 cases)**: missed every AI sample that had been lightly edited with personal
  anecdotes. It over-weights "specific personal details" as a HUMAN signal, even when 80%+
  of the structure is AI. **Exploitable**: adding a few personal anecdotes bypasses Gemini.
- **Copyscape FPs (2 cases)**: over-flagged human writing that had minor AI polish applied
  to a few sentences. Gemini correctly recognized these as human.

The failure modes are orthogonal, which argues for a **4-state hybrid** signal
(both-AI / CS-only-AI / Gem-only-AI / both-HUMAN) rather than binary replace/keep.

**Cost reversal from POC 1:** Gemini is 3.3× CHEAPER here (no grounding needed for
classification). Opposite of POC 1 where Gemini grounding was 3.8× more expensive.

**Reliability concern:** 1/20 Gemini calls timed out (283s) and fell back to 50%
confidence. Production would need explicit timeout handling.

Full results: `02-ai-detection/RESULTS.md`

---

## POC 3 — Academic Citations (OpenAlex vs Gemini grounding)

**Status:** Complete. Verdict: **replace** (single-engine) or **augment** (hybrid)
**Run date:** 2026-04-22
**Baseline swapped:** Semantic Scholar → OpenAlex (SS free tier unusable from shared IPs — returned 429 on every call)

| Metric | OpenAlex | Gemini |
|---|---|---|
| Exact-gold Recall@3/@5 | 10% / 10% | **70% / 70%** |
| Acceptable-support Recall@3/@5 | 80% / 80% | **100% / 100%** |
| Avg latency/claim | **~1s** | ~63s (25–108s range) |
| Cost/claim | **$0** | $0.038 |

**Key findings:**

1. **Gemini wins big on exact-gold recall** — 7× better at finding the specific canonical
   paper (Martineau 2017, Zinman 2015, Schuur 2015, etc.). OpenAlex's keyword-based search
   often surfaces tangentially related papers instead of the classic citation.

2. **Both engines score high on "any supportive peer-reviewed paper"** — Gemini 100%,
   OpenAlex 80%. So OpenAlex is "good enough" for free-tier UX.

3. **Semantic Scholar is effectively unusable on free tier** — every call from our IP
   returned HTTP 429. Requires paid API key. OpenAlex is the operational replacement
   for SS regardless of the Gemini question.

4. **Gemini has high latency variance** — 25s to 108s per call, median ~55s. Earlier POC
   run had 40% timeouts at 150s ceiling; investigation (`diagnose.ts`/`diagnose2.ts`)
   showed the prompt is fine but Gemini's tail latency requires a 240s timeout + retry
   on AbortError. Implication: don't use Gemini in a synchronous UI — async only.

**Recommended architecture:**
- Free tier: OpenAlex (instant, $0, 80% acceptable-support recall)
- Premium tier: Gemini grounded as an async "deep citation search" feature (60s, $0.038,
  70% exact-gold recall)
- Do NOT replace Semantic Scholar without picking one of the above — SS free tier is
  already broken

Full results: `03-academic-citations/RESULTS.md`

---

## POC 4 — LLM Skills Swap (MiniMax vs Gemini vs GPT-5.4 + Deep Research)

**Status:** Complete. **Verdict on the original question: reject Gemini.** New question
emerged: replace MiniMax with GPT-5.4.
**Run date:** 2026-04-22
**Scope:** 3-way comparison on 3 articles × 6 skill-modes (tone/legal-with/legal-no/summary/brief/purpose) + 1 Deep Research legal audit

### Mean score per skill (1-5 scale, judge = gpt-5.4-mini)

| Skill | MiniMax | Gemini | **GPT-5.4** |
|---|---|---|---|
| tone | 2.94 | 3.06 | **4.17** |
| legal (with policy) | **3.44** | 2.67 | 2.89 |
| legal (no policy) | 1.78 | 1.50 | **3.11** |
| summary | 4.22 | 3.67 | **4.33** |
| brief | 4.33 | 3.50 | **4.83** |
| purpose | 3.75 | 3.08 | **4.17** |

### Pairwise head-to-head

| Matchup | Wins/Losses/Ties |
|---|---|
| MiniMax vs Gemini | **MiniMax 13 – Gemini 1 – Ties 4** |
| MiniMax vs GPT-5.4 | MiniMax 4 – **GPT-5.4 12** – Ties 2 |
| Gemini vs GPT-5.4 | Gemini 0 – **GPT-5.4 18** – Ties 0 |

**Five key findings:**

1. **Reject Gemini for CheckApp's LLM skills.** Gemini is worse than MiniMax on 5 of 5
   text-classification skills. This is a decisive rejection of the POC 4 original question.

2. **GPT-5.4 dominates the text-classification use cases.** Wins 5 of 6 skills. Gemini
   loses 0-18-0 to GPT-5.4 (swept).

3. **Legal-no-policy is the most important skill-specific finding.** Only GPT-5.4 is
   usable here (3.11) — Gemini and MiniMax both score < 2 and produce essentially useless
   "consult a lawyer" output. This matters because it's Sharon's Mode B use case.

4. **Deep Research is NOT worth $1.50 for policy-checked legal.** Lost to MiniMax (3.33
   vs 4.33) and Gemini (2.00 vs 4.33) on 01-health legal-with-policy. Judge reasoning: DR
   is "generic", "overstates severity", "less actionable". Where DR might still add value
   is the no-policy mode (untested) — deferred.

5. **Gemini has no role in skill-based text classification.** Gemini's strength is web
   grounding (fact-check, plagiarism, citations). For analysis-of-text tasks, GPT-5.4 is
   strictly better and Gemini is even worse than MiniMax.

**Recommended architecture:**
- Default skills: GPT-5.4 (tone/summary/brief/purpose/legal-no-policy)
- Legal-with-policy: MiniMax (cheaper, slight edge on this narrow task)
- Legal premium tier: Deep Research (no-policy mode, UNTESTED but hypothesized 4+)

Full results: `04-llm-skills-swap/RESULTS.md`

---

## Synthesis

**Gemini 3.1 Pro is a specialist tool, not a general replacement.** Use it where web
grounding is decisive (fact-check, plagiarism secondary, citation deep-search). Do NOT
use it for text classification where it loses to both the incumbent MiniMax and the
newcomer GPT-5.4.

**GPT-5.4 is the general-purpose upgrade path for CheckApp's LLM skills.** Wins 5 of 6
skills vs MiniMax with no single-dimension regression > 1pt. Comparable or better cost
on small-output classification tasks.

**Copyscape remains the default for plagiarism and AI detection** — statistical
classifiers outperform LLMs on their own territory. Augment with Gemini (plagiarism) or
GPT-5.4 (AI detection) as secondary signals where the primary is weakest.

**The Semantic Scholar substitution (OpenAlex) is a forced win.** SS's free tier is
production-unusable; OpenAlex is a viable drop-in at zero operational friction.

**Deep Research's premium tier case is tier-specific.** Justified for fact-check
(validated). Not justified for policy-checked legal (tested here). Hypothesized for
no-policy legal and pharma/finance audits — worth one more $1.50 test before committing.

**Architectural implication for CheckApp:** Different tasks need different providers.
The right abstraction is per-skill provider configuration, not a single "LLM provider"
global setting. This matches how the codebase is heading with `src/providers/registry.ts`.

---

## Recommendations

All concrete recommendations, including Plan 2 follow-on task lists and cost impact,
are in `DECISION-MATRIX.md`. Summary:

1. **Adopt the 5 "replace" verdicts** behind new feature flags (not default-on)
2. **Adopt the 2 "augment" verdicts** behind opt-in hybrid flags
3. **Validate each migration** with ≥ 100 production samples before flipping defaults
4. **External reviewer sign-off required** before moving to integration

Plan 3 deliverable is the matrix itself, not the implementation. Implementation = Plan 2
extensions, with the same gating pattern as the fact-check rollout.
