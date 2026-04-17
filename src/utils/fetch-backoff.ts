export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asNum = Number(header);
  if (Number.isFinite(asNum)) return asNum * 1000;
  const t = Date.parse(header);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return null;
}

export interface BackoffOpts {
  maxRetries?: number;
  baseDelayMs?: number;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
}

export async function fetchWithBackoff(url: string, opts: BackoffOpts = {}): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  if (maxRetries < 0) throw new Error(`maxRetries must be >= 0 (got ${maxRetries})`);
  const f = opts.fetchImpl ?? fetch;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    try {
      const res = await f(url, opts.init);
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt, baseDelayMs);
        if (attempt === maxRetries) return res;
        await sleep(wait);
        attempt++;
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt === maxRetries) throw lastErr;
      await sleep(backoffMs(attempt, baseDelayMs));
      attempt++;
    }
  }
  throw lastErr ?? new Error(`fetchWithBackoff exhausted ${maxRetries} retries`);
}

function backoffMs(attempt: number, base: number) {
  return base * Math.pow(2, attempt);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
