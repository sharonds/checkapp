export type AuditAdapterStrategy = "ai-sdk" | "direct" | "two-step";

export interface ProviderCapability {
  provider: string;
  model: string;
  grounding: boolean;
  structuredOutput: boolean;
  groundingMetadata: boolean;
  tokenTelemetry: boolean;
  aiSdkMetadataParity: boolean;
  adapterStrategy: AuditAdapterStrategy;
}

const MATRIX: ProviderCapability[] = [
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    grounding: true,
    structuredOutput: true,
    groundingMetadata: true,
    tokenTelemetry: true,
    aiSdkMetadataParity: false,
    adapterStrategy: "direct",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    grounding: true,
    structuredOutput: true,
    groundingMetadata: true,
    tokenTelemetry: true,
    aiSdkMetadataParity: false,
    adapterStrategy: "direct",
  },
];

export function getProviderCapability(provider: string, model: string): ProviderCapability {
  return MATRIX.find((row) => row.provider === provider && row.model === model) ?? {
    provider,
    model,
    grounding: false,
    structuredOutput: false,
    groundingMetadata: false,
    tokenTelemetry: false,
    aiSdkMetadataParity: false,
    adapterStrategy: "two-step",
  };
}

export function selectAuditAdapter(capability: ProviderCapability): AuditAdapterStrategy {
  if (capability.adapterStrategy === "two-step") return "two-step";
  if (capability.aiSdkMetadataParity && capability.groundingMetadata) return "ai-sdk";
  if (capability.grounding) return "direct";
  return "two-step";
}
