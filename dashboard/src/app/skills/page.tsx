"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";
import { FooterBar } from "@/components/footer-bar";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface Skill {
  id: string;
  name: string;
  engine: string;
  requiresKeys: string[];
  enabled: boolean;
  keysConfigured: boolean;
}

const KEY_LABELS: Record<string, string> = {
  copyscape: "COPYSCAPE_USER / COPYSCAPE_KEY",
  exa: "EXA_API_KEY",
  minimax: "MINIMAX_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const SKILL_INFO: Record<string, { description: string; context?: string }> = {
  plagiarism: {
    description:
      "Checks the full indexed web for copied passages via Copyscape.",
  },
  aiDetection: {
    description:
      "Detects AI-generated content probability per sentence.",
  },
  seo: {
    description:
      "Offline analysis: word count, headings, readability, keywords, links.",
  },
  factCheck: {
    description:
      "Extracts claims, searches evidence via Exa AI, assesses with confidence levels. Includes citation links for verified claims.",
  },
  tone: {
    description: "Compares article against your brand voice guide. Returns rewrite suggestions in your brand voice.",
    context: "tone-guide",
  },
  legal: {
    description:
      "Scans for health claims, defamation, false promises with fix suggestions.",
    context: "legal-policy",
  },
  summary: {
    description:
      "Generates topic, main argument, target audience, and tone.",
  },
  brief: {
    description: "Checks article against your content brief requirements.",
    context: "brief",
  },
  purpose: {
    description: "Classifies article type (tutorial, announcement, case study, etc.) with purpose-specific recommendations.",
  },
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => setSkills(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleSkill(skillId: string, enabled: boolean) {
    const skill = skills.find((s) => s.id === skillId);
    const skillName = skill?.name ?? skillId;
    // Optimistic update
    setSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled } : s))
    );
    try {
      const res = await fetchWithCsrf("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, enabled }),
      });
      if (!res.ok) {
        setSkills((prev) =>
          prev.map((s) => (s.id === skillId ? { ...s, enabled: !enabled } : s))
        );
        toast.error("Failed to update skill");
      } else {
        toast.success(`${skillName} ${enabled ? "enabled" : "disabled"}`);
      }
    } catch {
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, enabled: !enabled } : s))
      );
      toast.error("Failed to update skill");
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable or disable analysis skills and check API key status.
        </p>

        <div className="mt-6 max-w-2xl space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <LoadingSkeleton key={i} variant="card" />
            ))
          ) : (
            skills.map((skill) => {
              const info = SKILL_INFO[skill.id];
              return (
                <Card
                  key={skill.id}
                  className={`rounded-xl shadow-sm transition-opacity ${
                    skill.enabled
                      ? "border-l-4 border-l-score-pass"
                      : "opacity-60"
                  }`}
                >
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">
                          {skill.name}
                        </span>
                        <Badge variant="secondary">{skill.engine}</Badge>
                      </div>

                      {info && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {info.description}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {/* API key status */}
                        <div className="flex items-center gap-1.5">
                          {skill.requiresKeys.length === 0 ? (
                            <>
                              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-muted-foreground">
                                No API keys required
                              </span>
                            </>
                          ) : skill.keysConfigured ? (
                            <>
                              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-muted-foreground">
                                Ready
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                              <span className="text-xs text-red-600 dark:text-red-400">
                                Missing:{" "}
                                {skill.requiresKeys
                                  .map((k) => KEY_LABELS[k] ?? k)
                                  .join(", ")}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Context requirement */}
                        {info?.context && (
                          <Link
                            href="/contexts"
                            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                          >
                            Requires {info.context} context
                          </Link>
                        )}
                      </div>
                    </div>

                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={(checked) =>
                        toggleSkill(skill.id, checked as boolean)
                      }
                    />
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
      <FooterBar />
    </div>
  );
}
