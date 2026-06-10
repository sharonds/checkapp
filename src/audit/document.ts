import { createHash } from "crypto";
import { detectLanguage, isRtl, type Language } from "../language.ts";
import type {
  AuditClaimType,
  AuditDirection,
  AuditLanguage,
  AuditLocation,
  AuditRecord,
  AuditSegment,
} from "./types.ts";

export interface DocumentAnalysis {
  language: AuditLanguage;
  direction: AuditDirection;
  sectionsDetected: number;
  paragraphsScanned: number;
  sentencesScanned: number;
  wordsScanned: number;
  segments: AuditSegment[];
}

export interface LocatedQuote {
  quote: string;
  language: AuditLanguage;
  direction: AuditDirection;
  location?: AuditLocation;
  segmentId?: string;
}

export function analyzeDocument(text: string): DocumentAnalysis {
  const language = auditLanguage(text);
  const direction = auditDirection(language);
  const paragraphs = splitParagraphs(text);
  const segments: AuditSegment[] = [];
  let currentSectionId = "section-1";
  let currentSectionTitle: string | undefined;
  let sectionCount = 1;
  let paragraphIndex = 0;

  for (const paragraph of paragraphs) {
    const heading = paragraph.text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      sectionCount += paragraphIndex === 0 && segments.length === 0 ? 0 : 1;
      currentSectionId = `section-${sectionCount}`;
      currentSectionTitle = heading[1].trim();
      continue;
    }

    const sentences = splitSentences(paragraph.text, paragraph.start);
    sentences.forEach((sentence, sentenceIndex) => {
      const segmentLanguage = auditLanguage(sentence.text);
      segments.push({
        id: `seg-${segments.length + 1}`,
        sectionId: currentSectionId,
        sectionTitle: currentSectionTitle,
        text: sentence.text,
        language: segmentLanguage,
        direction: auditDirection(segmentLanguage),
        paragraphIndex,
        sentenceIndex,
        startOffset: sentence.start,
        endOffset: sentence.end,
      });
    });
    paragraphIndex++;
  }

  return {
    language,
    direction,
    sectionsDetected: Math.max(1, sectionCount),
    paragraphsScanned: paragraphIndex,
    sentencesScanned: segments.length,
    wordsScanned: countWords(text),
    segments,
  };
}

export function createAuditRecordBase(skillId: string, text: string): Omit<AuditRecord, "coverage"> {
  const analysis = analyzeDocument(text);
  return {
    version: 1,
    auditId: `${skillId}-${hashText(text).slice(0, 12)}`,
    language: analysis.language,
    direction: analysis.direction,
    segments: analysis.segments,
    claims: [],
    claimDecisions: [],
    factAssessments: [],
    plagiarismFindings: [],
    providerAttempts: [],
    createdAt: new Date().toISOString(),
  };
}

export function locateQuote(text: string, quote: string, analysis = analyzeDocument(text)): LocatedQuote {
  const exact = findExactLocatedQuote(quote, analysis.segments);
  if (exact) return exact;

  const best = findBestSegment(quote, analysis.segments);
  if (best) return toLocatedQuote(best, undefined, undefined, undefined, "fuzzy");

  const fallbackLanguage = auditLanguage(quote || text);
  return {
    quote,
    language: fallbackLanguage,
    direction: auditDirection(fallbackLanguage),
  };
}

export function toAuditLocation(segment: AuditSegment): AuditLocation {
  return {
    sectionId: segment.sectionId ?? "section-1",
    sectionTitle: segment.sectionTitle,
    paragraphIndex: segment.paragraphIndex,
    sentenceIndex: segment.sentenceIndex,
    startOffset: segment.startOffset,
    endOffset: segment.endOffset,
    matchQuality: "exact",
  };
}

export function toAuditClaimType(type: string | undefined): AuditClaimType {
  if (type === "scientific" || type === "medical" || type === "financial" || type === "legal") return type;
  if (type === "date" || type === "statistic" || type === "product-spec") return type;
  return "general";
}

export function factRewriteSuggestion(quote: string, language: AuditLanguage, supported: boolean | null, note: string): string {
  if (shouldUseHebrewRewrite(quote, language)) {
    if (supported === false) return `יש לנסח מחדש או להסיר את הטענה: "${quote}". הסיבה: ${note}`;
    return `יש להוסיף מקור אמין או לנסח בזהירות: "${quote}".${note ? ` הסיבה: ${note}` : ""}`;
  }
  if (supported === false) return `Revise or remove this claim: "${quote}". Reason: ${note}`;
  return `Add a reliable source or qualify this claim: "${quote}".${note ? ` Reason: ${note}` : ""}`;
}

export function plagiarismRewriteSuggestion(quote: string, language: AuditLanguage): string {
  if (shouldUseHebrewRewrite(quote, language)) {
    return `יש לנסח את הקטע מחדש במילים מקוריות, להוסיף ייחוס מפורש למקור, או להסיר אותו: "${quote}"`;
  }
  return `Rewrite this passage in original wording, add explicit attribution, or remove it: "${quote}"`;
}

