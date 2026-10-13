#!/usr/bin/env bash
# Деплой приложения ROX (server + webui) через Coolify API.
#
# Окружение (см. deploy/coolify/README.md):
#   COOLIFY_URL           — базовый URL панели Coolify (без слэша на конце)
#   COOLIFY_API_TOKEN     — API-токен Coolify (Keys & Tokens → API tokens)
#   COOLIFY_APP_UUID      — UUID приложения (source = Docker image ghcr.io/rox-one/rox-server:main)
#   COOLIFY_SMOKE_URL     — (опционально) публичный URL приложения для post-deploy smoke (/health)
#   COOLIFY_SMOKE_RETRIES — (опционально, по умолчанию 30) число попыток smoke с шагом 10 c
#
# Идемпотентен: повторный вызов = повторный деплой текущего :main.
set -euo pipefail

: "${COOLIFY_URL:?COOLIFY_URL is required}"
: "${COOLIFY_API_TOKEN:?COOLIFY_API_TOKEN is required}"
: "${COOLIFY_APP_UUID:?COOLIFY_APP_UUID is required}"

base="${COOLIFY_URL%/}"

echo "→ trigger deploy: ${base}/api/v1/deploy (app ${COOLIFY_APP_UUID})"
response="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
  -H 'Accept: application/json' \
  "${base}/api/v1/deploy?uuid=${COOLIFY_APP_UUID}")"
printf '%s\n' "${response}" | head -c 2000
echo

if [[ -n "${COOLIFY_SMOKE_URL:-}" ]]; then
  url="${COOLIFY_SMOKE_URL%/}/health"
  retries="${COOLIFY_SMOKE_RETRIES:-30}"
  echo "→ smoke: ${url} (до ${retries} попыток)"
  for i in $(seq 1 "${retries}"); do
    body="$(curl -fsS -m 10 "${url}" 2>/dev/null || true)"
    if printf '%s' "${body}" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      echo "✓ deploy smoke ok: ${url}"
      exit 0
    fi
    echo "… ждём (${i}/${retries})"
    sleep 10
  done
  echo "✗ smoke не прошёл за $((retries * 10)) c: ${url}" >&2
  exit 1
fi

echo "✓ deploy запрошен (COOLIFY_SMOKE_URL не задан — smoke пропущен)"
