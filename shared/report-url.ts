export function sanitizeHttpReportUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryParam(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.hash) {
      const hash = url.hash.slice(1);
      const params = new URLSearchParams(hash);
      let redacted = false;
      for (const key of Array.from(params.keys())) {
        if (isSensitiveQueryParam(key)) {
          params.set(key, "[redacted]");
          redacted = true;
        }
      }
      if (redacted) {
        url.hash = params.toString();
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeSourceLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = stripControlCharacters(raw).trim();
  if (value === "") return "";
  const sanitizedUrl = sanitizeHttpReportUrl(value);
  if (sanitizedUrl) return sanitizedUrl;
  return value.slice(0, 240);
}

export function sanitizeEvidenceLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = stripControlCharacters(raw).trim();
  if (value === "") return "";
  const sanitizedUrl = sanitizeHttpReportUrl(value);
  return (sanitizedUrl ?? value).slice(0, 240);
}

export function sourceFilenameSlug(raw: unknown, reportId?: number | string): string {
  const safe = sanitizeSourceLabel(raw)
    .replace(/^https?:\/\//i, "")
    .replace(/\[[^\]]+\]/g, "redacted")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe || (reportId !== undefined ? `report-${reportId}` : "checkapp-report");
}

function isSensitiveQueryParam(key: string): boolean {
  return /(?:^|[_-])(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|key)(?:$|[_-])/i.test(key);
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "");
}
