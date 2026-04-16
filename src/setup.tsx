import React, { useState } from "react";
import { render, Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { saveConfig, configPath, type Config } from "./config.ts";

type Step = "username" | "apikey" | "parallel" | "saving" | "done" | "error";

interface SetupProps {
  /** When provided, skip directly to the Parallel key step (incremental update). */
  existingConfig?: Config;
  onComplete: () => void;
}

function Setup({ existingConfig, onComplete }: SetupProps) {
  const { exit } = useApp();
  const incremental = !!existingConfig;

  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState(existingConfig?.copyscapeUser ?? "");
  const [apiKey, setApiKey] = useState(existingConfig?.copyscapeKey ?? "");
  const [parallelApiKeyVal, setParallelApiKeyVal] = useState(
    existingConfig?.parallelApiKey ?? ""
  );
  const [errorMsg, setErrorMsg] = useState("");

  function handleApiKeySubmit(val: string) {
    if (!val.trim()) return;
    setApiKey(val.trim());
    setStep("parallel");
  }

  async function handleParallelSubmit(val: string) {
    setStep("saving");
    try {
      const config: Config = {
        copyscapeUser: username.trim(),
        copyscapeKey: apiKey,
      };
      if (val.trim()) {
        config.parallelApiKey = val.trim();
        setParallelApiKeyVal(val.trim());
      }
      saveConfig(config);
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

  const afterParallel =
    step === "saving" || step === "done" || step === "error";

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0}>
        <Text bold color="cyan">
          Checkit — {incremental ? "Update Credentials" : "First-time Setup"}
        </Text>
      </Box>

      <Text dimColor>
        {incremental
          ? "Press Enter to keep current values, or type new ones."
          : "You only need to do this once."}{" "}
        Credentials are saved to:
      </Text>
      <Text dimColor>  {configPath()}</Text>

      {/* Step 1: Username */}
      <Box gap={1} marginTop={1}>
        <Text bold>Copyscape username:</Text>
        {step === "username" ? (
          <TextInput
            value={username}
            onChange={setUsername}
            placeholder={incremental && existingConfig?.copyscapeUser ? existingConfig.copyscapeUser : "you@example.com"}
            onSubmit={(val) => {
              if (val.trim() || (incremental && existingConfig?.copyscapeUser)) {
                if (!val.trim() && incremental && existingConfig?.copyscapeUser) {
                  setUsername(existingConfig.copyscapeUser);
                }
                setStep("apikey");
              }
            }}
          />
        ) : (
          <Text color="green">{username}</Text>
        )}
      </Box>

      {/* Step 2: Copyscape API key */}
      {step !== "username" && (
        <Box gap={1}>
          <Text bold>Copyscape API key:  </Text>
          {step === "apikey" ? (
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              mask="*"
              placeholder={incremental && existingConfig?.copyscapeKey ? "press Enter to keep current key" : "your API key"}
              onSubmit={(val) => {
                if (val.trim()) {
                  handleApiKeySubmit(val);
                } else if (incremental && existingConfig?.copyscapeKey) {
                  setApiKey(existingConfig.copyscapeKey);
                  setStep("parallel");
                }
              }}
            />
          ) : (
            <Text color="green">
              {"*".repeat(Math.min(apiKey.length || 8, 12))}
            </Text>
          )}
        </Box>
      )}

      {/* Step 3: Parallel API key (optional) */}
      {(step === "parallel" || afterParallel) && (
        <Box flexDirection="column" gap={0}>
          <Box gap={1}>
            <Text bold>Parallel AI API key:</Text>
            {step === "parallel" ? (
              <TextInput
                value={parallelApiKeyVal}
                onChange={setParallelApiKeyVal}
                mask="*"
                placeholder="optional — press Enter to skip"
                onSubmit={handleParallelSubmit}
              />
            ) : (
              <Text color={parallelApiKeyVal ? "green" : "dim"}>
                {parallelApiKeyVal
                  ? "*".repeat(Math.min(parallelApiKeyVal.length, 12))
                  : "(skipped)"}
              </Text>
            )}
          </Box>
          {step === "parallel" && (
            <Text dimColor>
              {"  "}Optional. Adds passage-level evidence ($0.001/URL).
              Get key at platform.parallel.ai
            </Text>
          )}
        </Box>
      )}

      {/* Feedback */}
      {step === "saving" && (
        <Text color="yellow">Saving credentials…</Text>
      )}
      {step === "done" && (
        <Box flexDirection="column" gap={0} marginTop={1}>
          <Text color="green" bold>
            ✓ All set! Run the checker:
          </Text>
          <Text dimColor>  checkit {"<google-doc-url>"}</Text>
        </Box>
      )}
      {step === "error" && (
        <Text color="red">✗ Could not save credentials: {errorMsg}</Text>
      )}

      {/* Hint — only on fresh setup */}
      {!incremental && step === "username" && (
        <Text dimColor>
          Get your Copyscape API key at copyscape.com → My Account → API
        </Text>
      )}
    </Box>
  );
}

export async function runSetup(existingConfig?: Config): Promise<void> {
  return new Promise((resolve) => {
    const { waitUntilExit } = render(
      <Setup existingConfig={existingConfig} onComplete={resolve} />
    );
    waitUntilExit().then(resolve).catch(resolve);
  });
}
