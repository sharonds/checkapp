# Annotation Guidelines — Per-POC Rubrics

**Purpose:** Define exactly what counts as "correct" for each POC *before* any corpus is
created or any engine is run. This prevents retroactive rubric-fitting and ensures that
a verdict like "Gemini achieves 85% accuracy" means the same thing across runs and reviewers.

**Rule:** No corpus item may be labelled after seeing engine output. All ground-truth labels
are authored before running. If a label turns out to be wrong after running (as happened in
the fact-check POC with 7 corrections), the correction process is: (1) identify the error,
(2) correct the ground truth, (3) re-score all engines against the corrected label, (4)
document the correction in the POC's RESULTS.md. Do NOT adjust only one engine's score.

---

## POC 1 — Plagiarism (Copyscape vs Gemini grounding)

### Corpus labelling — sentence level

Each test article is labelled at the **sentence level** before running any engine.
Article-level labels are derived from sentence labels — not authored independently.

Per sentence:

```typescript
interface SentenceLabel {
  sentence: string;
  status: "verbatim" | "near-verbatim" | "paraphrased" | "original";
  sourceUrl?: string;   // required for non-original sentences
  overlapStart?: number; // character offset in source, if tracked
  overlapEnd?: number;
}
```

Status definitions:
- **verbatim** — sentence copied word-for-word (≥ 5 consecutive words unchanged)
- **near-verbatim** — sentence copied with only trivial changes (swap 1–2 words, change
  punctuation, reorder clauses but keep all content words)
- **paraphrased** — ideas from source expressed in substantially different wording (not
  technically plagiarism by most definitions, but sourced from a specific text)
- **original** — no identifiable source; written fresh for the test article

Article-level severity is derived as:
- **heavy** — > 40% of sentences are verbatim or near-verbatim
- **light** — 1–3 sentences are verbatim or near-verbatim
- **none** — zero verbatim/near-verbatim sentences

### Engine scoring — sentence level (primary metric)

Given an engine's output, compute:

1. **Sentence-level precision** — of sentences the engine flagged as plagiarised, what
   fraction actually are (status = verbatim or near-verbatim)?
2. **Sentence-level recall** — of sentences that ARE verbatim/near-verbatim, what fraction
   did the engine flag?
3. **Source-URL match rate** — for each sentence the engine flagged AND correctly identified
   as plagiarised, did it return the correct `sourceUrl`? Compute as hits / flagged-positives.

### Engine scoring — article level (secondary metric)

4. **Binary precision/recall** — was the article-level plagiarised/clean call correct?
5. **Severity match** — did the engine's severity (heavy/light/none) match the derived
   article-level severity?

### Handling engines without sentence-level output

If an engine returns only matched-span or article-level output (e.g. Copyscape returns a
percentage match without per-sentence attribution), compute sentence-level scores by:
- Treating all sentences in a matched span as "flagged"
- Treating all sentences outside matched spans as "not flagged"
- If no span data is available, the engine's sentence-level scores default to its
  article-level verdict applied uniformly to all sentences.

### Acceptance criterion

Write a verdict in `01-plagiarism/RESULTS.md`:
- **replace** Copyscape if Gemini grounding achieves ≥ 85% sentence-level accuracy at
  ≤ 2× Copyscape cost per article ($0.01 × 2 = $0.02/article)
- **keep** Copyscape if accuracy gap > 15 pp OR cost > 3× Copyscape
- **augment** if Gemini catches things Copyscape misses (complementary failure modes)
- **reject-as-unsuitable** if Gemini produces output too inconsistent to be actionable

---

## POC 2 — AI Detection (Copyscape AI detector vs Gemini)

### Corpus labelling — binary with provenance

Each sample is labelled **AI** or **HUMAN** before running any engine.

Labelling rule:

> A sample is **AI** if and only if AI-generated words contribute ≥ 50% of the final word count.

Provenance types and their labels:
- `pure-ai` — LLM wrote 100% → **AI**
- `pure-human` — human wrote 100% → **HUMAN**
- `ai-then-edited` — LLM wrote base, human modified < 25% of words → **AI**
- `human-then-polished` — human wrote base, LLM modified < 25% of words → **HUMAN**

Per-sample ground truth stored as:

