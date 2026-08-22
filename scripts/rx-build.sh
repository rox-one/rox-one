#!/usr/bin/env bash
# RX-PIP-0101 — локальный (и CI) вход в ту же сборку, что Dockerfile.build.
#
# Что делает:
#   1. Забирает секреты из Infisical (env prod) во временные файлы chmod 600.
#   2. Вызывает `docker buildx build` с `--secret id=...,src=...`.
#   3. По EXIT всегда удаляет временный каталог с секретами.
#
# Значения секретов НИКОГДА не печатаются в stdout/stderr.
#
# Использование:
#   bash scripts/rx-build.sh
#   RX_IMAGE_TAG=rox-one:dev bash scripts/rx-build.sh
#
# Окружение:
#   INFISICAL_DOMAIN      по умолчанию http://127.0.0.1:18080
#   INFISICAL_TOKEN       machine identity / service token (в CI обязательно)
#   INFISICAL_PROJECT_ID  по умолчанию c96c480c-fd39-4dbf-ae9e-f51df736ecc0
#   INFISICAL_ENV         по умолчанию prod
#   RX_IMAGE_TAG          тег образа, по умолчанию rox-one:local
#   RX_PLATFORM           опционально, например linux/amd64
#   RX_DOCKERFILE         по умолчанию Dockerfile.build

# Никогда не включать xtrace: в argv мог бы оказаться токен.
set +x
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-http://127.0.0.1:18080}"
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-c96c480c-fd39-4dbf-ae9e-f51df736ecc0}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
IMAGE_TAG="${RX_IMAGE_TAG:-rox-one:local}"
DOCKERFILE="${RX_DOCKERFILE:-Dockerfile.build}"

if ! command -v infisical >/dev/null 2>&1; then
  echo "[rx-build] нужна утилита infisical в PATH" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[rx-build] нужен docker в PATH" >&2
  exit 1
fi

export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS="${BUILDKIT_PROGRESS:-plain}"

# Каталог секретов: только этот процесс, файлы 600, удаление по EXIT.
umask 077
SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rx-build-secrets.XXXXXX")"
chmod 700 "$SECRET_DIR"

cleanup() {
  if [[ -n "${SECRET_DIR:-}" && -d "$SECRET_DIR" ]]; then
    rm -rf "$SECRET_DIR"
  fi
}
trap cleanup EXIT

echo "[rx-build] временный каталог секретов создан (путь не обязан быть скрыт, значения — да)" >&2

# Пишем секрет в файл. При ошибке Infisical — пустой файл (required=false в Dockerfile).
# stdout уходит только в файл; в журнал — факт наличия, не значение.
write_secret() {
  local key="$1"
  local dest="$2"
  local tmp
  tmp="$(mktemp "${SECRET_DIR}/.get.XXXXXX")"
  chmod 600 "$tmp"
  # --token только из env; значение не echo и не xtrace.
  get_args=(
    secrets get "$key"
    --projectId "$INFISICAL_PROJECT_ID"
    --env "$INFISICAL_ENV"
    --domain "$INFISICAL_DOMAIN"
    --plain
    --silent
    --log-destination stderr
  )
  if [[ -n "${INFISICAL_TOKEN:-}" ]]; then
    get_args+=(--token "$INFISICAL_TOKEN")
  fi
  if infisical "${get_args[@]}" >"$tmp"; then
    mv "$tmp" "$dest"
  else
    : >"$dest"
    rm -f "$tmp"
  fi
  chmod 600 "$dest"
  if [[ -s "$dest" ]]; then
    echo "[rx-build] секрет ${key}: получен" >&2
  else
    echo "[rx-build] секрет ${key}: отсутствует, сборка продолжится без него" >&2
  fi
}

write_secret GITHUB_TOKEN "$SECRET_DIR/github_token"
write_secret GH_TOKEN "$SECRET_DIR/gh_token"

if ! docker buildx version >/dev/null 2>&1; then
  echo "[rx-build] docker buildx недоступен — создаю builder rx-builder" >&2
  docker buildx create --name rx-builder --use --driver docker-container >/dev/null
fi

BUILD_CMD=(
  docker buildx build
  --file "$DOCKERFILE"
  --tag "$IMAGE_TAG"
  --secret "id=github_token,src=${SECRET_DIR}/github_token"
  --secret "id=gh_token,src=${SECRET_DIR}/gh_token"
  --load
)

if [[ -n "${RX_PLATFORM:-}" ]]; then
  BUILD_CMD+=(--platform "$RX_PLATFORM")
fi

BUILD_CMD+=("$ROOT")

echo "[rx-build] docker buildx build -f ${DOCKERFILE} -t ${IMAGE_TAG}" >&2
"${BUILD_CMD[@]}"
echo "[rx-build] образ ${IMAGE_TAG} собран" >&2
