import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getScenario } from "./mode.ts";

export interface ScenarioExaResult {
  url: string;
  title: string;
  text: string;
  highlights: string[];
}

export interface ScenarioGroundedClaim {
  claim: string;
  supported: boolean | null;
  note: string;
  sources: string[];
}

export interface ScenarioDeepResearchPollState {
  status: "in_progress" | "completed" | "failed";
  outputs?: Array<{ text: string }>;
  error?: string;
}

export interface Scenario {
  name: string;
  article: string;
  tier: "basic" | "standard" | "premium";
  flagOn: boolean;
  providers: {
    // Legacy single-response field. If set, used as a fallback for any LLM call.
    minimax?: { text: string };
    geminiChat?: { text: string };
    // Preferred: give separate stubs for the two LLM phases the checker calls.
    // extractClaims: JSON array of claim strings.
    // assessClaim:   JSON object {supported, note, claimType}.
    llm?: {
      extractClaims?: string;
      assessClaim?: string;
    };
    exa?: { results: ScenarioExaResult[] };
    geminiGrounded?: { claims: ScenarioGroundedClaim[] };
    deepResearch?: {
      initiateResponse: { interaction_id: string };
      pollStates: ScenarioDeepResearchPollState[];
    };
  };
  expect: {
    reportVerdict?: "pass" | "warn" | "fail" | "skipped";
    uiContains?: string[];
  };
}

// src/e2e/fixtures.ts → repo-root/tests/e2e/fixtures. Anchor via import.meta
// so it works regardless of process.cwd() (dashboard server cwd = dashboard/).
// Override with CHECKAPP_E2E_FIXTURES_DIR if fixtures move.
const __thisDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = process.env.CHECKAPP_E2E_FIXTURES_DIR ?? join(__thisDir, "..", "..", "tests", "e2e", "fixtures");

export function loadScenario(name?: string): Scenario {
  const scenarioName = name ?? getScenario();
  if (!scenarioName) {
    throw new Error(
      "No scenario selected: pass a name or set CHECKAPP_E2E_SCENARIO.",
    );
  }
  const path = join(FIXTURES_DIR, `${scenarioName}.json`);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Scenario;
  if (!parsed.name) parsed.name = scenarioName;
  return parsed;
}
