import React, { useState } from "react";
import { render, Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { saveConfig, configPath } from "./config.ts";

type Step = "username" | "apikey" | "saving" | "done" | "error";

interface SetupProps {
  onComplete: () => void;
}

function Setup({ onComplete }: SetupProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleApiKeySubmit(val: string) {
    if (!val.trim()) return;
    setStep("saving");
    try {
      saveConfig({ copyscapeUser: username.trim(), copyscapeKey: val.trim() });
      setStep("done");
      setTimeout(() => {
        onComplete();
        exit();
      }, 1200);
    } catch (err) {
      setErrorMsg(String(err));
      setStep("error");
      setTimeout(exit, 2000);
    }
  }

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0}>
        <Text bold color="cyan">
          Article Checker — First-time Setup
        </Text>
      </Box>

      <Text dimColor>
        You only need to do this once. Credentials are saved to:
      </Text>
      <Text dimColor>  {configPath()}</Text>

      {/* Step 1: Username */}
      <Box gap={1} marginTop={1}>
        <Text bold>Copyscape username:</Text>
        {step === "username" ? (
          <TextInput
            value={username}
            onChange={setUsername}
            placeholder="you@example.com"
            onSubmit={(val) => {
              if (val.trim()) setStep("apikey");
            }}
          />
        ) : (
          <Text color="green">{username}</Text>
        )}
      </Box>

      {/* Step 2: API key */}
      {(step === "apikey" || step === "saving" || step === "done" || step === "error") && (
        <Box gap={1}>
          <Text bold>Copyscape API key:  </Text>
          {step === "apikey" ? (
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              mask="*"
              placeholder="your API key"
              onSubmit={handleApiKeySubmit}
            />
          ) : (
            <Text color="green">{"*".repeat(Math.min(apiKey.length || 8, 12))}</Text>
          )}
        </Box>
      )}

      {/* Feedback */}
      {step === "saving" && (
        <Text color="yellow">Saving credentials…</Text>
      )}
      {step === "done" && (
        <Box flexDirection="column" gap={0} marginTop={1}>
          <Text color="green" bold>✓ All set! Run the checker:</Text>
          <Text dimColor>  article-checker {"<google-doc-url>"}</Text>
        </Box>
      )}
      {step === "error" && (
        <Text color="red">✗ Could not save credentials: {errorMsg}</Text>
      )}

      {/* Hint */}
      {step === "username" && (
        <Text dimColor>
          Get your API key at copyscape.com → My Account → API
        </Text>
      )}
    </Box>
  );
}

export async function runSetup(): Promise<void> {
  return new Promise((resolve) => {
    const { waitUntilExit } = render(<Setup onComplete={resolve} />);
    waitUntilExit().then(resolve).catch(resolve);
  });
}
