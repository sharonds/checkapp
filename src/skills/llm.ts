/**
 * Returns an Anthropic SDK client configured for the best available LLM provider.
 *
 * Priority: MiniMax (cheaper, Anthropic-compatible) → Anthropic
 *
 * MiniMax endpoint: https://api.minimax.io/anthropic
 * Models: MiniMax-M2.7 (standard) | MiniMax-M2.7-highspeed (faster)
 *
 * Note: MiniMax-M2.7 is an extended-thinking model — it always emits a
 * "thinking" block before the actual text block. Use getTextBlock() to
 * extract the text regardless of provider.
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
 * Extracts the text content from a response, skipping any "thinking" blocks.
 * MiniMax-M2.7 always emits a thinking block first; Anthropic models do not.
 */
export function getTextBlock(content: Anthropic.Messages.ContentBlock[]): string {
  const block = content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

/**
 * Parses a JSON response that may be wrapped in a markdown code fence.
 * MiniMax-M2.7 sometimes wraps JSON in ```json ... ``` blocks.
 * Throws SyntaxError if the cleaned string is not valid JSON.
 */
export function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(cleaned) as T;
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
