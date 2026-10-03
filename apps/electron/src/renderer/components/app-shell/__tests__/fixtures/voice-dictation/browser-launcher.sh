#!/bin/sh
set -eu
# Preserve Playwright's inherited pipe descriptors and bind cleanup to exactly
# this private browser process group, including when Bun's CDP close stalls.
umask 077
printf '%s\n' "$$" > "$VOICE_BROWSER_PID_FILE"
exec "$VOICE_BROWSER_ACTUAL_EXECUTABLE" "$@"
