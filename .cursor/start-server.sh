#!/usr/bin/env bash
# Launch only the headless server; keep local user context and credentials separate.
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${ROX_CLOUD_BUN_INSTALL:-$HOME/rox-cloud/bun}/bin:$PATH"
export CRAFT_BUNDLED_ASSETS_ROOT="$PWD/apps/electron"
export CRAFT_RPC_HOST=127.0.0.1
export CRAFT_RPC_PORT=9100
export ROX_CONFIG_DIR="${ROX_CONFIG_DIR:-$HOME/rox-cloud/context}"
export CRAFT_CONFIG_DIR="$ROX_CONFIG_DIR"
export CRAFT_PRINT_TOKEN=0

umask 077
mkdir -p "$ROX_CONFIG_DIR"
CRAFT_SERVER_TOKEN="dev-$(openssl rand -hex 24)"
export CRAFT_SERVER_TOKEN
token_path="$(mktemp "$ROX_CONFIG_DIR/.cursor-dev-token.XXXXXX")"
trap 'rm -f -- "$token_path"' EXIT
printf '%s\n' "$CRAFT_SERVER_TOKEN" > "$token_path"
mv -f -- "$token_path" "$ROX_CONFIG_DIR/cursor-dev-token"
printf 'ROX development token file: %s/cursor-dev-token\n' "$ROX_CONFIG_DIR"
exec bun run packages/server/src/index.ts
