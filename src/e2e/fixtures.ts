import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    minimax?: { text: string };
    exa?: { results: ScenarioExaResult[] };
    geminiChat?: { text: string };
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

const FIXTURES_DIR = join(process.cwd(), "tests/e2e/fixtures");

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
