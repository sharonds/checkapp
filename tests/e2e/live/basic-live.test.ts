import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { allocateTempPaths } from "../helpers/temp-paths.ts";

// Live Basic tier smoke. Runs a real Exa search + MiniMax (or Anthropic)
// assessment on a short, deliberately-verifiable article and asserts that
// a fact-check result comes back with exa-search as the provider.
//
// Requirements (test is skipped if missing):
//   - EXA_API_KEY
//   - MINIMAX_API_KEY or ANTHROPIC_API_KEY
//   - CHECKAPP_ALLOW_LIVE_PROVIDERS=1  (otherwise assertMocksOnly blocks calls)
//
// Cost per run: ~$0.05. Do NOT add this to CI.

function loadRepoDotenv(): Record<string, string> {
  const repoRoot = process.cwd();
  const candidates = [
    join(repoRoot, ".env"),
    join(repoRoot, "..", "..", "..", ".env"),
  ];
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

describe("LIVE — Basic tier against real Exa + LLM", () => {
  const dotenv = loadRepoDotenv();
  const exaKey = process.env.EXA_API_KEY ?? dotenv.EXA_API_KEY;
  const minimaxKey = process.env.MINIMAX_API_KEY ?? dotenv.MINIMAX_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? dotenv.ANTHROPIC_API_KEY;
  const live = process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS === "1";
  const hasLlm = !!minimaxKey || !!anthropicKey;

  it(
    "runs the basic fact-check pipeline end-to-end with real providers",
    async () => {
      if (!live) {
        console.log("SKIPPED: set CHECKAPP_ALLOW_LIVE_PROVIDERS=1 to run the live lane");
        return;
      }
      if (!exaKey || !hasLlm) {
        console.log(`SKIPPED: missing keys (exa=${!!exaKey} minimax=${!!minimaxKey} anthropic=${!!anthropicKey})`);
        return;
      }

      const temp = allocateTempPaths();
      temp.initDbSchema();
      const configObj: Record<string, unknown> = {
        exaApiKey: exaKey,
        providers: { "fact-check": { provider: "exa-search", apiKey: exaKey } },
        skills: { factCheck: true, plagiarism: false, aiDetection: false, seo: false },
      };
      if (minimaxKey) {
        configObj.minimaxApiKey = minimaxKey;
      } else {
        configObj.anthropicApiKey = anthropicKey;
        configObj.llmProvider = "anthropic";
      }
      temp.writeConfig(configObj);

      const articlePath = join(temp.dir, "article.md");
      writeFileSync(
        articlePath,
        "Coffee contains caffeine, a stimulant that improves alertness. The human heart has four chambers.",
      );

      try {
        const proc = Bun.spawn(
          ["bun", "src/index.tsx", articlePath],
          {
            env: {
              ...process.env,
              CHECKAPP_CONFIG_PATH: temp.configPath,
              CHECKAPP_DB_PATH: temp.dbPath,
              // Deliberately NOT setting CHECKAPP_E2E — we want real code paths.
              CHECKAPP_ALLOW_LIVE_PROVIDERS: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        await proc.exited;

        const combined = stdout + stderr;
        if (proc.exitCode !== 0) {
          throw new Error(`CLI exited ${proc.exitCode}.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
        }
        expect(combined).toMatch(/Fact Check/i);
        // A real Exa call should mention at least one source URL or a verdict line.
        expect(combined).toMatch(/Verified|Unsupported|Unverified|http|\.com|\.org|\.edu/i);
      } finally {
        temp.cleanup();
      }
    },
    180_000,
  );
});
