import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, insertContext } from "../../src/db.ts";
import { runCheckHeadless } from "../../src/checker.ts";
import { runCheckCore, loadContextsIntoConfig } from "../../src/checker-core.ts"; // added in B0.2
import { readConfig } from "../../src/config.ts";

describe("CLI parity", () => {
  let tmp: string;
  let dbPath: string;
  const article =
    "Artificial intelligence is transforming industries around the world today. " +
    "Machine learning models solve previously intractable problems across healthcare and finance.";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "checkapp-parity-"));
    dbPath = join(tmp, "history.db");
    const db = openDb(dbPath);
    insertContext(db, { type: "tone", name: "Brand voice", content: "Warm, concise, no jargon." });
    db.close();
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("CLI-core and headless produce identical results when DB contexts exist", async () => {
    const filePath = join(tmp, "a.md");
    writeFileSync(filePath, article);

    // Headless path — full flow including DB insert
    const headless = await runCheckHeadless(filePath, { text: article, dbPath });

    // CLI-core path — mirrors what <Check> does (load contexts → runCheckCore), no DB insert
    const baseCfg = readConfig();
    const { config: cfgWithContexts } = loadContextsIntoConfig(baseCfg, dbPath);
    const cliCore = await runCheckCore(article, cfgWithContexts);

    expect(cliCore.results.map(r => r.skillId).sort())
      .toEqual(headless.results.map(r => r.skillId).sort());

    // Tone skill is the canary — it reads from config.contexts. If context loading
    // is broken on either path, tone's verdict will differ.
    const toneCli = cliCore.results.find(r => r.skillId === "tone");
    const toneHeadless = headless.results.find(r => r.skillId === "tone");
    expect(toneCli?.verdict).toBe(toneHeadless?.verdict);
    expect(toneCli?.summary).toBe(toneHeadless?.summary);
  });
});
