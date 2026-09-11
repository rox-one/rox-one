#!/bin/bash
# Stage Claude Agent SDK + ripgrep into apps/electron/node_modules so
# electron-builder.yml extraResources (from: node_modules/@anthropic-ai/...)
# resolve when packaging via electron:dist:dev:* (build-dmg.sh already does this).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$ROOT_DIR/apps/electron"
ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
esac

SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
SDK_BIN_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk-darwin-${ARCH}"
RG_SOURCE="$ROOT_DIR/node_modules/@vscode/ripgrep"

if [ ! -d "$SDK_SOURCE" ]; then
  echo "ERROR: missing $SDK_SOURCE — run bun install from repo root" >&2
  exit 1
fi
if [ ! -d "$SDK_BIN_SOURCE" ]; then
  echo "ERROR: missing $SDK_BIN_SOURCE — run bun install from repo root" >&2
  exit 1
fi
if [ ! -e "$RG_SOURCE/bin/rg" ]; then
  echo "ERROR: missing ripgrep binary at $RG_SOURCE/bin/rg" >&2
  exit 1
fi

mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai" "$ELECTRON_DIR/node_modules/@vscode"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
cp -R "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"

ALIAS_DEST="$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk-binary"
rm -rf "$ALIAS_DEST"
mkdir -p "$ALIAS_DEST"
cp -R "$SDK_BIN_SOURCE/." "$ALIAS_DEST/"
chmod +x "$ALIAS_DEST/claude" 2>/dev/null || true

BIN_SIZE=$(stat -f%z "$ALIAS_DEST/claude" 2>/dev/null || stat -c%s "$ALIAS_DEST/claude")
if [ "$BIN_SIZE" -lt 50000000 ]; then
  echo "ERROR: claude binary only ${BIN_SIZE} bytes (expected ~210MB)" >&2
  exit 1
fi

rm -rf "$ELECTRON_DIR/node_modules/@vscode/ripgrep"
cp -R "$RG_SOURCE" "$ELECTRON_DIR/node_modules/@vscode/"
echo "Staged SDK + ripgrep into apps/electron/node_modules (arch=${ARCH}, claude=$((BIN_SIZE/1024/1024))MB)"
