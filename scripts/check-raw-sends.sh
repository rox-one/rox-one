#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

pattern='(^|[^[:alnum:]_])(webContents|sender|window)\.send\('

normalize_source() {
  echo "$1" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//'
}

is_allowed_legacy_send() {
  local path="$1"
  local source="$2"
  local normalized_source
  normalized_source="$(normalize_source "$source")"

  case "$path|$normalized_source" in
    "apps/electron/src/main/window-manager.ts|window.webContents.send(channel, ...args)" ) return 0 ;;
    "apps/electron/src/main/ssh-tunnel/ipc.ts|if (!win.isDestroyed()) win.webContents.send(channel, payload)" ) return 0 ;;
    "apps/electron/src/main/ssh-tunnel/ipc.ts|win.webContents.send(SSH_BOOTSTRAP_PROGRESS_EVENT, { hostId, ...p })" ) return 0 ;;
    "apps/electron/src/main/ssh-tunnel/ipc.ts|win.webContents.send(SSH_CONNECTION_STATUS_EVENT, s)" ) return 0 ;;
    "apps/electron/src/main/index.ts|try { _event.sender.send('transfer:progress', { sessionIndex: idx, sessionCount: count, chunkSent, chunkTotal }) } catch { /* renderer may be gone */ }" ) return 0 ;;
    "apps/electron/src/main/browser-pane-manager.ts|host.webContents.send('omnibox:open')" ) return 0 ;;
    "apps/electron/src/main/browser-pane-manager.ts|instance.toolbarView.webContents.send(TOOLBAR_CHANNELS.FORCE_CLOSE_MENU, { reason })" ) return 0 ;;
    "apps/electron/src/main/browser-pane-manager.ts|instance.toolbarView.webContents.send(TOOLBAR_CHANNELS.STATE_UPDATE, state)" ) return 0 ;;
    "apps/electron/src/main/browser-pane-manager.ts|instance.toolbarView.webContents.send(TOOLBAR_CHANNELS.THEME_COLOR, color)" ) return 0 ;;
  esac

  return 1
}

found=0

while IFS= read -r match; do
  path="${match%%:*}"
  rest="${match#*:}"
  line="${rest%%:*}"
  source="${rest#*:}"

  if is_allowed_legacy_send "$path" "$source"; then
    continue
  fi

  if [ "$found" -eq 0 ]; then
    echo "Raw renderer IPC sends found. Route new IPC through the typed transport/event sink." >&2
  fi
  echo "$path:$line:$source" >&2
  found=1
done < <(
  rg -n --glob '*.ts' --glob '!apps/electron/src/main/__tests__/**' --glob '!apps/electron/src/main/browser-cdp.ts' \
    "$pattern" apps/electron/src/main apps/electron/src/preload || true
)

if [ "$found" -ne 0 ]; then
  exit 1
fi
