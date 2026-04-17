/**
 * CI drift guard: ensure dashboard mirrors of CLI code stay in sync.
 *
 * Phase 7 intentionally duplicates PROVIDER_REGISTRY and the cost estimator
 * between src/ (CLI) and dashboard/ (Next.js). This script extracts the
 * provider IDs per skill from both and fails if they diverge.
 *
 * Run in CI via: bun run scripts/check-registry-parity.ts
 */
import { readFileSync } from "fs";

interface SkillProviderMap {
  [skillId: string]: string[];
}

// Extract providers from PROVIDER_REGISTRY by skill
function extractProvidersPerSkill(text: string): SkillProviderMap {
  const result: SkillProviderMap = {};

  // Match each skill entry: "fact-check": [ {...}, {...} ]
  const skillRegex = /["']([a-z-]+)["']\s*:\s*\[([\s\S]*?)\]/g;
  let skillMatch: RegExpExecArray | null;

  while ((skillMatch = skillRegex.exec(text)) !== null) {
    const skillId = skillMatch[1];
    const providersBlock = skillMatch[2];

    // Extract id: "..." from each provider in this skill's array
    const providerIds: string[] = [];
    const idRegex = /id:\s*["']([^"']+)["']/g;
    let idMatch: RegExpExecArray | null;

    while ((idMatch = idRegex.exec(providersBlock)) !== null) {
      providerIds.push(idMatch[1]);
    }

    if (providerIds.length > 0) {
      result[skillId] = providerIds;
    }
  }

  return result;
}

export function assertRegistryParity(cli: SkillProviderMap, dash: SkillProviderMap): void {
  // Check that all skills exist in both and have matching providers in same order
  const allSkills = new Set([...Object.keys(cli), ...Object.keys(dash)]);

  for (const skill of allSkills) {
    const cliProviders = cli[skill];
    const dashProviders = dash[skill];

    if (!cliProviders) {
      throw new Error(`Skill '${skill}' missing in CLI registry`);
    }
    if (!dashProviders) {
      throw new Error(`Skill '${skill}' missing in dashboard registry`);
    }

    const cliKey = JSON.stringify(cliProviders);
    const dashKey = JSON.stringify(dashProviders);

    if (cliKey !== dashKey) {
      throw new Error(
        `Provider mismatch for skill '${skill}': CLI has [${cliProviders.join(", ")}], dashboard has [${dashProviders.join(", ")}]`
      );
    }
  }
}

const files = [
  { path: "src/providers/registry.ts", label: "CLI registry" },
  { path: "dashboard/src/lib/providers.ts", label: "Dashboard registry" },
];

const contents = files.map(f => ({ ...f, text: readFileSync(f.path, "utf-8") }));
const [cli, dash] = contents.map(c => extractProvidersPerSkill(c.text));

try {
  assertRegistryParity(cli, dash);
  const totalSkills = Object.keys(cli).length;
  console.log(`Registry parity OK: ${totalSkills} skills match between CLI and dashboard.`);
} catch (err) {
  console.error(`Registry drift detected between ${files[0].path} and ${files[1].path}`);
  console.error(`  Error: ${(err as Error).message}`);
  process.exit(1);
}
