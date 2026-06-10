import { describe, expect, test } from "bun:test";
import {
  AUDIT_UI as CLI_AUDIT_UI,
  formatAuditLocation as formatCliAuditLocation,
} from "./localization.ts";
import { normalizeFinding as normalizeCliFinding, normalizeSkillResult as normalizeCliSkillResult } from "../skills/normalize.ts";
import {
  AUDIT_UI as DASHBOARD_AUDIT_UI,
  formatAuditLocation as formatDashboardAuditLocation,
} from "../../dashboard/src/lib/audit-localization.ts";
import {
  normalizeFinding as normalizeDashboardFinding,
  normalizeSkillResult as normalizeDashboardSkillResult,
} from "../../dashboard/src/lib/normalize.ts";

describe("shared audit contract", () => {
  test("CLI and dashboard localization stay aligned for report/export labels", () => {
    const stringKeys = [
      "apiCost",
      "chars",
      "confidence",
      "confidenceRationale",
      "details",
      "documentQuote",
      "evidence",
      "factCheck",
      "factCheckGrounded",
      "location",
      "approximateLocation",
      "paragraph",
      "plagiarismCheck",
      "providerError",
      "qualityReport",
      "search",
      "sentence",
      "source",
      "suggestedRewrite",
      "words",
    ] as const;

    for (const locale of ["en", "he"] as const) {
      for (const key of stringKeys) {
        expect(DASHBOARD_AUDIT_UI[locale][key]).toBe(CLI_AUDIT_UI[locale][key]);
      }
      expect(DASHBOARD_AUDIT_UI[locale].checkedClaims(4, 1, 0, "gemini-grounded", 2, "claim_cap", 1))
        .toBe(CLI_AUDIT_UI[locale].checkedClaims(4, 1, 0, "gemini-grounded", 2, "claim_cap", 1));
      expect(DASHBOARD_AUDIT_UI[locale].checkedClaims(2, 0, 1, "gemini-grounded", 1, "cost_budget", 1))
        .toBe(CLI_AUDIT_UI[locale].checkedClaims(2, 0, 1, "gemini-grounded", 1, "cost_budget", 1));
    }
  });

  test("CLI and dashboard format exact and fuzzy locations identically", () => {
    const locations = [
      {
        sectionId: "section-1",
        sectionTitle: "Games",
        paragraphIndex: 0,
        sentenceIndex: 1,
        startOffset: 12,
        endOffset: 44,
        matchQuality: "exact" as const,
      },
      {
        sectionId: "section-2",
        sectionTitle: "משחקים",
        paragraphIndex: 2,
        sentenceIndex: 0,
        startOffset: 50,
        endOffset: 90,
        matchQuality: "fuzzy" as const,
      },
    ];
    for (const locale of ["en", "he"] as const) {
      for (const location of locations) {
        expect(formatDashboardAuditLocation(location, locale)).toBe(formatCliAuditLocation(location, locale));
      }
    }
  });

  test("CLI and dashboard finding normalizers produce identical structured audit fields", () => {
    const rawFinding = {
      severity: "error",
      text: "Copied passage",
      quote: "Document quote",
      status: "plagiarism_match",
      confidence: "high",
      location: {
        sectionId: "section-1",
        sectionTitle: "Games",
        paragraphIndex: 0,
        sentenceIndex: 0,
        matchQuality: "fuzzy",
      },
      matchType: "semantic",
      groundingMode: "mixed",
      searchQueries: ["query"],
      auditRef: { auditId: "audit-1", plagiarismFindingId: "plag-1" },
    };

    const dashboardFinding = normalizeDashboardFinding(rawFinding);
    const cliFinding = normalizeCliFinding(rawFinding);
    expect(dashboardFinding).toEqual(cliFinding);
    expect(cliFinding.matchType).toBe("semantic");
    expect(cliFinding.groundingMode).toBe("mixed");
  });

  test("CLI and dashboard skill-result normalizers agree on camelCase and snake_case inputs", () => {
    const raw = {
      skill_id: "fact-check-grounded",
      name: "Fact Check",
      score: 72,
      verdict: "warn",
      summary: "summary",
      findings: [{ severity: "warn", text: "issue" }],
      cost_usd: 0.04,
      provider: "gemini-grounded",
    };

    expect(normalizeDashboardSkillResult(raw)).toEqual(normalizeCliSkillResult(raw));
  });
}
);
