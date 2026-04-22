"use client";

export type FactCheckTier = "basic" | "standard" | "premium";

interface FactCheckTierSelectorProps {
  value: FactCheckTier;
  onChange: (value: FactCheckTier) => void;
  geminiKeyConfigured: boolean;
}

const FACT_CHECK_TIERS: Array<{
  value: FactCheckTier;
  label: string;
  description: string;
  price: string;
  disabledWithoutGemini: boolean;
}> = [
  {
    value: "basic",
    label: "Basic",
    description: "Exa + LLM",
    price: "$0.04",
    disabledWithoutGemini: false,
  },
  {
    value: "standard",
    label: "Standard (recommended)",
    description: "Gemini + Google Search",
    price: "$0.16",
    disabledWithoutGemini: true,
  },
  {
    value: "premium",
    label: "Deep Audit (async, ~10 min)",
    description: "Gemini Deep Research",
    price: "$1.50",
    disabledWithoutGemini: true,
  },
];

export function FactCheckTierSelector({
  value,
  onChange,
  geminiKeyConfigured,
}: FactCheckTierSelectorProps) {
  return (
    <div className="space-y-3">
      {FACT_CHECK_TIERS.map((tier) => {
        const disabled = tier.disabledWithoutGemini && !geminiKeyConfigured;
        const checked = value === tier.value;

        return (
          <label
            key={tier.value}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/50"
            } ${checked ? "border-primary bg-primary/5" : "border-border"}`}
          >
            <input
              type="radio"
              name="fact-check-tier"
              value={tier.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(tier.value)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{tier.label}</span>
              <span className="block text-sm text-muted-foreground">
                {tier.description}, {tier.price}
              </span>
            </span>
          </label>
        );
      })}

      {!geminiKeyConfigured && (
        <p className="text-sm text-muted-foreground">
          Add GEMINI_API_KEY and enable fact-check routing to use Standard and Deep Audit tiers.
        </p>
      )}
    </div>
  );
}
