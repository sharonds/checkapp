import { sanitizeHttpReportUrl } from "../../../shared/report-url";

// C0 control chars, minus \t (\x09), \n (\x0A), \r (\x0D). Plus DEL (\x7F).
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Return a sanitized HTTP(S) URL, else "#".
 * Blocks javascript:, data:, vbscript:, file:, mailto:, etc.
 * Credentials are stripped and token-like query params are redacted.
 *
 * Call this on ANY `<a href>` whose target comes from user-supplied or
 * upstream-provider data (Exa results, Semantic Scholar papers, Vectorize
 * metadata, etc).
 */
export function safeHref(raw: unknown): string {
  return sanitizeHttpReportUrl(raw) ?? "#";
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
  if (stripped.length > maxLen) {
    const sliced = stripped.slice(0, maxLen);
    return sliced.endsWith("…") ? sliced : sliced + "…";
  }
  return stripped;
}
