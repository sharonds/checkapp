import { jsonWithCors } from "@/lib/cors";
import { getRecentChecks, addTagsToCheck, getDb, checks, type Check } from "@/lib/db";
import { desc, sql, and, gte } from "drizzle-orm";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const MAX_TEXT_LENGTH = 50_000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const checks = getRecentChecks(limit);
    const parsed = checks.map((c) => ({
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      results: JSON.parse(c.resultsJson),
    }));
    return jsonWithCors(parsed);
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch checks" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, source, tags } = body as { text?: string; source?: string; tags?: string[] };
    if (!text) return jsonWithCors({ error: "text is required" }, { status: 400 });
    if (text.length > MAX_TEXT_LENGTH) return jsonWithCors({ error: `text exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });

    // Write text to temp file
    const tmpDir = mkdtempSync(join(tmpdir(), "ac-"));
    const tmpFile = join(tmpDir, "article.txt");
    writeFileSync(tmpFile, text);

    // Shell out to CLI
    const cliPath = join(process.cwd(), "..", "src", "index.tsx");
    const startTime = new Date().toISOString();
    const result = await new Promise<{ id: number }>((resolve, reject) => {
      const child = spawn("bun", ["run", cliPath, tmpFile], {
        env: { ...process.env, ...(source ? { ARTICLE_CHECKER_SOURCE: source } : {}) },
        timeout: 120_000,
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => stderr += d.toString());
      child.on("close", (code) => {
        try { unlinkSync(tmpFile); } catch {}
        if (code !== 0) return reject(new Error(`CLI exited ${code}: ${stderr.slice(0, 200)}`));
        // Look up the check created by this specific CLI run using source + timestamp
        const db = getDb();
        const sourceLabel = source || tmpFile;
        const rows = db.select().from(checks)
          .where(and(
            sql`${checks.source} = ${sourceLabel}`,
            gte(checks.createdAt, startTime),
          ))
          .orderBy(desc(checks.id))
          .limit(1)
          .all();
        if (rows.length === 0) return reject(new Error("No DB record after check"));
        resolve({ id: rows[0].id! });
      });
    });

    // Apply tags
    if (tags?.length && result.id) {
      addTagsToCheck(result.id, tags);
    }

    return jsonWithCors(result, { status: 201 });
  } catch (err) {
    return jsonWithCors({ error: err instanceof Error ? err.message : "Check failed" }, { status: 500 });
  }
}
