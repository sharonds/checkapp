import { describe, expect, test } from "bun:test";
import {
  classifyProviderError,
  normalizeEvidenceAssessment,
  normalizeProviderAttempt,
} from "./provider-contract.ts";

describe("provider contract", () => {
  test("classifies retryable and fatal provider errors", () => {
    expect(classifyProviderError({ statusCode: 429 }).retryable).toBe(true);
    expect(classifyProviderError({ statusCode: 503 }).retryable).toBe(true);
    expect(classifyProviderError({ statusCode: 401 }).retryable).toBe(false);
  });

  test("downgrades supported assessment without accepted source URL", () => {
    const assessment = normalizeEvidenceAssessment({
      id: "a1",
      claimId: "c1",
      status: "supported",
      sources: [],
    });
    expect(assessment.status).toBe("unverified");
  });

  test("rejects unsafe source URLs", () => {
    const assessment = normalizeEvidenceAssessment({
      id: "a1",
      claimId: "c1",
      status: "unsupported",
      sources: [{ url: "javascript:alert(1)" }, { url: "https://example.com/source" }],
    });
    expect(assessment.sources).toEqual([{ url: "https://example.com/source", accepted: true }]);
  });

  test("sanitizes provider attempt errors", () => {
    const attempt = normalizeProviderAttempt({
      id: "p1",
      provider: "gemini",
      status: "failed",
      statusCode: 503,
      errorMessage: "Bearer sk-live-secret failed token=abc123",
    });
    expect(attempt.errorMessage).not.toContain("sk-live-secret");
    expect(attempt.errorMessage).not.toContain("abc123");
    expect(attempt.retryable).toBe(true);
  });
});
