import { describe, expect, test } from "vitest";
import {
  auditLocaleForFinding,
  auditLocaleForLanguage,
  formatAuditLocation,
  formatBudgetStopReason,
  localizedFindingText,
  localizedSkillName,
} from "@/lib/audit-localization";

describe("dashboard audit localization", () => {
  test("selects Hebrew for Hebrew and mixed content", () => {
    expect(auditLocaleForLanguage("he")).toBe("he");
    expect(auditLocaleForLanguage("mixed")).toBe("he");
    expect(auditLocaleForLanguage("en")).toBe("en");
  });

  test("infers Hebrew from a mixed Hebrew-English quote", () => {
    expect(auditLocaleForFinding({ quote: "המשחק Rummikub מתאים לשני שחקנים בלבד." })).toBe("he");
  });

  test("formats dashboard locations in Hebrew", () => {
    expect(formatAuditLocation({
      sectionId: "section-1",
      sectionTitle: "משחקים",
      paragraphIndex: 1,
      sentenceIndex: 0,
      startOffset: 86,
      endOffset: 129,
    }, "he")).toBe("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129");
  });

  test("localizes core audit skill names", () => {
    expect(localizedSkillName({ skillId: "fact-check-grounded", name: "Fact Check (Grounded)" }, "he")).toBe("בדיקת עובדות מבוססת מקורות");
    expect(localizedSkillName({ skillId: "seo", name: "SEO" }, "he")).toBe("SEO");
  });

  test("all budget stop reasons have Hebrew labels", () => {
    const reasons = [
      "claim_cap",
      "provider_call_budget",
      "cost_budget",
      "input_token_budget",
      "output_token_budget",
      "wall_clock_budget",
      "provider_retry_budget",
      "provider_failure_budget",
    ];
    for (const r of reasons) {
      expect(formatBudgetStopReason(r, "he")).not.toMatch(/[a-z]/);
      expect(formatBudgetStopReason(r, "en")).not.toContain("_");
    }
  });

  test("localizes provider-error finding text in Hebrew drilldowns", () => {
    expect(localizedFindingText({
      text: "Provider error (low confidence): claim",
      status: "provider_error",
      confidence: "low",
      explanation: "יש לבדוק ידנית.",
      explanationLanguage: "he",
    }, "he")).toBe("שגיאת ספק (רמת ביטחון: נמוכה) — יש לבדוק ידנית.");
  });
});
