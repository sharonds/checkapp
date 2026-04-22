export function isE2E(): boolean {
  return process.env.CHECKAPP_E2E === "1";
}

export function getScenario(): string | null {
  return process.env.CHECKAPP_E2E_SCENARIO ?? null;
}

export function liveProvidersAllowed(): boolean {
  return process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS === "1";
}

// Belt-and-suspenders guard: call this right before a live HTTP request to a
// third-party provider. In E2E mode without the explicit live flag it throws,
// so an accidentally-removed mock short-circuit fails loudly instead of
// silently hitting the network.
export function assertMocksOnly(provider: string): void {
  if (!isE2E()) return;
  if (liveProvidersAllowed()) return;
  throw new Error(
    `E2E mode: live provider call to "${provider}" blocked. ` +
      `Set CHECKAPP_ALLOW_LIVE_PROVIDERS=1 to override.`,
  );
}
