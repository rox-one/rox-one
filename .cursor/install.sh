#!/usr/bin/env bash
# Cloud Agent install script for Craft Agents (headless server dev environment).
# Runs from the repository root after checkout. Must be idempotent and terminate.
set -euo pipefail

# --- Bun runtime -------------------------------------------------------------
# Pin to the version CI uses (.github/workflows/*.yml + .circleci/config.yml).
BUN_VERSION="1.3.14"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  echo "Installing Bun v${BUN_VERSION}..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi
export PATH="$BUN_INSTALL/bin:$PATH"
echo "Bun: $(bun --version)"

# --- Workspace dependencies --------------------------------------------------
# NOTE: `--frozen-lockfile` is deliberately NOT used. package.json requests
# `@types/bun: "latest"`, so Bun re-resolves that dist-tag on each install and
# reports drift against the committed bun.lock, which makes frozen installs fail
# over time. A plain install is resilient and idempotent for a dev environment.
bun install

# --- Server runtime artifacts ------------------------------------------------
# The headless server spawns bundled helper subprocesses resolved by
# packages/*/src/runtime-resolver.ts. Build them so the server is fully
# functional (session spawning, MCP session server) without the desktop app.
bun build packages/session-mcp-server/src/index.ts \
  --outfile packages/session-mcp-server/dist/index.js --target node --format cjs
bun build packages/pi-agent-server/src/index.ts \
  --outfile packages/pi-agent-server/dist/index.js --target node --format cjs
bun run server:build:subprocess

echo "Craft Agents install complete."