```typescript
interface AIDetectionLabel {
  id: string;
  label: "AI" | "HUMAN";
  aiWordPercentage: number;   // 0–100, tracked during corpus construction
  provenance: "pure-ai" | "pure-human" | "ai-then-edited" | "human-then-polished";
}
```

Word provenance must be tracked at construction time. Do NOT estimate after the fact.

### Engine scoring

For classification accuracy:
1. **Binary threshold** — engine probability > 50% → predicted AI; ≤ 50% → predicted HUMAN
2. **Confusion matrix** — TP/FP/TN/FN, precision, recall, F1 (positive class = AI)
3. **Accuracy by provenance type** — did the engine fail systematically on a sub-population?
   (e.g., misses `human-then-polished` as HUMAN → over-flags as AI)

For calibration:
4. **Spearman correlation** — between engine's probability score (0–100) and actual
   `aiWordPercentage`. A well-calibrated engine should have positive correlation.
   Use `lib/scoring.ts` → `spearman()`.

### Framing

This is a "prove unsuitable" experiment. LLMs are not trained to detect LLM output;
statistical classifiers use perplexity and burstiness features that general LLMs don't
have direct access to. We expect Gemini to underperform.

The question is whether Gemini's output is useful as a *secondary signal*, even if it
can't replace the primary classifier.

### 4-way verdict

- **replace** — Gemini ≥ 90% accuracy AND ≥ Copyscape baseline (very unlikely)
- **augment** — Gemini 70–89% AND flags different sub-populations than Copyscape
- **keep** — Gemini < 70% but not systematically wrong on a specific sub-population
- **reject-as-unsuitable** — Gemini systematically over-flags human content as AI, would
  mislead users

Document verdict reasoning with specific failure examples in `02-ai-detection/RESULTS.md`.

---

## POC 3 — Academic Citations (Semantic Scholar vs Gemini grounding)

### Corpus labelling — two metrics, not one

Each test case has:
1. One or more **gold citations** — papers we pre-identified as genuinely supporting the claim
2. A **manual reviewability flag** — after running engines, a human reviews each returned
   paper and marks `supportive: true | false` for the acceptable-support metric

Ground truth per claim:

```typescript
interface CitationGroundTruth {
  claim: string;
  claimType: "medical" | "scientific" | "financial";
  goldCitations: Array<{
    title: string;
    authors: string;
    year: number;
    doi?: string;
    url?: string;
  }>;
}
```

Gold citations are identified *before* running any engine, using Google Scholar / PubMed /
SSRN for manual verification. Do NOT adjust gold citations after seeing engine output.

### Engine scoring — two independent metrics

**Metric 1: Exact-gold Recall@k**
- Did the engine return the specific pre-identified gold paper in its top k results?
- Match rule: DOI match (preferred) OR title similarity > 0.85 (fuzzy title match) OR
  (same first-author surname AND same year AND same journal)
- Compute Recall@3 and Recall@5.

**Metric 2: Acceptable-support Recall@k**
- Did the engine return ANY peer-reviewed paper that a human reviewer would accept as
  genuinely supporting the claim at ≥ "medium" relevance?
- Reviewer judgment: after running both engines, review each returned paper blind (hide
  which engine returned it) and mark `supportive: true | false`.
- "Peer-reviewed" means published in a journal with DOI, or in a conference proceedings.
  Preprints (arXiv without peer review) are acceptable only if no peer-reviewed version exists.
- Relevance threshold for `supportive: true`: the paper must directly address the claim's
  specific mechanism or finding, not just the general topic area.
- Compute Recall@3 and Recall@5.

**Why two metrics:** An engine that finds a different-but-valid paper isn't failing. The
exact-gold metric penalises legitimate alternate-citation behaviour. The acceptable-support
metric captures whether the product can actually use the returned citation.

### Result limit parity

Set `ssSearch(query, 5)` for Semantic Scholar and request 5 results from Gemini grounding.
Both engines must have the same maximum result count so Recall@k is comparable.

### Verdict

- **replace** — Gemini achieves equivalent or better recall (both metrics) at lower cost
- **keep** — Semantic Scholar's structured citation graph provides better exact-gold recall
- **augment** — complementary: one finds what the other misses; merge results

---

