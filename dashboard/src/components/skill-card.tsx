"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "./score-ring";
import { VerdictBadge } from "./verdict-badge";

const ENGINE_MAP: Record<string, string> = {
  plagiarism: "Copyscape",
  "ai-detection": "Copyscape",
  seo: "Offline",
  "fact-check": "Exa AI",
  tone: "MiniMax",
  legal: "MiniMax",
  summary: "MiniMax",
};

interface Finding {
  severity: string;
  text: string;
  quote?: string;
}

export interface SkillResult {
  skillId: string;
  name: string;
  score: number;
  verdict: "pass" | "warn" | "fail";
  summary: string;
  findings: Finding[];
  costUsd: number;
}

export function SkillCard({ result }: { result: SkillResult }) {
  const engine = ENGINE_MAP[result.skillId] ?? "Unknown";
  const visibleFindings = result.findings.filter(
    (f) => f.severity === "warn" || f.severity === "error"
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-2">
            <ScoreRing score={result.score} verdict={result.verdict} />
            <VerdictBadge verdict={result.verdict} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle>{result.name}</CardTitle>
              <Badge variant="secondary">{engine}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.summary}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cost: ${result.costUsd.toFixed(4)}
            </p>
          </div>
        </div>
      </CardHeader>
      {visibleFindings.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {visibleFindings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 mt-0.5">
                  {f.severity === "error" ? "\u274c" : "\u26a0\ufe0f"}
                </span>
                <div>
                  <span>{f.text}</span>
                  {f.quote && (
                    <blockquote className="mt-1 border-l-2 border-muted-foreground/30 pl-2 text-xs text-muted-foreground italic">
                      {f.quote}
                    </blockquote>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
