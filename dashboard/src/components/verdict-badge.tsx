import { cn } from "@/lib/utils";
import { localizedVerdictLabel, type AuditLocale } from "@/lib/audit-localization";

const VERDICT_STYLES = {
  pass: "bg-score-pass text-white",
  warn: "bg-score-warn text-white",
  fail: "bg-score-fail text-white",
  skipped: "bg-gray-500 text-white",
} as const;

interface VerdictBadgeProps {
  verdict: "pass" | "warn" | "fail" | "skipped";
  locale?: AuditLocale;
}

export function VerdictBadge({ verdict, locale = "en" }: VerdictBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center justify-center rounded-full px-2 text-xs font-semibold uppercase",
        VERDICT_STYLES[verdict]
      )}
    >
      {localizedVerdictLabel(verdict, locale)}
    </span>
  );
}
