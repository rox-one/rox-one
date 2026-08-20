#!/usr/bin/env bash
# Copy packed knowledge-engine binary from OEM payload dir into gitignored extraResources.
# Does not git-add resources/oem-kernel/ (binaries stay out of Apache git).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST="${ELECTRON_ROOT}/resources/oem-kernel"
PAYLOAD_ROOT="${OEM_KERNEL_PAYLOAD_DIR:-/tmp/oem-kernel-payload}"

pin_plat() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin)
      case "$arch" in
        arm64) echo darwin-arm64 ;;
        x86_64) echo darwin-x64 ;;
        *) echo "unsupported darwin arch: $arch" >&2; return 1 ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64) echo linux-x64 ;;
        *) echo "unsupported linux arch: $arch" >&2; return 1 ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      echo win32-x64
      ;;
    *)
      echo "unsupported host OS: $os" >&2
      return 1
      ;;
  esac
}

PLAT="${1:-$(pin_plat)}"
SRC_DIR="${PAYLOAD_ROOT}/${PLAT}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Missing payload dir: $SRC_DIR (set OEM_KERNEL_PAYLOAD_DIR or pack first)" >&2
  exit 1
fi

mkdir -p "$DEST"
shopt -s nullglob
copied=0
for f in "${SRC_DIR}"/knowledge-engine "${SRC_DIR}"/knowledge-engine.exe; do
  if [[ -f "$f" ]]; then
    cp "$f" "$DEST/"
    if [[ "$(basename "$f")" == knowledge-engine ]]; then
      chmod +x "${DEST}/knowledge-engine"
    fi
    echo "Staged $f -> $DEST/"
    copied=1
  fi
done
shopt -u nullglob

if [[ "$copied" -eq 0 ]]; then
  echo "No knowledge-engine* binary in $SRC_DIR" >&2
  exit 1
fi

echo "Staged OEM kernel for ${PLAT}. Do not git-add ${DEST} (gitignored except .gitkeep)."
