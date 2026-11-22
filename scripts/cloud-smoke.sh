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
# The site, console and panel are the built Solid app; a stale bundle would let
# the smoke pass against yesterday's UI. Build first, then start the server.
(cd "${ROOT}" && bun run --cwd apps/cloud-web build >/dev/null)
ROX_MASTER_KEY="${MASTER}" \
ROX_PLATFORM_RATE_CENTS_PER_HOUR=100 \
ROX_BOOTSTRAP_KEY="${BOOT}" \
ROX_BOOTSTRAP_BALANCE_CENTS=500 \
ROX_GUEST_ENABLED=1 \
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
check /docs 200 "docs"
check /console 200 "console"
check /admin 200 "admin"

ACCOUNT="$(curl -fsS -m 3 -H "Authorization: Bearer ${BOOT}" "${BASE}/v1/account")"
echo "${ACCOUNT}" | grep -q '"balance_cents":500' || {
  echo "FAIL account: ${ACCOUNT}" >&2
  exit 1
}
echo "ok   account: bootstrap balance is 500 cents"

TENANTS="$(curl -fsS -m 3 -H "Authorization: Bearer ${ADMIN}" "${BASE}/v1/admin/tenants")"
echo "${TENANTS}" | grep -q '"name":"Моя команда"' || {
  echo "FAIL admin tenants: ${TENANTS}" >&2
  exit 1
}
echo "ok   admin: sees the bootstrap tenant"

expect_field() {
  local json="$1" needle="$2" label="$3"
  if ! printf '%s' "${json}" | grep -q "${needle}"; then
    echo "FAIL ${label}: ${json}" >&2
    tail -3 "${LOG}" >&2 || true
    exit 1
  fi
  echo "ok   ${label}"
}

TENANT_ID=""
if [[ "${TENANTS}" =~ \"id\":\"([^\"]+)\" ]]; then
  TENANT_ID="${BASH_REMATCH[1]}"
fi
if [[ -z "${TENANT_ID}" ]]; then
  echo "FAIL admin tenants: no tenant id in ${TENANTS}" >&2
  exit 1
fi

DETAIL="$(curl -fsS -m 3 -H "Authorization: Bearer ${ADMIN}" "${BASE}/v1/admin/tenants/${TENANT_ID}")"
expect_field "${DETAIL}" "\"id\":\"${TENANT_ID}\"" "admin detail: tenant id"
expect_field "${DETAIL}" '"paid":true' "admin detail: account is paid"
expect_field "${DETAIL}" '"balance_cents":500' "admin detail: wallet starts at 500"
expect_field "${DETAIL}" '"ledger":' "admin detail: ledger is present"
expect_field "${DETAIL}" '"audit":' "admin detail: audit is present"

CREDIT="$(curl -fsS -m 3 -X POST \
  -H "Authorization: Bearer ${ADMIN}" \
  -H 'content-type: application/json' \
  --data '{"amountCents":25,"reason":"smoke: проверка пополнения"}' \
  "${BASE}/v1/admin/tenants/${TENANT_ID}/credit")"
expect_field "${CREDIT}" '"balance_cents":525' "admin credit: balance is 525"
expect_field "${CREDIT}" '"kind":"topup"' "admin credit: ledger row is a topup"

PATCHED="$(curl -fsS -m 3 -X PATCH \
  -H "Authorization: Bearer ${ADMIN}" \
  -H 'content-type: application/json' \
  --data '{"monthlyCapCents":12345,"reason":"smoke: проверка потолка"}' \
  "${BASE}/v1/admin/tenants/${TENANT_ID}")"
expect_field "${PATCHED}" '"monthly_cap_cents":12345' "admin limits: cap is 12345"

AFTER="$(curl -fsS -m 3 -H "Authorization: Bearer ${ADMIN}" "${BASE}/v1/admin/tenants/${TENANT_ID}")"
expect_field "${AFTER}" '"balance_cents":525' "admin detail: credit reached the wallet"
expect_field "${AFTER}" '"monthly_cap_cents":12345' "admin detail: cap is stored"
expect_field "${AFTER}" '"action":"tenant.credit"' "admin detail: credit is in the audit"
expect_field "${AFTER}" '"action":"tenant.limits"' "admin detail: limits are in the audit"

ACCOUNT_AFTER="$(curl -fsS -m 3 -H "Authorization: Bearer ${BOOT}" "${BASE}/v1/account")"
expect_field "${ACCOUNT_AFTER}" '"balance_cents":525' "customer account: credit is visible"
expect_field "${ACCOUNT_AFTER}" '"monthly_cap_cents":12345' "customer account: cap is visible"

# No-registration door: a guest gets its own key and trial balance, and the key
# can reach its own account without touching the bootstrap tenant.
GUEST="$(curl -fsS -m 3 -X POST "${BASE}/v1/guest")"
expect_field "${GUEST}" '"object":"guest"' "guest: object"
expect_field "${GUEST}" '"balance_cents":2000' "guest: trial balance"
GUEST_KEY="$(printf '%s' "${GUEST}" | sed -n 's/.*"api_key":"\([^"]*\)".*/\1/p')"
if [[ -z "${GUEST_KEY}" ]]; then
  echo "FAIL guest: no api_key in ${GUEST}" >&2
  exit 1
fi
GUEST_ACCOUNT="$(curl -fsS -m 3 -H "Authorization: Bearer ${GUEST_KEY}" "${BASE}/v1/account")"
expect_field "${GUEST_ACCOUNT}" '"balance_cents":2000' "guest: account is reachable"

# Request journal at the front door sees the public guest call.
REQUESTS="$(curl -fsS -m 3 -H "Authorization: Bearer ${ADMIN}" "${BASE}/v1/admin/requests?limit=50")"
expect_field "${REQUESTS}" '"path":"/v1/guest"' "requests: guest call is recorded"

# Rotation: the old key stops immediately, the new one works.
ROTATED="$(curl -fsS -m 3 -X POST \
  -H "Authorization: Bearer ${ADMIN}" \
  -H 'content-type: application/json' \
  --data '{"reason":"smoke: проверка перевыпуска"}' \
  "${BASE}/v1/admin/tenants/${TENANT_ID}/rotate-key")"
NEW_KEY="$(printf '%s' "${ROTATED}" | sed -n 's/.*"api_key":"\([^"]*\)".*/\1/p')"
if [[ -z "${NEW_KEY}" ]]; then
  echo "FAIL rotate: no api_key in ${ROTATED}" >&2
  exit 1
fi
OLD_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "Authorization: Bearer ${BOOT}" "${BASE}/v1/account" || true)"
NEW_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "Authorization: Bearer ${NEW_KEY}" "${BASE}/v1/account" || true)"
if [[ "${OLD_CODE}" != "401" || "${NEW_CODE}" != "200" ]]; then
  echo "FAIL rotate: old ${OLD_CODE}, new ${NEW_CODE}" >&2
  exit 1
fi
echo "ok   rotate: old key 401, new key 200"

echo "smoke passed"
