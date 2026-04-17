#!/usr/bin/env bash
set -e

echo "Building checkapp binaries..."
mkdir -p dist

# Ink conditionally imports react-devtools-core (only when DEV=true).
# Bun's bundler still resolves it at build time, so we provide a no-op stub.
mkdir -p node_modules/react-devtools-core
echo '{"name":"react-devtools-core","version":"0.0.0","main":"index.js"}' \
  > node_modules/react-devtools-core/package.json
echo 'export default { connectToDevTools: () => {} };' \
  > node_modules/react-devtools-core/index.js

BUN="${BUN_BIN:-bun}"
command -v "$BUN" &>/dev/null || BUN="$HOME/.bun/bin/bun"

"$BUN" build --compile --target=bun-darwin-arm64 src/index.tsx --outfile dist/checkapp-mac-arm64
echo "✓ dist/checkapp-mac-arm64  (Apple Silicon)"

"$BUN" build --compile --target=bun-darwin-x64 src/index.tsx --outfile dist/checkapp-mac-x64
echo "✓ dist/checkapp-mac-x64    (Intel Mac)"

"$BUN" build --compile --target=bun-linux-x64 src/index.tsx --outfile dist/checkapp-linux-x64
echo "✓ dist/checkapp-linux-x64  (Linux)"

"$BUN" build --compile --target=bun-windows-x64 src/index.tsx --outfile dist/checkapp-win-x64.exe
echo "✓ dist/checkapp-win-x64.exe (Windows)"

echo ""
echo "Done. Upload the dist/ files to a GitHub Release."
