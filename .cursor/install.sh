#!/usr/bin/env bash
# Cursor Cloud Agent preparation. Run from any directory; stop after building.
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Match the server-validation workflow without upgrading the user's global Bun.
BUN_VERSION="1.3.14"
export BUN_INSTALL="${ROX_CLOUD_BUN_INSTALL:-$HOME/.rox-cloud/bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version)" != "$BUN_VERSION" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi
if [ "$(bun --version)" != "$BUN_VERSION" ]; then
  echo "Expected Bun $BUN_VERSION after installation" >&2
  exit 1
fi

# Preserve the committed dependency graph. Headless work does not need Electron.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --frozen-lockfile
bun build packages/session-mcp-server/src/index.ts \
  --outfile packages/session-mcp-server/dist/index.js --target node --format cjs
bun run server:build:subprocess
printf 'ROX headless server preparation complete.\n'
