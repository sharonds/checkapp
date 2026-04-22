import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FactCheckDeepResearchSkill } from "../../../src/skills/factcheck-deep-research.ts";
import { primeGeminiCapabilityHealthCheck, resetGeminiCapabilityHealthCache } from "../../../src/providers/gemini-capability.ts";
import type { Config } from "../../../src/config.ts";
import { allocateTempPaths } from "../helpers/temp-paths.ts";

// Live Premium tier smoke. Calls the real Gemini Deep Research API, which
// runs asynchronously for 5–15 min. We initiate an audit, poll until the
// interaction reaches a terminal state, and assert the completed SkillResult
// carries a real audit report in its findings.
//
// Requirements (test skips if missing):
//   - GEMINI_API_KEY
//   - CHECKAPP_ALLOW_LIVE_PROVIDERS=1
//
// Cost per run: ~$1.50. Keep this sparse.

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

const POLL_INTERVAL_MS = 20_000; // per deep-audit architecture §7
const MAX_WALL_MS = 20 * 60_000; // 20 min hard cap

describe("LIVE — Premium tier against real Gemini Deep Research", () => {
  const dotenv = loadRepoDotenv();
  const geminiKey = process.env.GEMINI_API_KEY ?? dotenv.GEMINI_API_KEY;
  const live = process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS === "1";

  it(
    "initiates and polls a real Deep Research audit to completion",
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

      // Prime capability health check so getModel("deep-research") returns the
      // real model id (not a fallback to pro).
      resetGeminiCapabilityHealthCache();
      await primeGeminiCapabilityHealthCheck({ apiKey: geminiKey });

      const article =
        "Coffee contains caffeine, a stimulant that improves alertness and focus. " +
        "The human heart has four chambers: two atria and two ventricles. " +
        "Most adults require between seven and nine hours of sleep per night.";

      const skill = new FactCheckDeepResearchSkill({ dbPath: temp.dbPath });
      const config = { geminiApiKey: geminiKey } as Config;

      try {
        console.log("[premium-live] initiating Deep Research audit…");
        const init = await skill.initiate(article, "content_hash", "live_premium_smoke", config, "cli");
        expect(init.interactionId).toBeTruthy();
        expect(["pending", "in_progress"]).toContain(init.status);
        console.log(`[premium-live] interaction_id=${init.interactionId}, polling every ${POLL_INTERVAL_MS / 1000}s…`);

        const deadline = Date.now() + MAX_WALL_MS;
        let pollCount = 0;
        let result = null;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          pollCount++;
          const elapsed = ((Date.now() - (deadline - MAX_WALL_MS)) / 1000).toFixed(0);
          result = await skill.fetchResult(init.interactionId!, config);
          console.log(`[premium-live] poll ${pollCount} (t+${elapsed}s): ${result ? `verdict=${result.verdict}` : "still in_progress"}`);
          if (result !== null) break;
        }

        if (result === null) {
          throw new Error(`Deep Research audit did not terminate within ${MAX_WALL_MS / 60000} minutes`);
        }

        // Terminal state reached.
        expect(["pass", "fail"]).toContain(result.verdict);
        if (result.verdict === "pass") {
          // Completed — the audit body should be in findings.
          expect(result.findings.length).toBeGreaterThan(0);
          const body = result.findings.map((f) => f.text).join("\n");
          // A real audit contains claim-by-claim language or a verdict phrasing.
          expect(body.length).toBeGreaterThan(200);
          expect(body).toMatch(/claim|supported|evidence|verdict/i);
          console.log(`[premium-live] audit completed (${body.length} chars, cost ≈ $${result.costUsd?.toFixed(2)})`);
        } else {
          // Failed — the error reason should be in summary.
          console.warn(`[premium-live] audit terminated as failed: ${result.summary}`);
          expect(result.summary).toBeTruthy();
        }
      } finally {
        temp.cleanup();
      }
    },
    MAX_WALL_MS + 60_000,
  );
});