export function confidenceRationale(sourceCount: number, confidence?: "high" | "medium" | "low"): string {
  if (confidence === "high") return `High confidence because ${sourceCount} evidence source${sourceCount === 1 ? "" : "s"} were available.`;
  if (confidence === "medium") return `Medium confidence because ${sourceCount} evidence source${sourceCount === 1 ? "" : "s"} were available or provider metadata was partial.`;
  return `Low confidence because evidence was missing, inconclusive, or required manual review.`;
}

function toLocatedQuote(
  segment: AuditSegment,
  quote?: string,
  startOffset?: number,
  endOffset?: number,
  matchQuality: AuditLocation["matchQuality"] = "exact",
): LocatedQuote {
  const matchedQuote = quote ?? segment.text;
  const effectiveStartOffset = matchQuality === "fuzzy" ? undefined : startOffset ?? segment.startOffset;
  const effectiveEndOffset = matchQuality === "fuzzy" ? undefined : endOffset ?? segment.endOffset;
  const language = auditLanguage(matchedQuote || segment.text);
  const baseLocation = toAuditLocation(segment);
  return {
    quote: matchedQuote,
    language,
    direction: segment.direction ?? auditDirection(language),
    location: {
      ...baseLocation,
      startOffset: effectiveStartOffset,
      endOffset: effectiveEndOffset,
      matchQuality,
    },
    segmentId: segment.id,
  };
}

function findExactLocatedQuote(quote: string, segments: AuditSegment[]): LocatedQuote | undefined {
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote) return undefined;
  for (const segment of segments) {
    const rawIndex = segment.text.indexOf(quote);
    if (rawIndex >= 0) {
      const start = typeof segment.startOffset === "number" ? segment.startOffset + rawIndex : undefined;
      const end = typeof start === "number" ? start + quote.length : undefined;
      return toLocatedQuote(segment, quote, start, end);
    }

    const lowerIndex = segment.text.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
    if (lowerIndex >= 0) {
      const matched = segment.text.slice(lowerIndex, lowerIndex + quote.length);
      const start = typeof segment.startOffset === "number" ? segment.startOffset + lowerIndex : undefined;
      const end = typeof start === "number" ? start + matched.length : undefined;
      return toLocatedQuote(segment, matched, start, end);
    }

    const normalizedSegment = normalizeText(segment.text);
    if (normalizedSegment.includes(normalizedQuote)) return toLocatedQuote(segment, quote, undefined, undefined, "fuzzy");
    if (normalizedQuote.includes(normalizedSegment)) return toLocatedQuote(segment, undefined, undefined, undefined, "fuzzy");
  }
  return undefined;
}

function findBestSegment(quote: string, segments: AuditSegment[]): AuditSegment | undefined {
  const queryTokens = tokenSet(quote);
  if (queryTokens.size === 0) return undefined;
  let best: { segment: AuditSegment; score: number } | undefined;
  for (const segment of segments) {
    const score = overlapScore(queryTokens, tokenSet(segment.text));
    if (!best || score > best.score) best = { segment, score };
  }
  return best && best.score >= 0.15 ? best.segment : undefined;
}

function splitParagraphs(text: string): Array<{ text: string; start: number }> {
  const paragraphs: Array<{ text: string; start: number }> = [];
  const regex = /\S(?:[\s\S]*?)(?=\n\s*\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (trimmed) paragraphs.push({ text: trimmed, start: match.index + leading });
  }
  return paragraphs;
}

function splitSentences(paragraph: string, paragraphStart: number): Array<{ text: string; start: number; end: number }> {
  const sentences: Array<{ text: string; start: number; end: number }> = [];
  const regex = /[^.!?。！？\n]+[.!?。！？]?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(paragraph)) !== null) {
    const raw = match[0];
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    const value = raw.trim();
    if (!value) continue;
    const start = paragraphStart + match.index + leading;
    sentences.push({ text: value, start, end: start + raw.length - leading - trailing });
  }
  if (sentences.length === 0 && paragraph.trim()) {
    const trimmed = paragraph.trim();
    sentences.push({ text: trimmed, start: paragraphStart, end: paragraphStart + trimmed.length });
  }
  return sentences;
}

function auditLanguage(text: string): AuditLanguage {
  const compact = text.replace(/\s/g, "");
  if (!compact) return "en";
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasHebrew && hasLatin) {
    const hebrew = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    return hebrew > latin ? "he" : "en";
  }
  const detected: Language = detectLanguage(text);
  if (detected === "he") return "he";
  if (detected === "en") return "en";
  return "other";
}

function shouldUseHebrewRewrite(quote: string, language: AuditLanguage): boolean {
  if (language === "he") return true;
  if (language !== "mixed") return false;
  const hebrew = (quote.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latin = (quote.match(/[A-Za-z]/g) ?? []).length;
  return hebrew >= latin;
}

function auditDirection(language: AuditLanguage): AuditDirection {
  if (language === "mixed") return "auto";
  return isRtl(language as Language) ? "rtl" : "ltr";
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1));
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap / Math.max(a.size, b.size);
}
