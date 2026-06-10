import type { AuditLanguage, AuditLocation, Finding, SkillResult } from "@/lib/normalize";

export type AuditLocale = "en" | "he";

const HEBREW_RE = /[\u0590-\u05ff]/g;
const LATIN_RE = /[A-Za-z]/g;

export function auditLocaleForLanguage(language?: AuditLanguage): AuditLocale {
  return language === "he" || language === "mixed" ? "he" : "en";
}

export function auditLocaleForFinding(finding: Pick<Finding, "quote" | "explanationLanguage" | "rewrite">): AuditLocale {
  if (finding.explanationLanguage) return auditLocaleForLanguage(finding.explanationLanguage);
  const text = `${finding.quote ?? ""}\n${finding.rewrite ?? ""}`;
  const he = text.match(HEBREW_RE)?.length ?? 0;
  const latin = text.match(LATIN_RE)?.length ?? 0;
  return he > latin ? "he" : "en";
}

export const AUDIT_UI = {
  en: {
    confidence: "Confidence",
    confidenceRationale: "Confidence rationale",
    details: "Details",
    documentQuote: "Document quote",
    evidence: "Evidence",
    approximateLocation: "Approximate location",
    location: "Location",
    paragraph: "paragraph",
    search: "Search",
    sentence: "sentence",
    suggestedRewrite: "Suggested rewrite",
    source: "Source",
    similarity: (percent: string) => `${percent}% similar`,
    viewEvidence: (count: number) => `View evidence (${count})`,
    viewSuggestedRewrite: "View suggested rewrite",
    chars: "chars",
    apiCost: "API cost",
    qualityReport: "Quality Report",
    date: "Date",
    score: "Score",
    totalCost: "Total Cost",
    findings: "Findings",
    provider: "Provider",
    summary: "Summary",
    backToReports: "Back to reports",
    tags: "Tags",
    skillResults: "Skill Results",
    unsupported: "Unsupported",
    unverified: "Unverified",
    providerError: "Provider error",
    words: "Words",
    factCheck: "Fact Check",
    factCheckGrounded: "Fact Check (Grounded)",
    plagiarismCheck: "Plagiarism Check",
    cost: "Cost",
    checkedClaims: (checked: number, unsupported: number, unverified: number, provider?: string, skipped?: number, budgetStopReason?: string, providerErrors?: number) =>
      `${checked} claims checked — ${unsupported} unsupported, ${unverified} unverified${providerErrors ? `, ${providerErrors} provider errors` : ""}${skipped ? `, ${skipped} skipped${budgetStopReason ? ` by ${formatBudgetStopReason(budgetStopReason, "en")}` : ""}` : ""}${provider ? ` (via ${provider})` : ""}`,
  },
  he: {
    confidence: "רמת ביטחון",
    confidenceRationale: "נימוק רמת הביטחון",
    details: "פרטים",
    documentQuote: "ציטוט מהמסמך",
    evidence: "ראיות",
    approximateLocation: "מיקום משוער",
    location: "מיקום",
    paragraph: "פסקה",
    search: "חיפוש",
    sentence: "משפט",
    suggestedRewrite: "ניסוח מוצע",
    source: "מקור",
    similarity: (percent: string) => `דמיון: ${percent}%`,
    viewEvidence: (count: number) => `הצגת ראיות (${count})`,
    viewSuggestedRewrite: "הצגת ניסוח מוצע",
    chars: "תווים",
    apiCost: "עלות API",
    qualityReport: "דוח איכות",
    date: "תאריך",
    score: "ציון",
    totalCost: "עלות כוללת",
    findings: "ממצאים",
    provider: "ספק",
    summary: "סיכום",
    backToReports: "חזרה לדוחות",
    tags: "תגיות",
    skillResults: "תוצאות בדיקה",
    unsupported: "לא נתמך",
    unverified: "לא אומת",
    providerError: "שגיאת ספק",
    words: "מילים",
    factCheck: "בדיקת עובדות",
    factCheckGrounded: "בדיקת עובדות מבוססת מקורות",
    plagiarismCheck: "בדיקת מקוריות",
    cost: "עלות",
    checkedClaims: (checked: number, unsupported: number, unverified: number, provider?: string, skipped?: number, budgetStopReason?: string, providerErrors?: number) =>
      `${checked} טענות נבדקו — ${unsupported} לא נתמכו, ${unverified} לא אומתו${providerErrors ? `, ${providerErrors} שגיאות ספק` : ""}${skipped ? `, ${skipped} דולגו${budgetStopReason ? ` בגלל ${formatBudgetStopReason(budgetStopReason, "he")}` : ""}` : ""}${provider ? ` (באמצעות ${provider})` : ""}`,
  },
} as const;

const BUDGET_STOP_REASON_LABELS: Record<string, { en: string; he: string }> = {
  claim_cap: { en: "claim cap", he: "מכסת טענות" },
  provider_call_budget: { en: "provider-call budget", he: "מכסת קריאות לספק" },
  cost_budget: { en: "cost budget", he: "מכסת עלות" },
  input_token_budget: { en: "input-token budget", he: "מכסת אסימוני קלט" },
  output_token_budget: { en: "output-token budget", he: "מכסת אסימוני פלט" },
  wall_clock_budget: { en: "time budget", he: "מכסת זמן" },
  provider_retry_budget: { en: "provider-retry budget", he: "מכסת ניסיונות חוזרים" },
  provider_failure_budget: { en: "provider-failure budget", he: "מכסת כשלי ספק" },
};

