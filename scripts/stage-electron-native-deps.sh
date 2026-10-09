#!/bin/bash
# Stage Claude Agent SDK + ripgrep + @tursodatabase into apps/electron so
# electron-builder.yml extraResources (from: node_modules/@anthropic-ai/...,
# node_modules/@vscode/ripgrep, release-native/@tursodatabase) resolve when
# packaging via electron:dist:* (build-dmg.sh and scripts/desktop-release.ts
# stage their own copies).
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
# @vscode/ripgrep >= 1.18 keeps the binary in a per-platform package.
RG_PLATFORM_PKG="ripgrep-darwin-${ARCH}"
RG_PLATFORM_SOURCE="$ROOT_DIR/node_modules/@vscode/${RG_PLATFORM_PKG}"
RG_BINARY=""
if [ -e "$RG_SOURCE/bin/rg" ]; then
  RG_BINARY="$RG_SOURCE/bin/rg"
elif [ -e "$RG_PLATFORM_SOURCE/bin/rg" ]; then
  RG_BINARY="$RG_PLATFORM_SOURCE/bin/rg"
fi

if [ ! -d "$SDK_SOURCE" ]; then
  echo "ERROR: missing $SDK_SOURCE — run bun install from repo root" >&2
  exit 1
fi
if [ ! -d "$SDK_BIN_SOURCE" ]; then
  echo "ERROR: missing $SDK_BIN_SOURCE — run bun install from repo root" >&2
  exit 1
fi
if [ -z "$RG_BINARY" ]; then
  echo "ERROR: no ripgrep binary (checked $RG_SOURCE/bin/rg and $RG_PLATFORM_SOURCE/bin/rg)" >&2
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
# The packaged runtime resolves node_modules/@vscode/ripgrep/bin/rg
# (runtime-resolver.ts). @vscode/ripgrep >= 1.18 no longer ships that path, so
# materialize it from the platform package and stage the platform package too.
if [ ! -e "$ELECTRON_DIR/node_modules/@vscode/ripgrep/bin/rg" ]; then
  mkdir -p "$ELECTRON_DIR/node_modules/@vscode/ripgrep/bin"
  cp "$RG_BINARY" "$ELECTRON_DIR/node_modules/@vscode/ripgrep/bin/rg"
  chmod +x "$ELECTRON_DIR/node_modules/@vscode/ripgrep/bin/rg"
fi
if [ -d "$RG_PLATFORM_SOURCE" ]; then
  rm -rf "$ELECTRON_DIR/node_modules/@vscode/${RG_PLATFORM_PKG}"
  cp -R "$RG_PLATFORM_SOURCE" "$ELECTRON_DIR/node_modules/@vscode/"
fi

# Stage the libSQL driver packages electron-builder.yml expects under
# release-native/@tursodatabase (copied into app/node_modules/@tursodatabase).
TURSO_STAGING="$ELECTRON_DIR/release-native/@tursodatabase"
rm -rf "$TURSO_STAGING"
mkdir -p "$TURSO_STAGING"
for pkg in database database-common "database-darwin-${ARCH}"; do
  SOURCE="$ROOT_DIR/node_modules/@tursodatabase/$pkg"
  if [ ! -d "$SOURCE" ]; then
    echo "ERROR: missing $SOURCE — run bun install from repo root" >&2
    exit 1
  fi
  mkdir -p "$TURSO_STAGING/$pkg"
  cp -R "$SOURCE/." "$TURSO_STAGING/$pkg/"
done

echo "Staged SDK + ripgrep + @tursodatabase into apps/electron (arch=${ARCH}, claude=$((BIN_SIZE/1024/1024))MB)"
