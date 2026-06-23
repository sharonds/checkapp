import type { SkillResult } from "../skills/types.ts";
import type { AuditCoverage, AuditLocation, AuditRecord, AuditRef, AuditSegment } from "./types.ts";
import { parseAuditRecord, safeParseAuditRecord, sanitizeAuditUrl } from "./types.ts";
import { emitAuditFailedEvent } from "../telemetry/audit-events.ts";

export interface AuditContribution {
  audit: AuditRecord;
}

export interface AuditResultWrapper {
  kind: "audit-result";
  result: SkillResult;
  audit?: AuditRecord;
}

export type SkillRunOutput = SkillResult | (SkillResult & { audit?: AuditRecord }) | AuditResultWrapper;

export interface NormalizedSkillRunOutput {
  result: SkillResult;
  audit?: AuditRecord;
}

export interface RegistryRunOutput {
  results: SkillResult[];
  audit?: AuditRecord;
}

export interface MergedAuditContributions {
  audit?: AuditRecord;
  refMap: Map<string, AuditRef>;
}

export function normalizeSkillRunOutput(output: SkillRunOutput): NormalizedSkillRunOutput {
  if (isResultWrapper(output)) {
    const audit = output.audit ? safeParseAuditRecord(output.audit) : undefined;
    return {
      result: output.result,
      audit: resolveSkillAudit(audit),
    };
  }
  const audit = "audit" in output && output.audit ? safeParseAuditRecord(output.audit) : undefined;
  if ("audit" in output) {
    const { audit: _audit, ...result } = output;
    return { result, audit: resolveSkillAudit(audit) };
  }
  return { result: output, audit: undefined };
}

// Surface (do not swallow) a skill that emits an invalid audit. The pipeline still
// produces a result with audit:undefined, but the parse failure is now logged loudly
// instead of vanishing silently before the merge.
function resolveSkillAudit(audit: ReturnType<typeof safeParseAuditRecord> | undefined): AuditRecord | undefined {
  if (!audit) return undefined;
  if (audit.ok) return audit.value;
  emitAuditFailedEvent({ stage: "merge-input", error: audit.error });
  console.error(`[audit] dropping invalid skill audit before merge: ${audit.error}`);
  return undefined;
}

export function mergeAuditContributions(audits: Array<AuditRecord | undefined>): AuditRecord | undefined {
  return mergeAuditContributionsWithRefs(audits).audit;
}

export function mergeAuditContributionsWithRefs(audits: Array<AuditRecord | undefined>): MergedAuditContributions {
  const valid = audits.filter((audit): audit is AuditRecord => !!audit).map(parseAuditRecord);
  const refMap = new Map<string, AuditRef>();
  if (valid.length === 0) return { refMap };
  const [first, ...rest] = valid;
  const mergedAuditId = first.auditId;
  const segments: AuditSegment[] = [];
  const segmentByLocation = new Map<string, AuditSegment>();
  const segmentRefMap = new Map<string, string>();

  const addSegment = (segment: AuditSegment, prefix: string): AuditSegment => {
    const key = segmentKey(segment);
    const existing = segmentByLocation.get(key);
    if (existing) return existing;
    const next: AuditSegment = {
      ...segment,
      id: `${prefix}${segment.id}`,
      sectionId: segment.sectionId ? `${prefix}${segment.sectionId}` : undefined,
    };
    segments.push(next);
    segmentByLocation.set(key, next);
    return next;
  };

  const normalized = valid.map((audit, index) => {
    const prefix = index === 0 ? "" : `a${index + 1}-`;
    for (const segment of audit.segments) {
      const mergedSegment = addSegment(segment, prefix);
      segmentRefMap.set(segmentRefKey(audit.auditId, segment.id), mergedSegment.id);
    }
    const mapLocation = (location?: AuditLocation): AuditLocation | undefined => {
      if (!location) return undefined;
      const matching = typeof location.startOffset === "number" && typeof location.endOffset === "number"
        ? [...segmentByLocation.values()].find((segment) =>
            segment.startOffset === location.startOffset && segment.endOffset === location.endOffset
          )
        : undefined;
      const fuzzyMatching = matching ?? (location.matchQuality === "fuzzy"
        ? [...segmentByLocation.values()].find((segment) =>
            segment.paragraphIndex === location.paragraphIndex
            && segment.sentenceIndex === location.sentenceIndex
            && (segment.sectionTitle === location.sectionTitle || segment.sectionId === location.sectionId)
          )
        : undefined);
      if (fuzzyMatching) {
        return {
          sectionId: fuzzyMatching.sectionId ?? "section-1",
          sectionTitle: fuzzyMatching.sectionTitle,
          paragraphIndex: fuzzyMatching.paragraphIndex,
          sentenceIndex: fuzzyMatching.sentenceIndex,
          startOffset: fuzzyMatching.startOffset,
          endOffset: fuzzyMatching.endOffset,
          matchQuality: location.matchQuality,
        };
      }
      return {
        ...location,
        sectionId: `${prefix}${location.sectionId}`,
      };
    };
    const claimId = (id: string) => `${prefix}${id}`;
    const assessmentId = (id: string) => `${prefix}${id}`;
    const plagiarismId = (id: string) => `${prefix}${id}`;
    const attemptId = (id: string) => `${prefix}${id}`;
    for (const claim of audit.claims) {
      refMap.set(refKey(audit.auditId, { claimId: claim.id }), { auditId: mergedAuditId, claimId: claimId(claim.id) });
    }
    for (const assessment of audit.factAssessments) {
      refMap.set(refKey(audit.auditId, { claimId: assessment.claimId, assessmentId: assessment.id }), {
        auditId: mergedAuditId,
        claimId: claimId(assessment.claimId),
        assessmentId: assessmentId(assessment.id),
      });
    }
    for (const finding of audit.plagiarismFindings) {
      refMap.set(refKey(audit.auditId, { plagiarismFindingId: finding.id }), {
        auditId: mergedAuditId,
        plagiarismFindingId: plagiarismId(finding.id),
      });
    }
    return {
      audit,
      coverage: audit.coverage,
      claims: audit.claims.map((claim) => ({ ...claim, id: claimId(claim.id), location: mapLocation(claim.location) })),
      claimDecisions: audit.claimDecisions.map((decision) => ({
        ...decision,
        claimId: claimId(decision.claimId),
        duplicateOfClaimId: decision.duplicateOfClaimId ? claimId(decision.duplicateOfClaimId) : undefined,
      })),
      factAssessments: audit.factAssessments.map((assessment) => ({
        ...assessment,
        id: assessmentId(assessment.id),
        claimId: claimId(assessment.claimId),
        attemptIds: assessment.attemptIds?.map(attemptId),
      })),
      plagiarismFindings: audit.plagiarismFindings.map((finding) => ({
        ...finding,
        id: plagiarismId(finding.id),
        passageIds: finding.passageIds?.map((id) => segmentRefMap.get(segmentRefKey(audit.auditId, id)) ?? `${prefix}${id}`),
        location: mapLocation(finding.location),
      })),
      providerAttempts: audit.providerAttempts.map((attempt) => ({ ...attempt, id: attemptId(attempt.id) })),
    };
  });

  const merged = normalized.slice(1).reduce((acc, item) => ({
    ...acc,
    coverage: mergeCoverage(acc.coverage, item.coverage),
    claims: [...acc.claims, ...item.claims],
    claimDecisions: [...acc.claimDecisions, ...item.claimDecisions],
    factAssessments: [...acc.factAssessments, ...item.factAssessments],
    plagiarismFindings: [...acc.plagiarismFindings, ...item.plagiarismFindings],
    providerAttempts: [...acc.providerAttempts, ...item.providerAttempts],
  }), {
    ...first,
    auditId: mergedAuditId,
    segments,
    coverage: normalized[0].coverage,
    claims: normalized[0].claims,
    claimDecisions: normalized[0].claimDecisions,
    factAssessments: normalized[0].factAssessments,
    plagiarismFindings: normalized[0].plagiarismFindings,
    providerAttempts: normalized[0].providerAttempts,
  });

  return { audit: merged, refMap };
}

