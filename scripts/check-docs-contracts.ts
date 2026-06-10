import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`docs contract failed: ${message}`);
    process.exitCode = 1;
  }
}

const customSkills = read("docs/custom-skills.md");
const security = read("SECURITY.md");
const agents = read("AGENTS.md");
const api = read("docs/api.md");

assert(
  !customSkills.includes("run(text: string, config: Config): Promise<SkillResult>;"),
  "docs/custom-skills.md still documents the old Promise<SkillResult> skill contract",
);
assert(
  customSkills.includes("Promise<SkillRunOutput>"),
  "docs/custom-skills.md must document SkillRunOutput",
);
assert(
  customSkills.includes("{ result, audit }"),
  "docs/custom-skills.md must document the structured audit contribution return path",
);
assert(
  !security.includes("| Semantic Scholar | Academic citations | Query terms | (no key required) |"),
  "SECURITY.md still lists Semantic Scholar as the academic citation default",
);
assert(
  security.includes("| OpenAlex | Academic citations"),
  "SECURITY.md must list OpenAlex as the academic citation provider",
);
assert(
  agents.includes("segments[].text") && api.includes("segments[].text"),
  "AGENTS.md and docs/api.md must warn that detail audit payloads can include segments[].text article excerpts",
);

if (!process.exitCode) {
  console.log("Docs contract OK");
}
