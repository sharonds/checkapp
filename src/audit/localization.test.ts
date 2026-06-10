import { describe, expect, test } from "bun:test";
import {
  AUDIT_UI,
  auditLocaleForFinding,
  auditLocaleForLanguage,
  formatAuditLocation,
  localizedFindingStatus,
  localizedSkillName,
  localizedVerdictLabel,
} from "./localization.ts";

describe("audit localization", () => {
  test("selects Hebrew for Hebrew and mixed audit language", () => {
    expect(auditLocaleForLanguage("he")).toBe("he");
    expect(auditLocaleForLanguage("mixed")).toBe("he");
    expect(auditLocaleForLanguage("en")).toBe("en");
    expect(auditLocaleForLanguage("other")).toBe("en");
  });

  test("infers finding locale from explanation language or dominant quote text", () => {
    expect(auditLocaleForFinding({ explanationLanguage: "he", quote: "Rummikub" })).toBe("he");
    expect(auditLocaleForFinding({ quote: "המשחק Rummikub מתאים לשני שחקנים בלבד." })).toBe("he");
    expect(auditLocaleForFinding({ quote: "The game supports two players." })).toBe("en");
  });

  test("formats location labels in English and Hebrew", () => {
    const location = {
      sectionId: "section-1",
      sectionTitle: "משחקים",
      paragraphIndex: 1,
      sentenceIndex: 0,
      startOffset: 10,
      endOffset: 30,
    };
    expect(formatAuditLocation(location, "en")).toBe("Location: משחקים · paragraph 2 · sentence 1 · chars 10-30");
    expect(formatAuditLocation(location, "he")).toBe("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 10-30");
  });

  test("localizes common audit labels without translating provider names", () => {
    expect(AUDIT_UI.he.qualityReport).toBe("דוח איכות");
    expect(AUDIT_UI.he.checkedClaims(4, 1, 0, "gemini-grounded")).toContain("gemini-grounded");
    expect(localizedSkillName({ skillId: "plagiarism", name: "Plagiarism Check" }, "he")).toBe("בדיקת מקוריות");
    expect(localizedVerdictLabel("fail", "he")).toBe("לא לפרסום");
    expect(localizedFindingStatus({ status: "unsupported" }, "he")).toBe("לא נתמך");
  });
});
