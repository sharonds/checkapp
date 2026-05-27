import { sanitizeHttpReportUrl } from "../shared/report-url.ts";

export function safeReportUrl(raw: unknown): string | null {
  return sanitizeHttpReportUrl(raw);
}

export function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\[/g, "\\[");
}
