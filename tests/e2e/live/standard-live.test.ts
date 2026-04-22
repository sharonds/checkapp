import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { allocateTempPaths } from "../helpers/temp-paths.ts";

// Live Standard tier smoke. Runs a real Gemini 3.1 Pro + Google Search
// grounding call on a short article and asserts the grounded skill
// produced findings with at least one source citation.
//
// Requirements (test skips if missing):
//   - GEMINI_API_KEY
//   - CHECKAPP_ALLOW_LIVE_PROVIDERS=1
//
// Cost per run: ~$0.20.

function loadRepoDotenv(): Record<string, string> {
  const repoRoot = process.cwd();
  const candidates = [join(repoRoot, ".env"), join(repoRoot, "..", "..", "..", ".env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return out;
  }
  return {};
}

describe("LIVE — Standard tier against real Gemini grounded", () => {
  const dotenv = loadRepoDotenv();
  const geminiKey = process.env.GEMINI_API_KEY ?? dotenv.GEMINI_API_KEY;
  const live = process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS === "1";

  it(
    "runs grounded fact-check end-to-end with real Gemini",
    async () => {
      if (!live) {
        console.log("SKIPPED: set CHECKAPP_ALLOW_LIVE_PROVIDERS=1 to run the live lane");
        return;
      }
      if (!geminiKey) {
        console.log("SKIPPED: GEMINI_API_KEY missing");
        return;
      }

      const temp = allocateTempPaths();
      temp.initDbSchema();
      temp.writeConfig({
        geminiApiKey: geminiKey,
        llmProvider: "gemini",
        factCheckTier: "standard",
        factCheckTierFlag: true,
        providers: { "fact-check": { provider: "gemini-grounded", apiKey: geminiKey } },
        skills: { factCheck: true, plagiarism: false, aiDetection: false, seo: false },
      });

      const articlePath = join(temp.dir, "article.md");
      writeFileSync(
        articlePath,
        "Coffee contains caffeine, a stimulant that improves alertness. The human heart has four chambers.",
      );

      try {
        const proc = Bun.spawn(["bun", "src/index.tsx", articlePath], {
          env: {
            ...process.env,
            CHECKAPP_CONFIG_PATH: temp.configPath,
            CHECKAPP_DB_PATH: temp.dbPath,
            CHECKAPP_ALLOW_LIVE_PROVIDERS: "1",
            GEMINI_API_KEY: geminiKey,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        await proc.exited;
        const combined = stdout + stderr;

        if (proc.exitCode !== 0) {
          throw new Error(`CLI exited ${proc.exitCode}.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
        }

        // The grounded skill's summary/findings should be present.
        expect(combined).toMatch(/Fact Check|Grounded|grounded/i);
        // Real grounded run names the provider in the CLI summary.
        expect(combined).toMatch(/gemini-grounded/);
        // And reports a non-zero number of claims checked.
        expect(combined).toMatch(/[1-9]\d*\s*claims?\s+checked/i);
      } finally {
        temp.cleanup();
      }
    },
    240_000,
  );
});
