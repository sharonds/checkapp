import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Next 16 blocks cross-origin requests to dev-only assets (HMR, Flight RSC
  // stream) by default. The dev server binds to localhost, so any browser
  // hitting it via 127.0.0.1 (our e2e harness, some local tools) gets dev
  // assets silently blocked, which prevents React from hydrating. Allow both
  // loopback forms explicitly so hydration works regardless of which the
  // client resolves to. See
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md
  // and the Next 16 upgrade guide.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
