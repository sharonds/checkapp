/**
 * CI drift guard: ensure dashboard mirrors of CLI code stay in sync.
 *
 * Phase 7 intentionally duplicates PROVIDER_REGISTRY and the cost estimator
 * between src/ (CLI) and dashboard/ (Next.js). This script extracts the
 * provider IDs from both and fails if they diverge.
 *
 * Run in CI via: bun run scripts/check-registry-parity.ts
 */
import { readFileSync } from "fs";

const files = [
  { path: "src/providers/registry.ts", label: "CLI registry" },
  { path: "dashboard/src/lib/providers.ts", label: "Dashboard registry" },
];

const contents = files.map(f => ({ ...f, text: readFileSync(f.path, "utf-8") }));

// Extract all 'id: "<id>"' occurrences inside PROVIDER_REGISTRY entries.
const extractIds = (text: string): string[] => {
  const regex = /id:\s*"([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) out.push(m[1]);
  return out.sort();
};

const [cli, dash] = contents.map(c => extractIds(c.text));

const cliKey = JSON.stringify(cli);
const dashKey = JSON.stringify(dash);

if (cliKey !== dashKey) {
  console.error(`Registry drift detected between ${files[0].path} and ${files[1].path}`);
  console.error(`  CLI (${cli.length}):       ${cliKey}`);
  console.error(`  Dashboard (${dash.length}): ${dashKey}`);
  const missingInDash = cli.filter(x => !dash.includes(x));
  const missingInCli = dash.filter(x => !cli.includes(x));
  if (missingInDash.length) console.error(`  Missing in dashboard: ${missingInDash.join(", ")}`);
  if (missingInCli.length) console.error(`  Missing in CLI:       ${missingInCli.join(", ")}`);
  process.exit(1);
}

console.log(`Registry parity OK: ${cli.length} providers match between CLI and dashboard.`);
