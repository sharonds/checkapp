import { isE2E } from "../e2e/mode.ts";

// Mirrors isValidGeminiModel in src/plagiarism-gemini.ts — defined here
// independently to avoid a reverse dependency from capability → plagiarism.
const GEMINI_MODEL_ID_RE = /^[a-zA-Z0-9._-]{1,80}$/;

/** Returns the env value if it passes the model-ID charset check, else the fallback. */
function sanitizeModelOverride(value: string | undefined, fallback: string): string {
  if (value !== undefined && GEMINI_MODEL_ID_RE.test(value)) {
    return value;
  }
  return fallback;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL_PRO = "gemini-3.1-pro-preview";
// Fallback when the pro model is unhealthy. gemini-3.5-flash was deprecated 2026-10-08.
const DEFAULT_MODEL_FLASH = "gemini-3.8-flash";
const DEFAULT_MODEL_DEEP_RESEARCH = "deep-research-preview-04-2026";
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Gemini's maxOutputTokens caps thinking + answer combined. Google's migration
 * checklist says to keep it at >= 32,768 and lower thinkingLevel to save tokens.
 * 65,536 is the synchronous output limit of current models.
 */
export const GEMINI_MIN_OUTPUT_TOKENS = 32_768;
export const GEMINI_MAX_OUTPUT_TOKENS = 65_536;

const COUNT_TOKENS_PING = { contents: [{ parts: [{ text: "ping" }] }] };
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

    // Free availability check: countTokens only runs the tokenizer, so it never starts a
    // Deep Research job (~$1-3 each) or bills a grounded search. It returns 404 for retired
    // models, which GET /models/{id} does not. Grounding is a tool on the pro model, so its
    // health follows the pro probe instead of spending a billed search query.
    const [pro, deepResearch] = await Promise.all([
      probeModel(`${baseUrl}/models/${models.pro}:countTokens`, COUNT_TOKENS_PING),
      probeModel(`${baseUrl}/models/${models.deepResearch}:countTokens`, COUNT_TOKENS_PING),
    ]);
    const grounding = pro;

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
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
  return createGeminiCapability(options).checkHealth();
}

export function resetGeminiCapabilityHealthCache(): void {
  globalCachedHealth.clear();
  globalInFlight.clear();
}

function resolveModels(): GeminiModels {
  return {
    pro: sanitizeModelOverride(process.env.GEMINI_MODEL_PRO, DEFAULT_MODEL_PRO),
    flash: sanitizeModelOverride(process.env.GEMINI_MODEL_FLASH, DEFAULT_MODEL_FLASH),
    deepResearch: sanitizeModelOverride(process.env.GEMINI_MODEL_DEEP_RESEARCH, DEFAULT_MODEL_DEEP_RESEARCH),
  };
}
