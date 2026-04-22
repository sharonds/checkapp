// Raw agent-browser eval wrapper. Returns stdout (typically the
// JSON-stringified result of the expression).
export async function spawnBrowserEval(expression: string): Promise<string> {
  const proc = Bun.spawn(["agent-browser", "eval", expression], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text()]);
  await proc.exited;
  return stdout;
}

// Asserts React has actually hydrated by counting DOM nodes with React fiber
// properties. Under a healthy React 19 render, some nodes have __reactFiber*
// or __reactProps* keys. Zero nodes means hydration never ran.
export async function assertHydrated(opts: { timeoutMs?: number } = {}): Promise<number> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  let lastCount = 0;
  while (Date.now() < deadline) {
    const result = await spawnBrowserEval(
      `(() => { const all = document.querySelectorAll('*'); let f = 0; for (const n of all) { for (const k of Object.keys(n)) { if (k.startsWith('__reactFiber') || k.startsWith('__reactProps')) { f++; break; } } } return f; })()`,
    );
    const parsed = Number.parseInt(result.replace(/\D/g, "") || "0", 10);
    lastCount = parsed;
    if (parsed > 0) return parsed;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Hydration did not happen within ${opts.timeoutMs ?? 10_000}ms. Last fiber count: ${lastCount}`,
  );
}
