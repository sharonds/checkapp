import { describe, test, expect } from "bun:test";
import type { ProviderId } from "./types.ts";

describe("ProviderId", () => {
  test("accepts openalex as a provider", () => {
    const p: ProviderId = "openalex";
    expect(p).toBe("openalex");
  });

  test("accepts gemini grounded plagiarism as a provider", () => {
    const p: ProviderId = "gemini-grounded-plagiarism";
    expect(p).toBe("gemini-grounded-plagiarism");
  });
});
