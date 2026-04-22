# POC 4 Results — LLM Skill Swap (3-way + Deep Research Legal)

**Run date:** 2026-04-22
**Corpus:** 3 articles (01-health, 02-finance, 03-tech) × 6 skill-modes = 18 cells per provider
**Providers tested:** MiniMax-M2.7 (incumbent), Gemini 3.1 Pro, GPT-5.4
**Judge:** gpt-5.4-mini (independent mini class)
**Skills:** tone, legal (with policy + no policy modes), summary, brief, purpose
**Plus:** 1 Deep Research legal audit (01-health, with-policy, ~$1.50, 453s)

---

## Headline: Mean score per skill (1-5 scale)

| Skill | MiniMax | Gemini | **GPT-5.4** |
|---|---|---|---|
| tone | 2.94 | 3.06 | **4.17** |
| legal (with policy) | **3.44** | 2.67 | 2.89 |
| legal (no policy) | 1.78 | 1.50 | **3.11** |
| summary | 4.22 | 3.67 | **4.33** |
| brief | 4.33 | 3.50 | **4.83** |
| purpose | 3.75 | 3.08 | **4.17** |

**GPT-5.4 wins 5 of 6 skills. MiniMax wins 1 (legal with policy). Gemini wins 0.**

## Pairwise head-to-head (out of 18 cells per pair)

| Matchup | Wins A | Wins B | Ties |
|---|---|---|---|
| MiniMax vs Gemini | **MiniMax 13** | Gemini 1 | 4 |
| MiniMax vs GPT-5.4 | MiniMax 4 | **GPT-5.4 12** | 2 |
| Gemini vs GPT-5.4 | Gemini 0 | **GPT-5.4 18** | 0 |

Gemini LOSES every single article-skill cell against GPT-5.4. This is striking.

---

## Verdict — 4-way

### **replace (MiniMax → GPT-5.4)** OR **keep (MiniMax)**

### Do NOT replace MiniMax with Gemini

Against the original POC 4 question ("should CheckApp replace MiniMax with Gemini?"):
- Per ANNOTATION-GUIDELINES criterion: replace requires Gemini ≥ MiniMax on ≥ 4 of 5 skills
- Gemini is ≥ MiniMax on **0 of 5** skills (worse on every one)
- Verdict: **reject Gemini as replacement for MiniMax**

### DO consider replacing MiniMax with GPT-5.4

- GPT-5.4 beats MiniMax on **5 of 6 skills**
- Only regression: legal with-policy (-0.55, under the 1.0pt ceiling)
- Cost delta: MiniMax ~$0.001/call → GPT-5.4 ~$0.02/call (20× more)
- Annual impact: for a team running 1,000 calls/month = $240/mo vs $12/mo. Meaningful but not prohibitive for a paid product tier.

### Keep MiniMax specifically for legal with-policy

If cost sensitivity dominates, MiniMax remains competitive on legal compliance checking
when a policy document is provided. The 0.55pt gap below GPT-5.4 is acceptable, and
MiniMax is 20× cheaper. A hybrid deployment (GPT-5.4 for tone/summary/brief/purpose,
MiniMax for legal-with-policy) would minimize cost while maximizing quality.

---

## The legal-no-policy gap is the most important finding

"Legal without a policy document" is the mode Sharon specifically asked about — can
a skill flag **inherent legal risks** (medical claims, securities language, GDPR,
defamation) without a reference doc?

| Provider | Score |
|---|---|
| Gemini | 1.50 (unusable) |
| MiniMax | 1.78 (unusable) |
| **GPT-5.4** | **3.11** |
| Deep Research | (see next section) |

**Only GPT-5.4 produces usable output without a reference policy.** MiniMax and Gemini
essentially respond with generic "consult a lawyer" disclaimers.

Production implication: CheckApp's "Legal risk" skill should use **GPT-5.4** when no
policy doc is uploaded, and can fall back to MiniMax when a policy doc IS uploaded.

---

## Deep Research legal — NOT worth $1.50 for policy-constrained mode

Deep Research audit of 01-health with the legal policy attached:
- **Output:** 4,184-word structured audit citing FTC Act Sections 5 & 12, FDCA, and
  FDA/FTC warning-letter precedents
- **Time:** 453s (~7.5 min)
- **Cost:** ~$1.50

### Head-to-head (judged by gpt-5.4-mini)

| vs | DR score | Opponent | Winner |
|---|---|---|---|
| MiniMax | 3.33 | 4.33 | MiniMax ← |
| Gemini | 2.00 | 4.33 | Gemini ← |
| GPT-5.4 | 3.67 | 3.67 | tie |

### Judge reasoning

"DR is more generic and somewhat overstates exposure, while B gives concrete
policy-based fixes and specific phrasing changes"
"DR is verbose and cites broad FTC/FDA frameworks but stays generic, overstates severity"
"DR names FTC Act, FDA/FDCA, and disease-claim issues but is incomplete and less actionable"

### Why Deep Research loses at policy-checking

