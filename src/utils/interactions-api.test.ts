import { describe, expect, test } from "bun:test";
import { createInteraction, extractText, pollUntilComplete } from "./interactions-api.ts";
import { jsonResponse, mockFetch } from "../testing/mock-fetch.ts";

describe("interactions-api", () => {
  test("createInteraction posts to the interactions endpoint and returns the id", async () => {
    let seenUrl = "";
    let seenBody = "";

    mockFetch(async (req) => {
      seenUrl = req.url;
      seenBody = await req.text();
      return jsonResponse({ id: "int-123" }, 201);
    });

    await expect(createInteraction("api-key", { input: "ping" })).resolves.toEqual({ id: "int-123" });
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/interactions?key=api-key");
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

  test("extractText returns an empty string when there is no text output", () => {
    expect(extractText({ id: "int-1", status: "completed" })).toBe("");
    expect(extractText({ id: "int-1", status: "completed", outputs: [{}, { text: "later" }] })).toBe("");
  });
});
