#!/usr/bin/env bash
# Build rox-tg-linkd locally and install it on the platform host (CT101) as a
# loopback-only systemd service. Secrets are NOT shipped by this script: the
# env file /etc/rox-tg-linkd.env (mode 600) must already exist on the host with
#   TG_BOT_TOKEN=...        (from @BotFather, the same token the widget uses)
#   TG_BOT_USERNAME=rox_one_bot
#   LINK_AUTH_TOKEN=...     (bearer token the website / tg-link proxy present)
#   TG_POLL_TIMEOUT_SEC=25
#
#   services/rox-tg-linkd/deploy/install-ct.sh [root@host]
set -euo pipefail

HOST="${1:-root@100.126.90.2}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

bun run build

ssh "$HOST" 'install -d -m 755 /opt/rox-tg-linkd && test -s /etc/rox-tg-linkd.env || { echo "missing /etc/rox-tg-linkd.env on $HOST" >&2; exit 1; }'
scp -q dist/rox-tg-linkd.js "$HOST:/opt/rox-tg-linkd/rox-tg-linkd.js"
scp -q deploy/rox-tg-linkd.service "$HOST:/etc/systemd/system/rox-tg-linkd.service"

ssh "$HOST" 'chmod 644 /etc/systemd/system/rox-tg-linkd.service && chmod 755 /opt/rox-tg-linkd/rox-tg-linkd.js \
  && systemctl daemon-reload && systemctl enable --now rox-tg-linkd >/dev/null \
  && sleep 3 && systemctl is-active rox-tg-linkd && curl -s --max-time 10 http://127.0.0.1:8095/api/health'
echo