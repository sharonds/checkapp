#!/usr/bin/env bash
set -e

echo "Building article-checker binaries..."
mkdir -p dist

# Ink conditionally imports react-devtools-core (only when DEV=true).
# Bun's bundler still resolves it at build time, so we provide a no-op stub.
mkdir -p node_modules/react-devtools-core
echo '{"name":"react-devtools-core","version":"0.0.0","main":"index.js"}' \
  > node_modules/react-devtools-core/package.json
echo 'export default { connectToDevTools: () => {} };' \
  > node_modules/react-devtools-core/index.js

bun build --compile --target=bun-darwin-arm64 src/index.tsx --outfile dist/article-checker-mac-arm64
echo "✓ dist/article-checker-mac-arm64  (Apple Silicon)"

bun build --compile --target=bun-darwin-x64 src/index.tsx --outfile dist/article-checker-mac-x64
echo "✓ dist/article-checker-mac-x64    (Intel Mac)"

bun build --compile --target=bun-linux-x64 src/index.tsx --outfile dist/article-checker-linux-x64
echo "✓ dist/article-checker-linux-x64  (Linux)"

bun build --compile --target=bun-windows-x64 src/index.tsx --outfile dist/article-checker-win-x64.exe
echo "✓ dist/article-checker-win-x64.exe (Windows)"

echo ""
echo "Done. Upload the dist/ files to a GitHub Release."
