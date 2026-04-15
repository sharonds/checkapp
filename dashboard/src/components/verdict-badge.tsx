import { cn } from "@/lib/utils";

const VERDICT_STYLES = {
  pass: "bg-green-600 text-white",
  warn: "bg-amber-600 text-white",
  fail: "bg-red-600 text-white",
} as const;

interface VerdictBadgeProps {
  verdict: "pass" | "warn" | "fail";
}

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center justify-center rounded-full px-2 text-xs font-semibold uppercase",
        VERDICT_STYLES[verdict]
      )}
    >
      {verdict.toUpperCase()}
    </span>
  );
}
