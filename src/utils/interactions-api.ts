import { traceProviderCall, type TraceInput } from "../telemetry/trace.ts";

export const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface InteractionContentItem {
  type?: string;
  text?: string;
  annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }>;
}

export interface InteractionStep {
  type?: string;
  content?: InteractionContentItem[];
}

export interface InteractionResponse {
  id: string;
  status: string;
  /** Current schema (Api-Revision 2026-05-20+): typed timeline of steps. */
  steps?: InteractionStep[];
  /** Legacy schema, removed by Google on 2026-06-08. Kept for stored rows and old fixtures. */
  outputs?: Array<{ text?: string }>;
  error?: string | { message?: string; code?: number };
}

export interface PollUntilCompleteOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
}

export async function createInteraction(apiKey: string, body: unknown): Promise<{ id: string }> {
  const startedAt = Date.now();
  const { input, ...params } = (body ?? {}) as { input?: unknown; agent?: string };
  const trace = (fields: Partial<TraceInput>) => traceProviderCall({
    stage: "deep-research.create", provider: "gemini-deep-research", model: params.agent, params,
    prompt: typeof input === "string" ? input : JSON.stringify(input), latencyMs: Date.now() - startedAt, ...fields,
  });
  const response = await fetch(`${BASE}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    trace({ httpStatus: response.status, error: `HTTP ${response.status}` });
    throw new Error(`Failed to create interaction: ${response.status}`);
  }

  const data = (await response.json()) as Partial<InteractionResponse>;
  trace({ httpStatus: response.status, meta: { interactionId: data.id } });
  if (!data.id) {
    throw new Error("Failed to create interaction: missing id");
  }

  return { id: data.id };
}

export async function pollUntilComplete(
  id: string,
  apiKey: string,
  opts: PollUntilCompleteOptions = {},
): Promise<InteractionResponse> {
  const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  const maxPolls = opts.maxPolls ?? 80;

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const response = await fetch(`${BASE}/interactions/${encodeURIComponent(id)}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`Failed to poll interaction ${id}: ${response.status}`);
    }

    const data = (await response.json()) as InteractionResponse;
    if (data.status === "completed") {
      return data;
    }
    if (data.status === "failed") {
      throw new Error(interactionErrorText(data) || `Interaction ${id} failed`);
    }

    if (attempt < maxPolls - 1) {
      await delay(pollIntervalMs);
    }
  }

  throw new Error(`Interaction ${id} did not complete after ${maxPolls} polls`);
}

export function extractText(data: InteractionResponse | null | undefined): string {
  const finalOutput = data?.steps?.filter((step) => step.type === "model_output").at(-1);
  if (finalOutput) {
    return (finalOutput.content ?? [])
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("\n");
  }
  return data?.outputs?.find((output) => output.text)?.text ?? "";
}

export function interactionErrorText(data: InteractionResponse | null | undefined): string {
  const error = data?.error;
  if (typeof error === "string") return error;
  return error?.message ?? "";
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Per-run trace of one Deep Research poll. The report text is Search-grounded content. */
export function traceInteractionPoll(
  interactionId: string,
  httpStatus: number,
  data: InteractionResponse | null | undefined,
  latencyMs: number,
): void {
  const text = extractText(data);
  traceProviderCall({
    stage: "deep-research.poll",
    provider: "gemini-deep-research",
    grounded: true,
    httpStatus,
    latencyMs,
    response: text || undefined,
    error: interactionErrorText(data) || undefined,
    meta: { interactionId, status: data?.status, textLength: text.length },
  });
}
