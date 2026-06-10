import { describe, expect, test } from "bun:test";
import { getProviderCapability, selectAuditAdapter } from "./provider-capabilities.ts";

describe("provider capability matrix", () => {
  test("declares known Gemini capability rows", () => {
    const capability = getProviderCapability("gemini", "gemini-2.5-pro");
    expect(capability.grounding).toBe(true);
    expect(capability.structuredOutput).toBe(true);
    expect(capability.groundingMetadata).toBe(true);
  });

  test("uses two-step fallback for unknown models", () => {
    const capability = getProviderCapability("gemini", "future-model");
    expect(capability.adapterStrategy).toBe("two-step");
    expect(selectAuditAdapter(capability)).toBe("two-step");
  });

  test("selects AI SDK only when metadata parity is declared", () => {
    expect(selectAuditAdapter({ ...getProviderCapability("gemini", "gemini-2.5-flash"), aiSdkMetadataParity: true })).toBe("ai-sdk");
    expect(selectAuditAdapter({ ...getProviderCapability("gemini", "gemini-2.5-flash"), aiSdkMetadataParity: false })).toBe("direct");
  });
});
