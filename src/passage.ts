/**
 * Splits article text into sentences and returns those that appear
 * verbatim (case-insensitive) in the given page content.
 * Sentences shorter than MIN_WORDS are skipped to avoid false positives
 * from common short phrases.
 *
 * MIN_WORDS is exported so tests can reference it symbolically — if you
 * change the threshold, tests automatically use the new value.
 */

export const MIN_WORDS = 8;

export function findMatchingPassages(
  articleText: string,
  pageContent: string
): string[] {
  // Strip markdown link syntax from page content: [text](url) → text.
  // Parallel's full_content may contain markdown-formatted hyperlinks.
  const cleanedPage = pageContent.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const pageLower = cleanedPage.toLowerCase();

  return splitIntoSentences(articleText).filter((s) => {
    if (s.split(/\s+/).length < MIN_WORDS) return false;
    // Strip terminal punctuation before searching so a sentence ending in "."
    // still matches when the page uses a comma or continues the sentence further.
    const core = s.replace(/[.!?]+$/, "").toLowerCase();
    return pageLower.includes(core);
  });
}

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try Latin-aware split first (handles abbreviations like "U.S." correctly)
  const latinSplit = trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
  if (latinSplit.length > 1) return latinSplit;

  // Fallback: split on sentence-ending punctuation followed by whitespace (works for Hebrew, Arabic, CJK)
  return trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}
