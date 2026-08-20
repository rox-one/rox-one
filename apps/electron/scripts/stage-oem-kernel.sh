#!/usr/bin/env bash
# Rsync the unpacked OEM kernel platform dir into gitignored extraResources.
# Copies knowledge-engine, stage/, appearance/, and any other payload files.
# Does not git-add resources/oem-kernel/ (binaries stay out of Apache git).
# Missing payload is a warning only — dist packaging must still succeed.
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

PLAT="${PLAT:-${1:-$(pin_plat)}}"
SRC_DIR="${PAYLOAD_ROOT}/${PLAT}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "WARNING: Missing OEM kernel payload dir: $SRC_DIR (set OEM_KERNEL_PAYLOAD_DIR or pack first). Skipping OEM kernel extraResources; dist continues." >&2
  exit 0
fi

mkdir -p "$DEST"

# Preserve tracked README.md / .gitkeep; sync the rest of the unpacked platform dir.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude README.md --exclude .gitkeep "${SRC_DIR}/" "${DEST}/"
else
  echo "WARNING: rsync not found; copying payload with cp -a" >&2
  # Drop previous staged artifacts except tracked keepers.
  find "$DEST" -mindepth 1 ! -name README.md ! -name .gitkeep -exec rm -rf {} +
  cp -a "${SRC_DIR}/." "${DEST}/"
  rm -f "${DEST}/README.md" "${DEST}/.gitkeep" 2>/dev/null || true
fi

if [[ -f "${DEST}/knowledge-engine" ]]; then
  chmod +x "${DEST}/knowledge-engine"
fi

echo "Staged OEM kernel tree for ${PLAT} from ${SRC_DIR} -> ${DEST}."
echo "Do not git-add ${DEST} (gitignored except README.md / .gitkeep)."
