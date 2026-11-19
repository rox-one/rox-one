#!/usr/bin/env bash
# Rox Cloud smoke: one process must serve the site, the console, the admin panel
# and the API, and the bootstrap key must reach an account.
#
# Usage: scripts/cloud-smoke.sh
# Exit code 0 means every address answered as expected; anything else prints the
# failing address and the last server log line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ROX_SMOKE_PORT:-8795}"
BASE="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d)"
LOG="${WORK}/server.log"
MASTER="$(openssl rand -base64 32)"
BOOT="rox_sk_live_$(openssl rand -hex 16)"
ADMIN="adm_$(openssl rand -hex 12)"

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "${PID}" 2>/dev/null || true
    wait "${PID}" 2>/dev/null || true
  fi
  rm -rf "${WORK}"
}
trap cleanup EXIT

cd "${ROOT}/apps/cloud-api"
ROX_MASTER_KEY="${MASTER}" \
ROX_PLATFORM_RATE_CENTS_PER_HOUR=100 \
ROX_BOOTSTRAP_KEY="${BOOT}" \
ROX_BOOTSTRAP_BALANCE_CENTS=500 \
ROX_ADMIN_KEY="${ADMIN}" \
PORT="${PORT}" \
  bun run src/server.ts >"${LOG}" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  if curl -fsS -m 1 "${BASE}/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

check() {
  local path="$1" expect="$2" label="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "${BASE}${path}" || true)"
  if [[ "${code}" != "${expect}" ]]; then
    echo "FAIL ${label}: ${path} -> ${code}, expected ${expect}" >&2
    tail -3 "${LOG}" >&2 || true
    exit 1
  fi
  echo "ok   ${label}: ${path} ${code}"
}

check /health 200 "health"
check / 200 "site"
check /docs.html 200 "docs"
check /console/ 200 "console"
check /admin/ 200 "admin"

ACCOUNT="$(curl -fsS -m 3 -H "Authorization: Bearer ${BOOT}" "${BASE}/v1/account")"
echo "${ACCOUNT}" | grep -q '"balance_cents":500' || {
  echo "FAIL account: ${ACCOUNT}" >&2
  exit 1
}
echo "ok   account: bootstrap balance is 500 cents"

TENANTS="$(curl -fsS -m 3 -H "Authorization: Bearer ${ADMIN}" "${BASE}/admin/tenants")"
echo "${TENANTS}" | grep -q '"name":"Моя команда"' || {
  echo "FAIL admin tenants: ${TENANTS}" >&2
  exit 1
}
echo "ok   admin: sees the bootstrap tenant"

echo "smoke passed"
