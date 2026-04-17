"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { safeHref, sanitizeText } from "@/lib/sanitize";
import type { Finding } from "@/lib/normalize";

interface Props { finding: Finding; }

export function ClaimDrillDown({ finding }: Props) {
  const hasEvidence = (finding.sources?.length ?? 0) + (finding.citations?.length ?? 0) > 0;
  const hasRewrite = typeof finding.rewrite === "string" && finding.rewrite.length > 0;
  if (!hasEvidence && !hasRewrite) return null;

  const evidenceCount = (finding.sources?.length ?? 0) + (finding.citations?.length ?? 0);
  const buttonLabel = hasEvidence
    ? `View evidence (${evidenceCount})`
    : "View suggested rewrite";

  return (
    <Sheet>
      <SheetTrigger render={<Button size="sm" variant="outline">{buttonLabel}</Button>} />
      <SheetContent className="w-full sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {hasEvidence ? "Evidence" : "Suggested rewrite"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {finding.sources?.map((s, i) => (
            <article key={`s-${i}`} className="rounded border p-3">
              <a
                href={safeHref(s.url)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium hover:underline"
              >
                {sanitizeText(s.title) || safeHref(s.url)}
              </a>
              {s.publishedDate && (
                <Badge variant="secondary" className="ml-2">
                  {new Date(s.publishedDate).toLocaleDateString()}
                </Badge>
              )}
              {typeof s.relevanceScore === "number" && (
                <Badge variant="outline" className="ml-2 text-xs">
                  {(s.relevanceScore * 100).toFixed(0)}% similar
                </Badge>
              )}
              {s.quote && (
                <p className="mt-2 text-sm italic text-muted-foreground">
                  &ldquo;{sanitizeText(s.quote, 500)}&rdquo;
                </p>
              )}
            </article>
          ))}

          {finding.citations?.map((c, i) => (
            <article key={`c-${i}`} className="rounded border bg-blue-50/30 p-3">
              <h4 className="font-medium">{sanitizeText(c.title)}</h4>
              {(c.authors || c.year) && (
                <p className="text-xs text-muted-foreground">
                  {c.authors?.map((a) => sanitizeText(a)).join(", ")}
                  {c.authors && c.year ? " · " : ""}
                  {c.year}
                </p>
              )}
              {c.doi && (
                <a
                  href={safeHref(`https://doi.org/${encodeURIComponent(c.doi)}`)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-blue-600 underline"
                >
                  doi:{sanitizeText(c.doi)}
                </a>
              )}
              {c.abstractSnippet && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {sanitizeText(c.abstractSnippet, 500)}…
                </p>
              )}
            </article>
          ))}

          {hasRewrite && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase text-emerald-800">
                Suggested rewrite
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {sanitizeText(finding.rewrite)}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
