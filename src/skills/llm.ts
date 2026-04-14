/**
 * Returns an Anthropic SDK client configured for the best available LLM provider.
 *
 * Priority: MiniMax (cheaper, Anthropic-compatible) → Anthropic
 *
 * MiniMax endpoint: https://api.minimax.io/anthropic
 * Models: MiniMax-M2.7 (standard) | MiniMax-M2.7-highspeed (faster)
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";

export const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";

/** Standard model for quality tasks (fact-check, tone, legal) */
export const LLM_MODEL = {
  minimax: "MiniMax-M2.7",
  anthropic: "claude-haiku-4-5-20251001",
} as const;

export interface LlmClient {
  client: Anthropic;
  model: string;
  provider: "minimax" | "anthropic";
}

/**
 * Returns a configured LLM client. Prefers MiniMax when `minimaxApiKey` is set.
 * Returns null when neither key is configured.
 */
export function getLlmClient(config: Config): LlmClient | null {
  if (config.minimaxApiKey) {
    return {
      client: new Anthropic({
        apiKey: config.minimaxApiKey,
        baseURL: MINIMAX_BASE_URL,
      }),
      model: LLM_MODEL.minimax,
      provider: "minimax",
    };
  }

  if (config.anthropicApiKey) {
    return {
      client: new Anthropic({ apiKey: config.anthropicApiKey }),
      model: LLM_MODEL.anthropic,
      provider: "anthropic",
    };
  }

  return null;
}