## POC 4 — LLM Skills Swap (MiniMax-M2.7 vs Gemini 3.1 Pro)

### Per-skill rubrics

Do NOT use a single generic rubric across skills. Each skill measures different things.
Score each dimension 1–5.

#### Tone (tone-of-voice analysis)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Specificity** | Generic observations, no article quotes | Some quotes but mostly generic | Quotes specific sentences/phrases from article |
| **Voice-guide alignment** | Ignores the brand voice guide | References the guide but loosely | Directly maps article language to guide dimensions |
| **Rewrite quality** | No rewrite suggestions OR suggestions don't match the voice | Partial rewrite, inconsistent voice | Concrete, in-voice rewrite suggestions for flagged sections |

#### Legal (legal/compliance risk analysis)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Risk specificity** | Generic "consult a lawyer" | Names a legal domain but not a specific risk | Names the specific law/regulation/compliance clause at risk |
| **Severity calibration** | Flags minor style issues as high-risk or misses real risks | Approximate severity | Severity matches the actual legal exposure (low/medium/high justified) |
| **Actionability** | No remediation path | Vague "remove or revise" | Specific remediation: which clause to add, which phrase to remove |

#### Summary (article summarisation)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Topic accuracy** | Summary covers a different topic than the article | Covers main topic, misses key nuance | Accurately captures topic AND the article's specific angle |
| **Argument capture** | Omits the article's central argument or thesis | Captures argument partially | Captures the main argument and 2+ supporting sub-arguments |
| **Audience identification** | No audience identified OR wrong audience | Approximate audience | Correctly identifies the likely target audience with evidence from article |

#### Brief (content brief review)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Brief-requirement coverage** | Reviews article against generic criteria, not the brief | Covers some brief requirements | Checks every explicit requirement listed in the brief |
| **Miss detection** | Misses requirements the article doesn't address | Catches some gaps | Identifies all requirements missing from the article |
| **Alignment score** | No overall alignment assessment | Binary pass/fail only | Scored alignment (e.g. 7/10 requirements met) with per-requirement breakdown |

#### Purpose (article-type and purpose analysis)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Article-type match** | Wrong classification OR no classification | Correct broad type (e.g. "informational") | Correct specific type (e.g. "comparison article targeting BoFu buyers") |
| **Purpose-specific recommendations** | Generic SEO/writing advice | Some type-specific recommendations | Recommendations tailored to the identified article type and purpose |

### LLM judge setup

To avoid Gemini-judges-Gemini bias, the judge model is selected by this priority:
1. Claude Haiku 4.5 (`ANTHROPIC_API_KEY` set) — independent from both MiniMax and Gemini
2. GPT-4o-mini (`OPENAI_API_KEY` set) — also independent
3. Gemini 3.1 Pro (last resort) — run TWO judge passes with different system prompts;
   report cross-pass disagreement rate as a bias indicator (must be < 20%)

Randomise A/B assignment per output pair so the judge cannot learn positional bias.

Construct a **separate judge prompt per skill** that includes the relevant context
(article + voice guide for Tone; article + legal policy for Legal; etc.).

### Human validation

Manually review 10 output pairs: 2 per skill × 5 skills. Assign your own scores blind
(hide which provider produced which). If human scores disagree with the LLM judge on
> 30% of pairs, treat the LLM judge as unreliable and base the decision on human review.

### Acceptance criterion

**Replace** MiniMax with Gemini as default LLM for these skills if:
- Gemini mean score ≥ MiniMax mean score on **≥ 4 of 5 skills** (tone/legal/summary/brief/purpose), AND
- **No single skill** shows a > 1.0-point regression on any dimension

If the judge is Gemini-based (last resort): cross-judge disagreement rate must be < 20%.

---

## Cross-POC Principles

1. **Ground truth before running.** Labels are set before any engine sees the data.
2. **Sentence/sample/claim level first.** Article/document level is secondary.
3. **4-way verdict, not binary.** `keep | augment | replace | reject-as-unsuitable`.
4. **Correction process.** If a label turns out wrong, correct it, re-score all engines,
   document the correction. Never adjust one engine's score in isolation.
5. **Cost tracking.** Each POC records per-call cost constants in `corpus.ts` before running.
   Acceptance criteria use these constants to produce concrete dollar thresholds.
