#!/usr/bin/env bun
import { configExists } from "./config.ts";
import { runSetup } from "./setup.tsx";
import { runCheck } from "./check.tsx";

const args = process.argv.slice(2);
const forceSetup = args.includes("--setup");
const docUrl = args.find((a) => !a.startsWith("--"));

async function main() {
  const needsSetup = forceSetup || !configExists();

  if (needsSetup) {
    await runSetup();
    // If they only ran --setup with no URL, exit cleanly
    if (!docUrl) process.exit(0);
  }

  if (!docUrl) {
    console.log("");
    console.log("Usage:");
    console.log("  article-checker <google-doc-url>");
    console.log("");
    console.log("Examples:");
    console.log('  article-checker "https://docs.google.com/document/d/XXXX/edit"');
    console.log("");
    console.log("Options:");
    console.log("  --setup   Re-run the credential setup wizard");
    console.log("");
    process.exit(0);
  }

  await runCheck(docUrl);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
