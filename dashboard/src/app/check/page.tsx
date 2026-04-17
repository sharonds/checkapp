"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Upload, FileText, Link2, AlertCircle } from "lucide-react";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";
import { FooterBar } from "@/components/footer-bar";
import { SkillCard, type SkillResult } from "@/components/skill-card";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type InputMode = "paste" | "file" | "url";

interface CheckResult {
  id: number;
  results: SkillResult[];
}

interface EstimateState {
  total: number;
  perSkill: Record<string, number>;
  warnings: string[];
}

export default function CheckPage() {
  const [pastedText, setPastedText] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<InputMode>("paste");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [estimate, setEstimate] = useState<EstimateState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounced cost estimate: re-fetch whenever the pasted text stabilises.
  useEffect(() => {
    const wc = pastedText.trim().split(/\s+/).filter(Boolean).length;
    if (wc < 20) {
      setEstimate(null);
      return;
    }
    const t = setTimeout(async () => {
      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      try {
        const res = await fetch("/api/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordCount: wc }),
          signal: abortControllerRef.current.signal,
        });
        if (res.ok) setEstimate(await res.json());
      } catch (err) {
        // Ignore abort errors (expected when inputs change)
        if (err instanceof Error && err.name !== "AbortError") {
          /* ignore — estimate is best-effort */
        }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [pastedText]);

  async function readFileContent(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(f);
    });
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);

    if (activeTab === "url") {
      setError(
        "URL checking coming soon -- paste the article text directly for now."
      );
      return;
    }

    let text = "";
    let source = "paste";

    if (activeTab === "paste") {
      text = pastedText.trim();
      if (!text) {
        setError("Please paste some article text.");
        return;
      }
    } else if (activeTab === "file") {
      if (!file) {
        setError("Please select a file.");
        return;
      }
      text = await readFileContent(file);
      source = file.name;
    }

    setLoading(true);
    try {
      const res = await fetchWithCsrf("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source, tags }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Check failed with status ${res.status}`
        );
      }
      await res.json();

      // Fetch the full check to get results
      const checksRes = await fetch("/api/checks?limit=1");
      if (checksRes.ok) {
        const checks = await checksRes.json();
        if (Array.isArray(checks) && checks.length > 0) {
          const checkData = checks[0];
          setResult({
            id: checkData.id,
            results: checkData.results ?? [],
          });
          const overallScore = checkData.overallScore ?? checkData.score;
          if (overallScore != null) {
            toast.success(`Check complete — score ${overallScore}/100`);
          } else {
            toast.success("Check complete");
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred.";
      setError(errorMessage);
      toast.error("Check failed: " + errorMessage);
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Run Check</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit article text or a file to run plagiarism, AI detection, SEO,
          and more.
        </p>

        <div className="mt-6 max-w-2xl space-y-6">
          <Tabs
            defaultValue={0}
            onValueChange={(val) => {
              const modes: InputMode[] = ["paste", "file", "url"];
              setActiveTab(modes[val as number] ?? "paste");
            }}
          >
            <TabsList>
              <TabsTrigger value={0}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Paste Text
              </TabsTrigger>
              <TabsTrigger value={1}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Upload File
              </TabsTrigger>
              <TabsTrigger value={2}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Paste URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value={0} className="mt-4">
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste your article text here..."
                rows={8}
                className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              />
              {pastedText && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {pastedText.length.toLocaleString()} characters
                </p>
              )}
              {estimate && (estimate.total > 0 || estimate.warnings.length > 0) && (
                <div className="mt-2 text-sm">
                  {estimate.total > 0 && (
                    <p>
                      Estimated cost:{" "}
                      <strong>${estimate.total.toFixed(4)}</strong>
                    </p>
                  )}
                  {estimate.warnings.map((w, i) => (
                    <p key={i} className="mt-1 text-xs text-amber-700">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value={1} className="mt-4">
              <Card>
                <CardContent className="py-6">
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="h-8 w-8 text-muted-foreground/60" />
                    <div className="text-center">
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer text-sm font-medium text-primary hover:underline"
                      >
                        Choose a file
                      </label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Accepts .md and .txt files
                      </p>
                    </div>
                    <input
                      id="file-upload"
                      type="file"
                      accept=".md,.txt"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {file && (
                      <div className="mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span>{file.name}</span>
                        <span className="text-muted-foreground">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value={2} className="mt-4">
              <input
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://docs.google.com/document/d/..."
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                URL checking coming soon. Paste the article text directly for
                now.
              </p>
            </TabsContent>
          </Tabs>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Tags (optional)
            </label>
            <TagInput
              tags={tags}
              onAdd={(t) => setTags((prev) => [...prev, t])}
              onRemove={(t) => setTags((prev) => prev.filter((x) => x !== t))}
            />
          </div>

          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running check...
              </>
            ) : (
              "Run Check"
            )}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Results</h2>
                <Link
                  href={`/reports/${result.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View full report
                </Link>
              </div>
              {result.results.length > 0 ? (
                <div className="space-y-3">
                  {result.results.map((r) => (
                    <SkillCard key={r.skillId} result={r} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Check completed but no skill results were returned.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <FooterBar />
    </div>
  );
}
