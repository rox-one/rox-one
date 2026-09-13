#!/usr/bin/env bash
set -euo pipefail

windmill_url="${WINDMILL_URL:?set WINDMILL_URL}"
project_id="${INFISICAL_PROJECT_ID:?set INFISICAL_PROJECT_ID}"
secret_path="${WINDMILL_SECRET_PATH:-/nodes/automation-01/windmill}"
infisical_domain="${INFISICAL_DOMAIN:-https://infisical.example.internal}"
payload_file="/run/windmill-admin-payload.json"
curl_config="/run/windmill-admin-curl.conf"

cleanup() {
  unset admin_password access_token secrets_json
  if command -v shred >/dev/null 2>&1; then
    shred -u "$payload_file" "$curl_config" 2>/dev/null || true
  else
    rm -f "$payload_file" "$curl_config"
  fi
}
trap cleanup EXIT INT TERM
umask 077

task_token="$(</etc/infisical/runtime/access-token)"
secrets_json="$(INFISICAL_TOKEN="$task_token" INFISICAL_DOMAIN="$infisical_domain" \
  infisical secrets --projectId="$project_id" --env=prod --path="$secret_path" --output=json --silent)"
unset task_token
admin_password="$(jq -er '.[] | select(.secretKey == "WINDMILL_ADMIN_PASSWORD") | .secretValue' <<<"$secrets_json")"
unset secrets_json

login() {
  local password="$1"
  jq -nc --arg email admin@windmill.dev --arg password "$password" '{email:$email,password:$password}' >"$payload_file"
  curl -fsS --data-binary "@${payload_file}" -H 'Content-Type: application/json' "${windmill_url}/api/auth/login"
}

if access_token="$(login "$admin_password" 2>/dev/null)"; then
  printf 'admin-password=already-hardened\n'
else
  access_token="$(login changeme)"
  {
    printf 'silent\nshow-error\nfail-with-body\n'
    printf 'header = "Authorization: Bearer %s"\n' "$access_token"
    printf 'header = "Content-Type: application/json"\n'
  } >"$curl_config"
  jq -nc --arg password "$admin_password" '{password:$password}' >"$payload_file"
  curl --config "$curl_config" --request POST --data-binary "@${payload_file}" "${windmill_url}/api/users/setpassword" >/dev/null
  unset access_token
  login "$admin_password" >/dev/null
  if login changeme >/dev/null 2>&1; then
    printf 'default-password-still-valid\n' >&2
    exit 1
  fi
  printf 'admin-password=hardened default-password=denied\n'
fi

