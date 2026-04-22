import { createServer } from "node:net";
import { join } from "node:path";

// Like dashboard-boot.ts but spawns `bun run start` (prod) instead of
// `bun run dev`. Assumes `cd dashboard && bun run build` has already run.
// Used by the hydration-narrowing diagnostic to tell us whether the bug
// is Turbopack-dev-only or also in prod.

export interface BootProdOptions {
  scenario: string;
  configPath: string;
  dbPath: string;
  csrfPath?: string;
  cwd?: string;
  startupTimeoutMs?: number;
}

export interface DashboardHandle {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("failed to pick port")));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`prod dashboard did not become ready at ${url} within ${timeoutMs}ms. Last error: ${String(lastErr)}`);
}

export async function bootDashboardProd(opts: BootProdOptions): Promise<DashboardHandle> {
  const repoRoot = opts.cwd ?? process.cwd();
  const dashboardDir = join(repoRoot, "dashboard");
  const port = await pickFreePort();
  const url = `http://127.0.0.1:${port}`;

  const proc = Bun.spawn(["bun", "run", "start", "--port", String(port)], {
    cwd: dashboardDir,
    env: {
      ...process.env,
      PORT: String(port),
      CHECKAPP_E2E: "1",
      CHECKAPP_E2E_SCENARIO: opts.scenario,
      CHECKAPP_CONFIG_PATH: opts.configPath,
      CHECKAPP_DB_PATH: opts.dbPath,
      ...(opts.csrfPath ? { CHECKAPP_CSRF_PATH: opts.csrfPath } : {}),
      CHECKAPP_ALLOW_LIVE_PROVIDERS: "0",
      NODE_ENV: "production",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const tail = { stdout: "", stderr: "" };
  function drain(stream: ReadableStream<Uint8Array> | null, key: "stdout" | "stderr") {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          tail[key] = (tail[key] + decoder.decode(value, { stream: true })).slice(-8192);
        }
      } catch {
        /* stream closed */
      }
    })();
  }
  drain(proc.stdout as unknown as ReadableStream<Uint8Array> | null, "stdout");
  drain(proc.stderr as unknown as ReadableStream<Uint8Array> | null, "stderr");

  try {
    await waitForReady(url, opts.startupTimeoutMs ?? 60_000);
  } catch (err) {
    proc.kill();
    throw new Error(
      `${(err as Error).message}\n--- stdout tail ---\n${tail.stdout}\n--- stderr tail ---\n${tail.stderr}`,
    );
  }

  return {
    url,
    port,
    async stop() {
      proc.kill();
      await proc.exited.catch(() => undefined);
    },
  };
}