function mergeCoverage(a: AuditCoverage, b: AuditCoverage): AuditCoverage {
  return {
    wordsScanned: Math.max(a.wordsScanned, b.wordsScanned),
    sectionsDetected: Math.max(a.sectionsDetected, b.sectionsDetected),
    paragraphsScanned: Math.max(a.paragraphsScanned, b.paragraphsScanned),
    sentencesScanned: Math.max(a.sentencesScanned, b.sentencesScanned),
    claimsExtracted: a.claimsExtracted + b.claimsExtracted,
    claimsChecked: a.claimsChecked + b.claimsChecked,
    claimsSkipped: a.claimsSkipped + b.claimsSkipped,
    skipReasons: mergeCounts(a.skipReasons, b.skipReasons),
    plagiarismPassagesChecked: a.plagiarismPassagesChecked + b.plagiarismPassagesChecked,
    plagiarismPassagesSkipped: a.plagiarismPassagesSkipped + b.plagiarismPassagesSkipped,
    providerFailures: a.providerFailures + b.providerFailures,
    providerRetries: a.providerRetries + b.providerRetries,
    budgetStopReason: a.budgetStopReason ?? b.budgetStopReason,
  };
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = (out[key] ?? 0) + value;
  return out;
}

function isResultWrapper(output: SkillRunOutput): output is AuditResultWrapper {
  return !!output && typeof output === "object" && (output as { kind?: unknown }).kind === "audit-result";
}

export function sanitizeSkillResult(result: SkillResult): SkillResult {
  return {
    ...result,
    findings: result.findings.map((finding) => ({
      ...finding,
      sources: finding.sources?.map((source) => {
        const url = sanitizeAuditUrl(source.url);
        return url ? { ...source, url } : undefined;
      }).filter((source): source is NonNullable<typeof source> => !!source),
    })),
  };
}

export function remapResultAuditRefs(results: SkillResult[], refMap: Map<string, AuditRef>, mergedAuditId?: string): SkillResult[] {
  if (!mergedAuditId) return results;
  return results.map((result) => ({
    ...result,
    findings: result.findings.map((finding) => {
      if (!finding.auditRef) return finding;
      const mapped = refMap.get(refKey(finding.auditRef.auditId, finding.auditRef));
      return mapped ? { ...finding, auditRef: mapped } : { ...finding, auditRef: { ...finding.auditRef, auditId: mergedAuditId } };
    }),
  }));
}

function refKey(auditId: string, ref: Pick<AuditRef, "claimId" | "assessmentId" | "plagiarismFindingId">): string {
  return [auditId, ref.claimId ?? "", ref.assessmentId ?? "", ref.plagiarismFindingId ?? ""].join(":");
}

function segmentKey(segment: AuditSegment): string {
  return [segment.startOffset ?? "", segment.endOffset ?? "", segment.text].join(":");
}

function segmentRefKey(auditId: string, segmentId: string): string {
  return `${auditId}:${segmentId}`;
}
