const SAFE_SCHEMES = /^(https?|mailto):/i;
// C0 control chars, minus \t (\x09), \n (\x0A), \r (\x0D). Plus DEL (\x7F).
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Return `raw` if it parses as a safe-scheme URL, else "#".
 * Blocks javascript:, data:, vbscript:, file:, etc.
 *
 * Call this on ANY `<a href>` whose target comes from user-supplied or
 * upstream-provider data (Exa results, Semantic Scholar papers, Vectorize
 * metadata, etc).
 */
export function safeHref(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "#";
  const trimmed = raw.trim();
  if (!SAFE_SCHEMES.test(trimmed)) return "#";
  try {
    const u = new URL(trimmed);
    return u.toString();
  } catch {
    return "#";
  }
}

/**
 * Strip C0 control chars and truncate to `maxLen` characters.
 * React already escapes text children — this is defence-in-depth against
 * control chars that render as garbage, and length caps so a rogue
 * upstream response can't blow up the DOM.
 */
export function sanitizeText(raw: unknown, maxLen = 2000): string {
  if (typeof raw !== "string") return "";
  const stripped = raw.replace(CONTROL_CHARS, "");
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + "…" : stripped;
}
