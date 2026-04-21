export const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface InteractionResponse {
  id: string;
  status: string;
  outputs?: Array<{ text?: string }>;
  error?: string;
}

export interface PollUntilCompleteOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
}

export async function createInteraction(apiKey: string, body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${BASE}/interactions?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to create interaction: ${response.status}`);
  }

  const data = (await response.json()) as Partial<InteractionResponse>;
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
    const response = await fetch(`${BASE}/interactions/${id}?key=${apiKey}`);
    if (!response.ok) {
      throw new Error(`Failed to poll interaction ${id}: ${response.status}`);
    }

    const data = (await response.json()) as InteractionResponse;
    if (data.status === "completed") {
      return data;
    }
    if (data.status === "failed") {
      throw new Error(data.error ?? `Interaction ${id} failed`);
    }

    if (attempt < maxPolls - 1) {
      await delay(pollIntervalMs);
    }
  }

  throw new Error(`Interaction ${id} did not complete after ${maxPolls} polls`);
}

export function extractText(data: InteractionResponse | null | undefined): string {
  return data?.outputs?.[0]?.text ?? "";
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
