#!/usr/bin/env bash
# Деплой ROX (server + webui) на хост: ssh + docker compose.
#
# Окружение (см. deploy/server/README.md):
#   DEPLOY_HOST       — хост (ssh-адрес)
#   DEPLOY_SSH_KEY    — приватный ключ (содержимое) ИЛИ DEPLOY_SSH_KEY_FILE — путь к ключу
#   DEPLOY_USER       — пользователь (по умолчанию root)
#   DEPLOY_PATH       — каталог compose на хосте (по умолчанию /opt/rox-server)
#   DEPLOY_SMOKE_URL  — (опционально) публичный URL приложения для post-deploy smoke (<url>/health)
#
# Идемпотентен: повторный вызов делает pull + up текущего :main.
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:=root}"
: "${DEPLOY_PATH:=/opt/rox-server}"

key_file="${DEPLOY_SSH_KEY_FILE:-}"
cleanup_key=""
if [[ -z "${key_file}" ]]; then
  : "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY (или DEPLOY_SSH_KEY_FILE) is required}"
  key_file="$(mktemp)"
  cleanup_key="${key_file}"
  printf '%s\n' "${DEPLOY_SSH_KEY}" > "${key_file}"
fi
chmod 600 "${key_file}"
trap '[[ -n "${cleanup_key}" ]] && rm -f "${cleanup_key}"' EXIT

echo "→ deploy: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
ssh -i "${key_file}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
  "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "cd '${DEPLOY_PATH}' && docker compose pull && docker compose up -d && docker compose ps"

if [[ -n "${DEPLOY_SMOKE_URL:-}" ]]; then
  url="${DEPLOY_SMOKE_URL%/}/health"
  for i in $(seq 1 30); do
    body="$(curl -fsS -m 10 "${url}" 2>/dev/null || true)"
    if printf '%s' "${body}" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      echo "✓ deploy smoke ok: ${url}"
      exit 0
    fi
    echo "… ждём (${i}/30)"
    sleep 10
  done
  echo "✗ smoke не прошёл: ${url}" >&2
  exit 1
fi

echo "✓ deploy выполнен (DEPLOY_SMOKE_URL не задан — smoke пропущен)"
