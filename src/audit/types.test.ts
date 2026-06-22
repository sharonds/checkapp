import { describe, expect, test } from "bun:test";
import {
  isAuditRecord,
  parseAuditRecord,
  parseStoredAuditRecord,
  safeParseAuditRecord,
  sanitizeAuditUrl,
  sanitizeProviderError,
  serializeAuditRecord,
} from "./types.ts";

const baseAudit = {
  version: 1,
  auditId: "audit-1",
  language: "he",
  direction: "rtl",
  coverage: {
    wordsScanned: 120,
    sectionsDetected: 2,
    paragraphsScanned: 4,
    sentencesScanned: 8,
    claimsExtracted: 3,
    claimsChecked: 2,
    claimsSkipped: 1,
    skipReasons: { tier_cap: 1 },
    plagiarismPassagesChecked: 1,
    plagiarismPassagesSkipped: 0,
    providerFailures: 0,
    providerRetries: 0,
  },
  segments: [],
  claims: [],
  claimDecisions: [],
  factAssessments: [],
  plagiarismFindings: [],
  providerAttempts: [],
  createdAt: "2026-06-09T00:00:00.000Z",
};

describe("AuditRecord schema", () => {
  test("accepts a versioned audit record", () => {
    expect(isAuditRecord(baseAudit)).toBe(true);
    expect(parseAuditRecord(baseAudit).version).toBe(1);
  });

  test("rejects unversioned and future-version records as trusted audit records", () => {
    expect(safeParseAuditRecord({ ...baseAudit, version: undefined }).ok).toBe(false);
    expect(safeParseAuditRecord({ ...baseAudit, version: 2 }).ok).toBe(false);
  });

  test("strips unknown top-level fields from additive v1 records", () => {
    const parsed = safeParseAuditRecord({ ...baseAudit, futureOptionalField: { enabled: true } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect("futureOptionalField" in parsed.value).toBe(false);
    }
  });

  test("parseStoredAuditRecord tolerates additive fields but ignores unsupported future versions", () => {
    const withAdditiveField = JSON.stringify({ ...baseAudit, futureOptionalField: "kept by future versions" });
    expect(parseStoredAuditRecord(withAdditiveField)?.auditId).toBe("audit-1");
    expect(parseStoredAuditRecord(JSON.stringify({ ...baseAudit, version: 2 }))).toBeUndefined();
  });

  test("rejects malformed nested audit records", () => {
    expect(safeParseAuditRecord({ ...baseAudit, claims: [{ id: "c1", quote: 42 }] }).ok).toBe(false);
    expect(safeParseAuditRecord({ ...baseAudit, providerAttempts: [{ id: "p1", provider: "fake", status: "boom" }] }).ok).toBe(false);
  });

  test("normalizes skipped claim decisions without skipReason to unknown", () => {
    const parsed = parseAuditRecord({
      ...baseAudit,
      claimDecisions: [{ claimId: "c1", decision: "skipped" }],
    });
    expect(parsed.claimDecisions).toEqual([{ claimId: "c1", decision: "skipped", skipReason: "unknown" }]);
  });

  test("serializeAuditRecord returns a discriminated result instead of silently nulling failures", () => {
    const malformedAudit = { ...baseAudit, claims: [{ id: "c1", quote: 42 }] } as any;
    // A present-but-invalid audit must surface an error, never a bare null.
    expect(() => serializeAuditRecord(malformedAudit)).not.toThrow();
    const malformed = serializeAuditRecord(malformedAudit);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(typeof malformed.error).toBe("string");
      expect(malformed.error.length).toBeGreaterThan(0);
    }
    // A null/undefined input is not an error — there is simply nothing to store.
    expect(serializeAuditRecord(null)).toEqual({ ok: true, json: null });
    expect(serializeAuditRecord(undefined)).toEqual({ ok: true, json: null });
    // A valid audit serializes to a JSON string.
    const valid = serializeAuditRecord(baseAudit as any);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(typeof valid.json).toBe("string");
    }
  });

  test("sanitizes nested provider errors and drops unsafe source URLs before persistence", () => {
    const parsed = parseAuditRecord({
      ...baseAudit,
      factAssessments: [
        {
          id: "a1",
          claimId: "c1",
          status: "unsupported",
          sources: [
            { url: "javascript:alert(1)", title: "bad" },
            { url: "https://example.com/source", title: "ok" },
          ],
        },
      ],
      plagiarismFindings: [
        {
          id: "plag-1",
          quote: "copied text",
          status: "plagiarism_match",
          source: { url: "https://source.example/page" },
        },
      ],
      providerAttempts: [
        {
          id: "p1",
          provider: "gemini",
          status: "failed",
          errorMessage: "Bearer sk-live-secret failed token=abc123",
        },
      ],
    });
    expect(parsed.factAssessments[0].sources).toEqual([{ url: "https://example.com/source", title: "ok", accepted: true }]);
    expect(parsed.providerAttempts[0].errorMessage).not.toContain("sk-live-secret");
    expect(parsed.providerAttempts[0].errorMessage).not.toContain("abc123");
  });

  test("preserves plagiarism grounding mode", () => {
    const parsed = parseAuditRecord({
      ...baseAudit,
      plagiarismFindings: [
        {
          id: "plag-1",
          quote: "copied text",
          status: "plagiarism_match",
          source: { url: "https://source.example/page" },
          matchType: "semantic",
          groundingMode: "ungrounded",
        },
      ],
    });
    expect(parsed.plagiarismFindings[0].matchType).toBe("semantic");
    expect(parsed.plagiarismFindings[0].groundingMode).toBe("ungrounded");
  });

  test("preserves location match quality for exact and fuzzy locations", () => {
    const parsed = parseAuditRecord({
      ...baseAudit,
      claims: [
        {
          id: "claim-1",
          quote: "A quoted claim.",
          normalizedClaim: "A quoted claim.",
          type: "general",
          location: {
            sectionId: "section-1",
            paragraphIndex: 0,
            sentenceIndex: 0,
            startOffset: 12,
            endOffset: 27,
            matchQuality: "exact",
          },
        },
      ],
      plagiarismFindings: [
        {
          id: "plag-1",
          quote: "A paraphrased claim.",
          status: "plagiarism_match",
          source: { url: "https://source.example/page" },
          location: {
            sectionId: "section-2",
            paragraphIndex: 1,
            sentenceIndex: 0,
            matchQuality: "fuzzy",
          },
        },
      ],
    });
    expect(parsed.claims[0].location?.matchQuality).toBe("exact");
    expect(parsed.plagiarismFindings[0].location?.matchQuality).toBe("fuzzy");
  });
});

describe("audit sanitizers", () => {
  test("rejects unsafe source URLs", () => {
    expect(sanitizeAuditUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeAuditUrl("https://example.com/a?utm_source=x")).toBe("https://example.com/a?utm_source=x");
    expect(sanitizeAuditUrl("https://user:secret@example.com/a?api_key=abc&utm_source=x")).toBe("https://example.com/a?api_key=%5Bredacted%5D&utm_source=x");
    expect(sanitizeAuditUrl("https://example.com/a#access_token=frag-secret")).toBe("https://example.com/a#access_token=%5Bredacted%5D");
  });

  test("redacts provider errors before persistence", () => {
    const sanitized = sanitizeProviderError("Bearer sk-live-secret-123 failed with api_key=abc123");
    expect(sanitized).not.toContain("sk-live-secret-123");
    expect(sanitized).not.toContain("abc123");
    expect(sanitized).toContain("[redacted]");
  });

  test("sanitizes bare Gemini keys in provider errors", () => {
    expect(sanitizeProviderError("boom AIzaSyB1234567890abcdefghij")).not.toContain("AIzaSy");
  });
}
);
