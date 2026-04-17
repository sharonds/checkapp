/** Pure check pipeline — text + config → skill results. */

import { SkillRegistry } from "./skills/registry.ts";
import { applyThreshold } from "./thresholds.ts";
import { buildSkills } from "./checker.ts";
import { openDb, loadAllContexts, type DB } from "./db.ts";
import type { Config } from "./config.ts";
import type { SkillResult } from "./skills/types.ts";

export interface CoreResult {
  results: SkillResult[];
  totalCostUsd: number;
}

/** Pure pipeline: text + config → skill results. No DB write, no I/O beyond skills' own network calls. */
export async function runCheckCore(text: string, config: Config): Promise<CoreResult> {
  const skills = buildSkills(config);
  const registry = new SkillRegistry(skills);
  const raw = await registry.runAll(text, config);
  const results = raw.map(r => ({
    ...r,
    verdict: applyThreshold(r.score, r.verdict, config.thresholds?.[r.skillId]),
  }));
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  return { results, totalCostUsd };
}

/** Load DB contexts and return config with contexts attached. Caller owns db.close(). */
export function loadContextsIntoConfig(config: Config, dbPath?: string): { config: Config; db: DB } {
  const db = openDb(dbPath);
  const contexts = loadAllContexts(db);
  return { config: { ...config, contexts }, db };
}
