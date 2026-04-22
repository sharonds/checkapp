import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkills, runCheckHeadless, selectFactCheckSkill } from "./checker.ts";
import { readConfig } from "./config.ts";
import { openDb } from "./db.ts";

function buildBaseConfig() {
  const config = readConfig();
  config.skills = {
    plagiarism: false,
    aiDetection: false,
    seo: false,
    factCheck: false,
    tone: false,
    legal: false,
    summary: false,
    brief: false,
    purpose: false,
    grammar: false,
    academic: false,
    selfPlagiarism: false,
  };
  return config;
}

describe("runCheckHeadless", () => {
  it("returns results with correct structure", async () => {
    const config = buildBaseConfig();
    config.skills.seo = true;

    const result = await runCheckHeadless("test-input", {
      text: "This is a test article about TypeScript development. It has enough words to be meaningful for SEO analysis but not too many to slow down the test.",
      config,
      dbPath: ":memory:",
    });

    expect(result.id).toBeGreaterThan(0);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.results).toHaveLength(1); // only SEO enabled
    expect(result.results[0].skillId).toBe("seo");
    expect(result.results[0].score).toBeGreaterThanOrEqual(0);
    expect(result.results[0].score).toBeLessThanOrEqual(100);
  });

  it("returns empty results when no skills enabled", async () => {
    const config = buildBaseConfig();

    const result = await runCheckHeadless("test-input", {
      text: "Some text",
      config,
      dbPath: ":memory:",
    });

    expect(result.results).toHaveLength(0);
    expect(result.totalCostUsd).toBe(0);
  });

  it("saves check to DB and returns a valid id", async () => {
    const config = buildBaseConfig();
    config.skills.seo = true;

    const result = await runCheckHeadless("db-test-source", {
      text: "# Test Heading\n\nA longer paragraph with several sentences. This helps the SEO check produce a more realistic result. We want to verify that the database insert works correctly.",
      config,
      dbPath: ":memory:",
    });

    expect(result.id).toBeGreaterThan(0);
    expect(result.source).toBe("db-test-source");
    expect(result.totalCostUsd).toBe(0); // SEO is free
  });

  it("persists article text for headless checks", async () => {
    const config = buildBaseConfig();
    const tempDir = mkdtempSync(join(tmpdir(), "checkapp-checker-test-"));
    const dbPath = join(tempDir, "history.db");
    const articleText = "Stored article text for deep audit follow-up.";

    try {
      const result = await runCheckHeadless("persisted-source", {
        text: articleText,
        config,
        dbPath,
      });

      const db = openDb(dbPath);
      try {
        const row = db.query<{ article_text: string }, [number]>(
          "SELECT article_text FROM checks WHERE id = ?"
        ).get(result.id);
        expect(row?.article_text).toBe(articleText);
      } finally {
        db.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("emits tier.selected telemetry for headless checks", async () => {
    const config = buildBaseConfig();
    const tempDir = mkdtempSync(join(tmpdir(), "checkapp-checker-events-"));
    const dbPath = join(tempDir, "history.db");
    const eventsPath = join(tempDir, "audit-events.jsonl");
    process.env.CHECKAPP_AUDIT_EVENTS_PATH = eventsPath;

    try {
      config.skills.factCheck = true;
      config.factCheckTierFlag = true;
      config.factCheckTier = "standard";

      await runCheckHeadless("telemetry-source", {
        text: "Claim without supporting context.",
        config,
        dbPath,
        telemetrySource: "mcp",
      });

      const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
      const tierEvent = lines
        .map((line) => JSON.parse(line))
        .find((entry) => entry.event === "tier.selected");

      expect(tierEvent).toBeDefined();
      expect(tierEvent.payload).toMatchObject({
        source: "mcp",
        requestedTier: "standard",
        effectiveTier: "standard",
        flagOn: true,
        selectedImplementation: "grounded",
        selectedSkillId: "fact-check-grounded",
      });
    } finally {
      delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("fact-check tier routing", () => {
  it("defaults to basic when the tier flag is off", () => {
    const config = buildBaseConfig();
    config.skills.factCheck = true;
    config.factCheckTier = "standard";
    config.factCheckTierFlag = false;

    const selection = selectFactCheckSkill(config).selection;
    const skills = buildSkills(config);

    expect(selection.flagOn).toBe(false);
    expect(selection.effectiveTier).toBe("basic");
    expect(selection.selectedSkillId).toBe("fact-check");
    expect(skills.map((skill) => skill.id)).toContain("fact-check");
    expect(skills.map((skill) => skill.id)).not.toContain("fact-check-grounded");
  });

  it("defaults to basic when the tier flag is on but tier is unset", () => {
    const config = buildBaseConfig();
    config.skills.factCheck = true;
    config.factCheckTierFlag = true;
    config.factCheckTier = undefined;

    const selection = selectFactCheckSkill(config).selection;

    expect(selection.flagOn).toBe(true);
    expect(selection.effectiveTier).toBe("basic");
    expect(selection.selectedSkillId).toBe("fact-check");
  });

  it("routes standard tier to grounded fact-check", () => {
    const config = buildBaseConfig();
    config.skills.factCheck = true;
    config.factCheckTierFlag = true;
    config.factCheckTier = "standard";

    const selection = selectFactCheckSkill(config).selection;
    const skills = buildSkills(config);

    expect(selection.effectiveTier).toBe("standard");
    expect(selection.selectedImplementation).toBe("grounded");
    expect(selection.selectedSkillId).toBe("fact-check-grounded");
    expect(skills.map((skill) => skill.id)).toContain("fact-check-grounded");
    expect(skills.map((skill) => skill.id)).not.toContain("fact-check");
  });

  it("keeps premium tier on the basic sync fact-check path", () => {
    const config = buildBaseConfig();
    config.skills.factCheck = true;
    config.factCheckTierFlag = true;
    config.factCheckTier = "premium";

    const selection = selectFactCheckSkill(config).selection;
    const skills = buildSkills(config);

    expect(selection.effectiveTier).toBe("premium");
    expect(selection.selectedImplementation).toBe("basic");
    expect(selection.selectedSkillId).toBe("fact-check");
    expect(skills.map((skill) => skill.id)).toContain("fact-check");
    expect(skills.map((skill) => skill.id)).not.toContain("fact-check-grounded");
  });
});
