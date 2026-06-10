/**
 * Unified LLM client that supports Anthropic SDK (MiniMax, Anthropic),
 * Gemini direct fetch, and OpenAI-compatible SDK (OpenRouter).
 *
 * Skills call `llm.call(prompt, maxTokens)` — the SDK difference is hidden.
 *
 * Priority (auto-detect): MiniMax -> Anthropic -> Gemini -> OpenRouter
 * Explicit: set `llmProvider` in config to override.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Config } from "../config.ts";
import { createGeminiCapability } from "../providers/gemini-capability.ts";
import { isE2E, assertMocksOnly } from "../e2e/mode.ts";
import { loadScenario } from "../e2e/fixtures.ts";

export const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Standard model for quality tasks (fact-check, tone, legal) */
export const LLM_MODEL = {
  minimax: "MiniMax-M2.7",
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-3-pro-preview",
  openrouter: "anthropic/claude-3.5-haiku",
} as const;

export type LlmProvider = "minimax" | "anthropic" | "gemini" | "openrouter";

export interface LlmClient {
  provider: LlmProvider;
  model: string;
  /** Send a prompt and get text back. Handles SDK differences internally. */
  call: (prompt: string, maxTokens?: number) => Promise<string>;
}

function createAnthropicCaller(client: Anthropic, model: string): LlmClient["call"] {
  return async (prompt: string, maxTokens = 1024) => {
    assertMocksOnly("llm:anthropic");
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return getTextBlock(response.content);
  };
}

function createOpenAICaller(client: OpenAI, model: string): LlmClient["call"] {
  return async (prompt: string, maxTokens = 1024) => {
    assertMocksOnly("llm:openai");
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty response");
    return content.trim();
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
  }>;
}

function createGeminiCaller(apiKey: string, model: string): LlmClient["call"] {
  return async (prompt: string, maxTokens = 1024) => {
    assertMocksOnly("llm:gemini");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // Respect caller's token budget; cap at 8192 so a large request
            // doesn't produce runaway cost. Callers needing more should split.
            maxOutputTokens: Math.min(maxTokens, 8192),
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini LLM error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GeminiGenerateContentResponse;
    const text = (data.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true)
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) throw new Error("LLM returned empty response");
    return text;
  };
}

/**
 * Returns a configured LLM client.
 * Explicit `llmProvider` in config is preferred when its key is set; falls back to auto-detect if key missing.
 * Returns null when no usable key is configured.
 */
function detectPromptPhase(prompt: string): "extract" | "assess" | "other" {
  const head = prompt.slice(0, 200).toLowerCase();
  if (head.includes("extract") && head.includes("claim")) return "extract";
  if (head.includes("is this claim supported")) return "assess";
  return "other";
}

export function getLlmClient(config: Config): LlmClient | null {
  // E2E mode: return a scenario-driven mock instead of making real HTTP calls.
  // We still honor the configured provider so skills that branch on it see the
  // expected value, but the call() handler reads from the fixture.
  if (isE2E()) {
    const provider: LlmProvider =
      config.llmProvider ??
      (config.minimaxApiKey
        ? "minimax"
        : config.anthropicApiKey
          ? "anthropic"
          : config.geminiApiKey
            ? "gemini"
            : "minimax");
    return {
      provider,
      model: LLM_MODEL[provider],
      call: async (prompt: string) => {
        const s = loadScenario();
        const phase = detectPromptPhase(prompt);
        if (phase === "extract" && s.providers.llm?.extractClaims) {
          return s.providers.llm.extractClaims;
        }
        if (phase === "assess" && s.providers.llm?.assessClaim) {
          return s.providers.llm.assessClaim;
        }
        // Legacy / fallback: single-response fixture.
        return (
          s.providers.geminiChat?.text ??
          s.providers.minimax?.text ??
          "{}"
        );
      },
    };
  }

  // Explicit provider preference
  if (config.llmProvider === "openrouter" && config.openrouterApiKey) {
    const client = new OpenAI({ apiKey: config.openrouterApiKey, baseURL: OPENROUTER_BASE_URL });
    return { provider: "openrouter", model: LLM_MODEL.openrouter, call: createOpenAICaller(client, LLM_MODEL.openrouter) };
  }
  if (config.llmProvider === "anthropic" && config.anthropicApiKey) {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    return { provider: "anthropic", model: LLM_MODEL.anthropic, call: createAnthropicCaller(client, LLM_MODEL.anthropic) };
  }
  if (config.llmProvider === "minimax" && config.minimaxApiKey) {
    const client = new Anthropic({ apiKey: config.minimaxApiKey, baseURL: MINIMAX_BASE_URL });
    return { provider: "minimax", model: LLM_MODEL.minimax, call: createAnthropicCaller(client, LLM_MODEL.minimax) };
  }
  if (config.llmProvider === "gemini" && config.geminiApiKey) {
    const model = createGeminiCapability({ apiKey: config.geminiApiKey }).getModel("chat");
    return { provider: "gemini", model, call: createGeminiCaller(config.geminiApiKey, model) };
  }

  // Auto-detect: MiniMax -> Anthropic -> Gemini -> OpenRouter
  if (config.minimaxApiKey) {
    const client = new Anthropic({ apiKey: config.minimaxApiKey, baseURL: MINIMAX_BASE_URL });
    return { provider: "minimax", model: LLM_MODEL.minimax, call: createAnthropicCaller(client, LLM_MODEL.minimax) };
  }
  if (config.anthropicApiKey) {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    return { provider: "anthropic", model: LLM_MODEL.anthropic, call: createAnthropicCaller(client, LLM_MODEL.anthropic) };
  }
  if (config.geminiApiKey) {
    const model = createGeminiCapability({ apiKey: config.geminiApiKey }).getModel("chat");
    return { provider: "gemini", model, call: createGeminiCaller(config.geminiApiKey, model) };
  }
  if (config.openrouterApiKey) {
    const client = new OpenAI({ apiKey: config.openrouterApiKey, baseURL: OPENROUTER_BASE_URL });
    return { provider: "openrouter", model: LLM_MODEL.openrouter, call: createOpenAICaller(client, LLM_MODEL.openrouter) };
  }

  return null;
}

/**
 * Extracts the text content from an Anthropic response, skipping any "thinking" blocks.
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
