#!/bin/bash
# Stage Claude Agent SDK + ripgrep + @tursodatabase + the Bun/uv runtimes into
# apps/electron so electron-builder.yml extraResources/files (from:
# node_modules/@anthropic-ai/..., node_modules/@vscode/ripgrep,
# release-native/@tursodatabase, vendor/bun, resources/bin/darwin-<arch>) resolve
# when packaging via electron:dist:* (build-dmg.sh and scripts/desktop-release.ts
# stage their own copies).
#
# Arch note: staging follows ARCH (arg 1, default host arch) to match the
# electron-builder target. electron:dist / electron:dist:mac build the host arch,
# so host-arch staging is correct here. A caller who overrides ARCH must also
# pass the matching --<arch> to electron-builder, otherwise the packaged app
# ships foreign-architecture binaries (the SDK/ripgrep/turso/bun/uv staging and
# the target arch must always agree).
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

# Stage the Bun and uv runtimes the packaged app resolves at startup:
#   - <app>/vendor/bun/bun         → resolve-script-runtime.ts resolveBundledBun
#     (the Pi driver's node runtime; without it Pi falls back to
#      process.execPath and spawns the Electron binary with Bun-only --require
#      flags — pi-agent.ts:448-477 — so Pi SDK sessions cannot start).
#   - <app>/resources/bin/darwin-<arch>/uv → resolveBundledUv (Python/doc tooling).
# Both live outside node_modules, so electron:dist / electron:dist:mac shipped
# without them until now; only the release path (scripts/desktop-release.ts,
# build-dmg.sh) staged them.
#
# Reuse the release helpers verbatim rather than copying build-dmg.sh's curl:
# scripts/build/common.ts owns the pinned versions (BUN_VERSION / UV_VERSION),
# release URLs and checksum verification, so there is exactly one source of
# truth and no version drift between the release and dist paths.
BUN_DEST_DIR="$ELECTRON_DIR/vendor/bun"
UV_DEST_DIR="$ELECTRON_DIR/resources/bin/darwin-${ARCH}"
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found on PATH — required to fetch the pinned Bun/uv runtimes" >&2
  exit 1
fi
# rm-before-copy: drop any stale/foreign-arch binary so a failed or changed
# download can never leave a previous runtime behind.
rm -rf "$BUN_DEST_DIR"
rm -rf "$UV_DEST_DIR"
if ! (cd "$ROOT_DIR" && STAGE_ARCH="$ARCH" bun -e '
const arch = process.env.STAGE_ARCH === "x64" ? "x64" : "arm64"
const config = {
  platform: "darwin", arch,
  upload: false, uploadLatest: false, uploadScript: false,
  rootDir: process.cwd(), electronDir: process.cwd() + "/apps/electron",
}
const { downloadBun, downloadUv } = await import("./scripts/build/common.ts")
await downloadBun(config)
await downloadUv(config)
'); then
  echo "ERROR: failed to stage Bun/uv from the pinned release (scripts/build/common.ts); check network access to github.com/oven-sh/bun and github.com/astral-sh/uv" >&2
  exit 1
fi

BUN_STAGED="$BUN_DEST_DIR/bun"
if [ ! -x "$BUN_STAGED" ]; then
  echo "ERROR: missing $BUN_STAGED after staging — expected the pinned Bun release binary" >&2
  exit 1
fi
BUN_SIZE=$(stat -f%z "$BUN_STAGED" 2>/dev/null || stat -c%s "$BUN_STAGED")
if [ "$BUN_SIZE" -lt 10000000 ]; then
  echo "ERROR: bun binary only ${BUN_SIZE} bytes (expected >10MB)" >&2
  exit 1
fi

UV_STAGED="$UV_DEST_DIR/uv"
if [ ! -x "$UV_STAGED" ]; then
  echo "ERROR: missing $UV_STAGED after staging — expected the pinned uv release binary" >&2
  exit 1
fi
UV_SIZE=$(stat -f%z "$UV_STAGED" 2>/dev/null || stat -c%s "$UV_STAGED")
if [ "$UV_SIZE" -lt 5000000 ]; then
  echo "ERROR: uv binary only ${UV_SIZE} bytes (expected >5MB)" >&2
  exit 1
fi

echo "Staged SDK + ripgrep + @tursodatabase + Bun + uv into apps/electron (arch=${ARCH}, claude=$((BIN_SIZE/1024/1024))MB, bun=$((BUN_SIZE/1024/1024))MB, uv=$((UV_SIZE/1024/1024))MB)"