export function formatBudgetStopReason(reason: string, locale: AuditLocale): string {
  return BUDGET_STOP_REASON_LABELS[reason]?.[locale] ?? reason.replace(/_/g, " ");
}

export function localizedVerdictLabel(verdict: unknown, locale: AuditLocale): string {
  if (locale === "he") {
    if (verdict === "pass") return "מוכן לבדיקה";
    if (verdict === "warn") return "דורש טיפול";
    if (verdict === "fail") return "לא לפרסום";
    if (verdict === "skipped") return "לא נבדק";
  }
  return String(verdict ?? "").toUpperCase();
}

export function localizedConfidenceValue(confidence: string | undefined, locale: AuditLocale): string | undefined {
  if (!confidence) return undefined;
  if (locale === "he") {
    if (confidence === "high") return "גבוהה";
    if (confidence === "medium") return "בינונית";
    if (confidence === "low") return "נמוכה";
  }
  return confidence;
}

export function localizedFindingText(
  finding: {
    text: string;
    status?: string;
    confidence?: string;
    explanation?: string;
    explanationLanguage?: AuditLanguage;
  },
  locale: AuditLocale,
): string {
  const labels = AUDIT_UI[locale];
  if (locale === "he" && (finding.status === "unsupported" || finding.status === "unverified")) {
    const status = finding.status === "unsupported" ? labels.unsupported : labels.unverified;
    const confidence = finding.confidence ? ` (${labels.confidence}: ${localizedConfidenceValue(finding.confidence, locale)})` : "";
    const explanation = finding.explanation ? ` — ${finding.explanation}` : "";
    return `${status}${confidence}${explanation}`;
  }
  if (locale === "he" && finding.status === "provider_error") {
    const confidence = finding.confidence ? ` (${labels.confidence}: ${localizedConfidenceValue(finding.confidence, locale)})` : "";
    const explanation = finding.explanation ? ` — ${finding.explanation}` : "";
    return `${labels.providerError}${confidence}${explanation}`;
  }
  if (locale === "he" && finding.status === "plagiarism_match") {
    const confidence = finding.confidence ? ` (${labels.confidence}: ${localizedConfidenceValue(finding.confidence, locale)})` : "";
    const explanation = finding.explanation ? ` — ${finding.explanation}` : "";
    return `חשד להעתקה${confidence}${explanation}`;
  }
  return finding.text;
}

export function localeForSkillResult(result: Pick<SkillResult, "findings">): AuditLocale {
  return result.findings.some((finding) => auditLocaleForFinding(finding) === "he") ? "he" : "en";
}

export function localizedSkillName(result: Pick<SkillResult, "skillId" | "name">, locale: AuditLocale): string {
  const labels = AUDIT_UI[locale];
  if (result.skillId === "fact-check" || result.skillId === "factCheck") return labels.factCheck;
  if (result.skillId === "fact-check-grounded") return labels.factCheckGrounded;
  if (result.skillId === "plagiarism") return labels.plagiarismCheck;
  return result.name;
}

export function formatAuditLocation(location: AuditLocation, locale: AuditLocale): string {
  const labels = AUDIT_UI[locale];
  const locationLabel = location.matchQuality === "fuzzy" ? labels.approximateLocation : labels.location;
  const parts = [
    location.sectionTitle ?? location.sectionId,
    `${labels.paragraph} ${location.paragraphIndex + 1}`,
  ];
  if (typeof location.sentenceIndex === "number") parts.push(`${labels.sentence} ${location.sentenceIndex + 1}`);
  if (location.matchQuality !== "fuzzy" && typeof location.startOffset === "number" && typeof location.endOffset === "number") {
    parts.push(`${labels.chars} ${location.startOffset}-${location.endOffset}`);
  }
  return `${locationLabel}: ${parts.filter(Boolean).join(" · ")}`;
}

export interface AuditCoverageSummary {
  claimsChecked?: number;
  claimsSkipped?: number;
  budgetStopReason?: string;
}

export function localizedSkillSummary(
  result: {
    skillId: string;
    summary: string;
    provider?: string;
    findings: Array<{ status?: string; text: string }>;
  },
  locale: AuditLocale,
  coverage?: AuditCoverageSummary,
): string {
  if (result.skillId !== "fact-check-grounded" && result.skillId !== "fact-check") return result.summary;
  if (typeof coverage?.claimsChecked !== "number") return result.summary;
  const unsupported = result.findings.filter((finding) => finding.status === "unsupported" || /unsupported|לא נתמך/i.test(finding.text)).length;
  const providerErrors = result.findings.filter((finding) => finding.status === "provider_error").length;
  const unverified = result.findings.filter((finding) => finding.status !== "provider_error" && (finding.status === "unverified" || /unverified|לא אומת/i.test(finding.text))).length;
  return AUDIT_UI[locale].checkedClaims(
    coverage.claimsChecked,
    unsupported,
    unverified,
    result.provider,
    coverage.claimsSkipped,
    coverage.budgetStopReason,
    providerErrors,
  );
}
