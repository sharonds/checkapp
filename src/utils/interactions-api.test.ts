import { describe, expect, test } from "bun:test";
import { createInteraction, extractText, interactionErrorText, pollUntilComplete } from "./interactions-api.ts";
import { jsonResponse, mockFetch } from "../testing/mock-fetch.ts";

describe("interactions-api", () => {
  test("createInteraction posts to the interactions endpoint and returns the id", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    let seenBody = "";

    mockFetch(async (req) => {
      seenUrl = req.url;
      seenKey = req.headers.get("x-goog-api-key");
      seenBody = await req.text();
      return jsonResponse({ id: "int-123" }, 201);
    });

    await expect(createInteraction("api-key", { input: "ping" })).resolves.toEqual({ id: "int-123" });
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(seenKey).toBe("api-key");
    expect(JSON.parse(seenBody)).toEqual({ input: "ping" });
  });

  test("pollUntilComplete waits for a completed status transition", async () => {
    let polls = 0;

    mockFetch(async (req) => {
      polls++;
      expect(req.method).toBe("GET");
      if (polls === 1) {
        return jsonResponse({ id: "int-123", status: "running" });
      }
      return jsonResponse({
        id: "int-123",
        status: "completed",
        outputs: [{ text: "finished" }],
      });
    });

    const result = await pollUntilComplete("int-123", "api-key", { pollIntervalMs: 0, maxPolls: 3 });

    expect(result.status).toBe("completed");
    expect(extractText(result)).toBe("finished");
    expect(polls).toBe(2);
  });

  test("extractText reads the final model_output step of the steps[] schema (legacy outputs removed 2026-06-08)", () => {
    const data = {
      id: "int-1",
      status: "completed",
      steps: [
        { type: "user_input", content: [{ type: "text", text: "Fact-check this" }] },
        { type: "thought", content: [{ type: "text", text: "planning" }] },
        { type: "model_output", content: [{ type: "text", text: "draft" }] },
        {
          type: "model_output",
          content: [
            { type: "image", data: "..." },
            {
              type: "text",
              text: "## Report",
              annotations: [{ type: "url_citation", url: "https://example.org", start_index: 0, end_index: 9 }],
            },
            { type: "text", text: "Body" },
          ],
        },
      ],
    };
    expect(extractText(data)).toBe("## Report\nBody");
  });

  test("extractText prefers steps over legacy outputs when both are present", () => {
    expect(extractText({
      id: "int-1",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: "new" }] }],
      outputs: [{ text: "old" }],
    })).toBe("new");
  });

  test("interactionErrorText handles string and object error shapes", () => {
    expect(interactionErrorText({ id: "i", status: "failed", error: "boom" })).toBe("boom");
    expect(interactionErrorText({ id: "i", status: "failed", error: { message: "quota", code: 429 } })).toBe("quota");
    expect(interactionErrorText({ id: "i", status: "failed" })).toBe("");
  });

  test("extractText returns the first available text output", () => {
    expect(extractText({ id: "int-1", status: "completed" })).toBe("");
    expect(extractText({ id: "int-1", status: "completed", outputs: [{}, { text: "later" }] })).toBe("later");
  });

  // Changed 2026-10-20: the key moved from the URL to the x-goog-api-key header, so it is passed verbatim.
  test("createInteraction sends the API key only in the header, never the URL", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    mockFetch(async (req) => {
      seenUrl = req.url;
      seenKey = req.headers.get("x-goog-api-key");
      return jsonResponse({ id: "int-enc" }, 201);
    });
    await createInteraction("abc+def/ghi", { input: "ping" });
    expect(seenKey).toBe("abc+def/ghi");
    expect(seenUrl).not.toContain("key=");
  });

  test("pollUntilComplete URL-encodes the interaction id and sends the key as a header", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    mockFetch(async (req) => {
      seenUrl = req.url;
      seenKey = req.headers.get("x-goog-api-key");
      return jsonResponse({ id: "int/with/slash", status: "completed", outputs: [{ text: "x" }] });
    });
    await pollUntilComplete("int/with/slash", "abc+key", { pollIntervalMs: 0, maxPolls: 1 });
    expect(seenUrl).toContain("int%2Fwith%2Fslash");
    expect(seenUrl).not.toContain("key=");
    expect(seenKey).toBe("abc+key");
  });
});