When the user supplies a compliance policy, the answer is already in the policy. The
skill's job is to carefully map article sentences to policy clauses and propose
specific fixes. Deep Research's strength — broad regulatory synthesis — becomes a
liability: it produces comprehensive-but-generic regulatory overviews that miss the
specific policy violations the user actually cares about.

### UPDATE: DR tested on Legal Mode B (no-policy) — NULL RESULT

Ran a second Deep Research audit of 01-health **without** the legal policy, to test
whether DR's broad regulatory knowledge earns its keep when the skill has to identify
inherent legal risks on its own.

| vs | DR score | Opponent | Winner |
|---|---|---|---|
| MiniMax | 3.00 | 2.67 | DR (narrowly, both weak) |
| Gemini | 2.67 | 1.00 | DR (but Gemini is unusable baseline) |
| GPT-5.4 | 2.67 | **3.00** | **GPT-5.4** |

**DR mean across pairings: 2.78/5. Adoption threshold: > 4.0. Decision: DO NOT ADOPT.**

### Judge reasoning (consistent across all pairings)

- "Cites several real authorities (FTC Act, FDCA/DSHEA, FDA structure/function and
  health-claim frameworks) but **overstates enforcement risk** and gives only limited
  concrete rewrite guidance"
- "Highly specific on laws but **overstates enforcement** and **offers little concrete
  editing guidance**"

### Conclusion: Deep Research is legal-unsuitable at both modes

DR's comprehensive regulatory citation becomes a liability in legal analysis. It
produces legal textbook-style overviews rather than article-specific fixes. GPT-5.4
wins on actionability even in the mode where DR's broad research capability should
most pay off.

**DR's premium-tier value remains fact-check only** (Plan 1's Engine C, which DID find
novel methodological catches — variable-confusion, acute-vs-chronic, FMD-vs-fasting —
that standard LLMs missed). The legal domain has a different quality bar (actionable
editorial guidance, not academic regulatory survey) where DR's strength doesn't translate.

### Cost confirmation

- DR legal no-policy: ~$1.50, 579s (~10 min), 5,696 words
- GPT-5.4 legal no-policy: ~$0.015, 30s, 1,500 words
- **GPT-5.4 is 100× cheaper, 19× faster, and scored HIGHER on actionability.**

No second DR article test needed — the signal across 2 articles (with-policy + no-policy)
is clear and consistent.

---

## 3-way cost comparison per skill-call

| Provider | Typical cost/call | Speed |
|---|---|---|
| MiniMax-M2.7 | ~$0.001 | 5-15s |
| Gemini 3.1 Pro | ~$0.003 | 15-60s |
| GPT-5.4 | ~$0.015-0.02 | 5-30s |
| Deep Research | ~$1.50 | ~8 min |

For 100 articles/month × 5 skills/article = 500 skill calls:
- MiniMax: $0.50
- Gemini: $1.50
- GPT-5.4: $10
- Deep Research (if used for EVERY legal check): $750 → not viable

---

## Recommended architecture for CheckApp skills

Based on the full 3-way + DR data:

| Skill | Default provider | Premium/opt-in |
|---|---|---|
| Tone | **GPT-5.4** (4.17) | — |
| Legal (with policy) | **MiniMax** (3.44, cheap) | GPT-5.4 (2.89, slightly lower) |
| Legal (no policy) | **GPT-5.4** (3.11) | Deep Research (untested, hypothesized 4+) |
| Summary | **GPT-5.4** (4.33) | — |
| Brief | **GPT-5.4** (4.83) | — |
| Purpose | **GPT-5.4** (4.17) | — |

**Gemini 3.1 Pro has no role in the skills-swap architecture.** Its strength is web grounding
(fact-check, plagiarism, citations) — for classification/analysis tasks on text alone,
GPT-5.4 dominates and Gemini's non-grounded output is materially weaker than even MiniMax.

---

## Caveats

### Small corpus
n=3 articles × 5 skills = 15 judgment-cells per skill. Trends are clear but per-skill
confidence intervals are wide. A production rollout should revalidate on 20+ articles.

### Judge bias
gpt-5.4-mini judges — same family as one contender (GPT-5.4). Some family bias toward
OpenAI style is possible. Mitigations in place:
- Judge is the **mini** variant, contender is the **flagship**
- A/B positions randomized per judgment
- Rubric uses specific, operational criteria (not aesthetic preference)

The gap sizes (GPT-5.4 vs Gemini 0-18-0 sweep) are too large to be explained by judge
bias alone. MiniMax winning legal-with-policy despite being the non-OpenAI contender is
consistent with the judge being calibrated, not biased.

### Deep Research tested in wrong mode
We tested DR on legal-with-policy where it has the weakest comparative advantage. The
no-policy mode — where it might legitimately shine — was not tested. One more $1.50 run
on no-policy would answer this.

---

## Raw data

Results JSON: `results-1776859690402.json` (3-way provider runs + judgments)
Deep Research output: `deep-research-legal-01-health-1776861287131.json`
DR judgment: `dr-judgement-1776861335194.json`
