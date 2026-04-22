import { isE2E } from "../e2e/mode.ts";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL_PRO = "gemini-3.1-pro-preview";
const DEFAULT_MODEL_FLASH = "gemini-3-flash-preview";
const DEFAULT_MODEL_DEEP_RESEARCH = "deep-research-preview-04-2026";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export type GeminiTask = "chat" | "grounded" | "deep-research";

export interface GeminiModels {
  pro: string;
  flash: string;
  deepResearch: string;
}

export interface GeminiHealth {
  pro: boolean;
  grounding: boolean;
  deepResearch: boolean;
  checkedAt: number;
}

export interface GeminiCapability {
  models: GeminiModels;
  checkHealth(): Promise<GeminiHealth>;
  getModel(task: GeminiTask): string;
}

export interface GeminiCapabilityOptions {
  apiKey?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface CachedHealthEntry {
  value: GeminiHealth;
  expiresAt: number;
}

const globalCachedHealth = new Map<string, CachedHealthEntry>();
const globalInFlight = new Map<string, Promise<GeminiHealth>>();

export function createGeminiCapability(options: GeminiCapabilityOptions = {}): GeminiCapability {
  const models = resolveModels();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const getFetch = () => options.fetch ?? globalThis.fetch;
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  const cacheKey = `${apiKey}::${models.pro}::${models.flash}::${models.deepResearch}`;

  async function checkHealth(): Promise<GeminiHealth> {
    const current = now();
    const cached = globalCachedHealth.get(cacheKey);
    if (cached && cached.expiresAt > current) {
      return cached.value;
    }
    const inFlight = globalInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const pending = runHealthChecks()
      .then((health) => {
        globalCachedHealth.set(cacheKey, {
          value: health,
          expiresAt: now() + cacheTtlMs,
        });
        return health;
      })
      .finally(() => {
        globalInFlight.delete(cacheKey);
      });

    globalInFlight.set(cacheKey, pending);
    return pending;
  }

  async function runHealthChecks(): Promise<GeminiHealth> {
    const checkedAt = now();
    // E2E: capability health always reports healthy without hitting the network.
    if (isE2E()) {
      return {
        pro: true,
        grounding: true,
        deepResearch: true,
        checkedAt,
      };
    }
    if (!apiKey) {
      return {
        pro: false,
        grounding: false,
        deepResearch: false,
        checkedAt,
      };
    }

    const [pro, grounding, deepResearch] = await Promise.all([
      probeModel(`${baseUrl}/models/${models.pro}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      }),
      probeModel(`${baseUrl}/models/${models.pro}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      }),
      probeModel(`${baseUrl}/interactions?key=${encodeURIComponent(apiKey)}`, {
        input: "ping",
        agent: models.deepResearch,
        // Gemini requires background=true AND store=true for agent
        // interactions — anything else returns HTTP 400. This creates a
        // real background job every probe, but it's cheap (~1 prompt-level
        // token) and the 5-min health cache keeps the frequency low.
        background: true,
        store: true,
        agent_config: {
          type: "deep-research",
          thinking_summaries: "auto",
          visualization: "off",
        },
      }),
    ]);

    return {
      pro,
      grounding,
      deepResearch,
      checkedAt,
    };
  }

  return {
    models,
    checkHealth,
    getModel(task: GeminiTask): string {
      const health = globalCachedHealth.get(cacheKey)?.value;
      switch (task) {
        case "chat":
          return health && !health.pro ? models.flash : models.pro;
        case "grounded":
          return health && !health.grounding ? models.flash : models.pro;
        case "deep-research":
          return health && !health.deepResearch ? models.pro : models.deepResearch;
        default:
          throw new Error(`Unsupported Gemini task: ${task}`);
      }
    },
  };

  async function probeModel(url: string, body: unknown): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await getFetch()(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const geminiCapability = createGeminiCapability();

export function primeGeminiCapabilityHealthCheck(
  options?: Pick<GeminiCapabilityOptions, "apiKey" | "baseUrl" | "cacheTtlMs" | "fetch" | "now" | "timeoutMs">,
): Promise<GeminiHealth> {
  return options ? createGeminiCapability(options).checkHealth() : geminiCapability.checkHealth();
}

export function resetGeminiCapabilityHealthCache(): void {
  globalCachedHealth.clear();
  globalInFlight.clear();
}

function resolveModels(): GeminiModels {
  return {
    pro: process.env.GEMINI_MODEL_PRO ?? DEFAULT_MODEL_PRO,
    flash: process.env.GEMINI_MODEL_FLASH ?? DEFAULT_MODEL_FLASH,
    deepResearch: process.env.GEMINI_MODEL_DEEP_RESEARCH ?? DEFAULT_MODEL_DEEP_RESEARCH,
  };
}
