"use client";

import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { CheckTable, type CheckRow } from "@/components/check-table";
import { TagPill } from "@/components/tag-pill";
import { EmptyState } from "@/components/empty-state";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { FooterBar } from "@/components/footer-bar";

interface ApiCheck {
  id: number;
  source: string;
  wordCount: number;
  word_count?: number;
  totalCost: number;
  total_cost?: number;
  createdAt: string;
  created_at?: string;
  results?: Array<{ score?: number }>;
  resultsJson?: string;
  results_json?: string;
}

interface ApiTag {
  name: string;
  count: number;
}

function getVerdict(score: number): "pass" | "warn" | "fail" {
  if (score >= 75) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

function parseResults(check: ApiCheck): Array<{ score?: number }> {
  if (Array.isArray(check.results)) return check.results;
  const raw = check.resultsJson ?? check.results_json;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function toCheckRow(c: ApiCheck): CheckRow {
  const results = parseResults(c);
  const scores = results
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

  return {
    id: String(c.id),
    source: c.source,
    score: avgScore,
    verdict: getVerdict(avgScore),
    words: c.wordCount ?? c.word_count ?? 0,
    costUsd: c.totalCost ?? c.total_cost ?? 0,
    createdAt: c.createdAt ?? c.created_at ?? "",
  };
}

export default function ReportsPage() {
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tags, setTags] = useState<ApiTag[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tags on mount
  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => setTags([]));
  }, []);

  // Fetch checks on query/tag change
  const fetchChecks = useCallback(() => {
    setLoading(true);
    const hasFilter = query.trim() || selectedTag;
    const url = hasFilter
      ? `/api/search?q=${encodeURIComponent(query.trim())}${selectedTag ? `&tag=${encodeURIComponent(selectedTag)}` : ""}`
      : "/api/checks";

    fetch(url)
      .then((r) => r.json())
      .then((data: ApiCheck[]) => {
        if (Array.isArray(data)) {
          setChecks(data.map(toCheckRow));
        } else {
          setChecks([]);
        }
      })
      .catch(() => setChecks([]))
      .finally(() => setLoading(false));
  }, [query, selectedTag]);

  useEffect(() => {
    const timer = setTimeout(fetchChecks, 300);
    return () => clearTimeout(timer);
  }, [fetchChecks]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-6 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>

        {/* Search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by source..."
            className="flex h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Tag filter row */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() =>
                  setSelectedTag((prev) =>
                    prev === tag.name ? null : tag.name
                  )
                }
                className={`rounded-full transition-all ${
                  selectedTag === tag.name
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : ""
                }`}
              >
                <TagPill name={tag.name} />
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <LoadingSkeleton key={i} variant="table-row" />
            ))}
          </div>
        ) : checks.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No reports found"
            description={
              query || selectedTag
                ? "Try a different search query or clear the tag filter"
                : "Run your first article check to see reports here"
            }
          />
        ) : (
          <CheckTable checks={checks} />
        )}
      </div>
      <FooterBar />
    </div>
  );
}
