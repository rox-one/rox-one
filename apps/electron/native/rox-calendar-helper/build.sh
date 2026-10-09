#!/usr/bin/env bash
# Build the Rox Apple Calendar helper (macOS 13+, EventKit).
#
#   ./build.sh [output-dir]        # default: ./bin
#
# Produces bin/rox-calendar-helper with the Info.plist embedded as __TEXT,__info_plist
# and ad-hoc codesigned, so macOS TCC can attribute the Calendars permission request.
# Override the signing identity with ROX_CALENDAR_HELPER_SIGN_IDENTITY.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$DIR/bin}"
BIN="$OUT_DIR/rox-calendar-helper"
TARGET="${ROX_CALENDAR_HELPER_TARGET:-$(uname -m)-apple-macos13.0}"
IDENTITY="${ROX_CALENDAR_HELPER_SIGN_IDENTITY:--}"

mkdir -p "$OUT_DIR"

swiftc -O \
  -target "$TARGET" \
  "$DIR/main.swift" \
  -o "$BIN" \
  -framework EventKit \
  -framework Foundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info.plist"

codesign --force --sign "$IDENTITY" --identifier com.rox.calendar-helper "$BIN"

echo "built $BIN"