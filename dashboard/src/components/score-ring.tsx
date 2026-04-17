"use client";

const VERDICT_CSS_VARS = {
  pass: "var(--color-score-pass)",
  warn: "var(--color-score-warn)",
  fail: "var(--color-score-fail)",
  skipped: "var(--muted-foreground)",
} as const;

interface ScoreRingProps {
  score: number;
  verdict: "pass" | "warn" | "fail" | "skipped";
  size?: number;
}

export function ScoreRing({ score, verdict, size = 80 }: ScoreRingProps) {
  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = VERDICT_CSS_VARS[verdict];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20 dark:text-muted-foreground/30"
      />
      {/* Progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Score text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size * 0.3}
        fontWeight="bold"
      >
        {score}
      </text>
    </svg>
  );
}
