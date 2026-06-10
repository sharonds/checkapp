"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { safeHref, sanitizeText } from "@/lib/sanitize";
import type { Finding } from "@/lib/normalize";
import { formatShortDate } from "@/lib/format";
import { AUDIT_UI, auditLocaleForFinding, formatAuditLocation } from "@/lib/audit-localization";
import type { AuditLocale } from "@/lib/audit-localization";

interface Props { finding: Finding; locale?: AuditLocale; }

export function ClaimDrillDown({ finding, locale: reportLocale }: Props) {
  const hasEvidence = (finding.sources?.length ?? 0) + (finding.citations?.length ?? 0) > 0;
  const hasRewrite = typeof finding.rewrite === "string" && finding.rewrite.length > 0;
  const hasAuditContext = !!finding.location || !!finding.confidenceRationale || !!finding.searchQueries?.length;
  if (!hasEvidence && !hasRewrite && !hasAuditContext) return null;

  const locale = reportLocale ?? auditLocaleForFinding(finding);
  const labels = AUDIT_UI[locale];
  const evidenceCount = (finding.sources?.length ?? 0) + (finding.citations?.length ?? 0);
  const buttonLabel = hasEvidence
    ? labels.viewEvidence(evidenceCount)
    : labels.viewSuggestedRewrite;

  return (
    <Sheet>
      <SheetTrigger render={<Button size="sm" variant="outline">{buttonLabel}</Button>} />
      <SheetContent dir={locale === "he" ? "rtl" : "ltr"} className="w-full sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {hasEvidence ? labels.evidence : labels.suggestedRewrite}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {finding.quote && (
            <div className="rounded border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {labels.documentQuote}
              </p>
              <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap">
                {sanitizeText(finding.quote, 800)}
              </p>
            </div>
          )}

          {(finding.location || finding.confidenceRationale || finding.searchQueries?.length) && (
            <div className="rounded border p-3 text-sm">
              {finding.location && (
                <p className="text-muted-foreground">
                  {formatAuditLocation(finding.location, locale)}
                </p>
              )}
              {finding.confidenceRationale && (
                <p className="mt-2 text-muted-foreground">
                  <span className="font-medium">{labels.confidenceRationale}: </span>
                  {sanitizeText(finding.confidenceRationale, 500)}
                </p>
              )}
              {finding.searchQueries?.length ? (
                <p dir="auto" className="mt-2 text-xs text-muted-foreground">
                  {labels.search}: {finding.searchQueries.map((query) => sanitizeText(query, 160)).join(" | ")}
                </p>
              ) : null}
            </div>
          )}

          {finding.sources?.map((s, i) => {
            const publishedLabel = s.publishedDate ? formatShortDate(s.publishedDate) : "";
            return (
            <article key={`s-${i}`} className="rounded border p-3">
              <a
                href={safeHref(s.url)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium hover:underline"
              >
                {sanitizeText(s.title) || safeHref(s.url)}
              </a>
              {publishedLabel && (
                <Badge variant="secondary" className="ms-2">
                  {publishedLabel}
                </Badge>
              )}
              {typeof s.relevanceScore === "number" && (
                <Badge variant="outline" className="ms-2 text-xs">
                  {labels.similarity((s.relevanceScore * 100).toFixed(0))}
                </Badge>
              )}
              {s.quote && (
                <p dir="auto" className="mt-2 text-sm italic text-muted-foreground">
                  &ldquo;{sanitizeText(s.quote, 500)}&rdquo;
                </p>
              )}
            </article>
            );
          })}

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
                {labels.suggestedRewrite}
              </p>
              <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap">
                {sanitizeText(finding.rewrite)}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
