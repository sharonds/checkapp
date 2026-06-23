/** Pure check pipeline — text + config → skill results. */

import { SkillRegistry } from "./skills/registry.ts";
import { applyThreshold } from "./thresholds.ts";
import { buildSkills, type RunCheckHooks } from "./checker.ts";
import { openDb, loadAllContexts, type DB } from "./db.ts";
import { analyzeDocument } from "./audit/document.ts";
import type { Config } from "./config.ts";
import type { SkillResult } from "./skills/types.ts";
import type { AuditRecord } from "./audit/types.ts";

export interface CoreResult {
  results: SkillResult[];
  totalCostUsd: number;
  audit?: AuditRecord;
}

/** Pure pipeline: text + config → skill results. No DB write, no I/O beyond skills' own network calls. */
export async function runCheckCore(text: string, config: Config, hooks?: RunCheckHooks): Promise<CoreResult> {
  const skills = buildSkills(config, hooks);
  const registry = new SkillRegistry(skills);
  const raw = await registry.runAllWithAudit(text, config);
  const results = raw.results.map(r => ({
    ...r,
    verdict: applyThreshold(r.score, r.verdict, config.thresholds?.[r.skillId]),
  }));
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  // The merged record-level audit can lose its top-level language/direction (the
  // per-skill audits carry it, but the merge starts from a record that may have
  // none). Stamp it from the article so the HTML report renders in the right
  // language and direction (e.g. RTL Hebrew) instead of defaulting to English.
  let audit = raw.audit;
  if (audit && (!audit.language || !audit.direction)) {
    const doc = analyzeDocument(text);
    audit = {
      ...audit,
      language: audit.language ?? doc.language,
      direction: audit.direction ?? doc.direction,
    };
  }
  return { results, totalCostUsd, audit };
}

/** Load DB contexts and return config with contexts attached. Caller owns db.close(). */
export function loadContextsIntoConfig(config: Config, dbPath?: string): { config: Config; db: DB } {
  const db = openDb(dbPath);
  const contexts = loadAllContexts(db);
  return { config: { ...config, contexts }, db };
}
