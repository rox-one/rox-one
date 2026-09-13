#!/usr/bin/env bash
set -euo pipefail

api_base="${INFISICAL_API_BASE:-http://127.0.0.1:18080/api}"
project_id="${INFISICAL_PROJECT_ID:?set INFISICAL_PROJECT_ID}"
environment="prod"
node_name="${FLEET_NODE_NAME:-observability-01}"
secret_path="/nodes/${node_name}/observability"
api_token="$(INFISICAL_DOMAIN="${api_base%/api}" infisical user get token --plain --silent)"
runtime_dir="$HOME/.local/share/infisical/runtime"
payload_file="$(mktemp "$runtime_dir/rox-observability-secret.XXXXXX")"
chmod 0600 "$payload_file"

cleanup() {
  unset api_token secret_value
  shred -u "$payload_file" 2>/dev/null || rm -f "$payload_file"
}
trap cleanup EXIT INT TERM

curl_config() {
  printf 'silent\nshow-error\nfail-with-body\n'
  printf 'header = "Authorization: Bearer %s"\n' "$api_token"
  printf 'header = "Accept: application/json"\nheader = "Content-Type: application/json"\n'
}
api_get() { curl --config <(curl_config) "${api_base}$1"; }
api_post_file() { curl --config <(curl_config) --request POST --data-binary "@${payload_file}" "${api_base}$1"; }

ensure_folder() {
  local parent="$1" name="$2" listing
  listing="$(api_get "/v1/folders?workspaceId=${project_id}&environment=${environment}&path=$(jq -rn --arg v "$parent" '$v|@uri')")"
  if ! jq -e --arg name "$name" '.folders[]? | select(.name == $name)' >/dev/null 2>&1 <<<"$listing"; then
    jq -nc --arg workspace "$project_id" --arg env "$environment" --arg name "$name" --arg path "$parent" \
      '{workspaceId:$workspace,environment:$env,name:$name,path:$path}' >"$payload_file"
    api_post_file /v1/folders >/dev/null
  fi
}

path_encoded="$(jq -rn --arg v "$secret_path" '$v|@uri')"
ensure_folder /nodes "$node_name"
ensure_folder "/nodes/${node_name}" observability

create_secret() {
  local name="$1" bytes="$2"
  if curl --config <(curl_config) --output /dev/null \
    "${api_base}/v3/secrets/raw/${name}?workspaceId=${project_id}&environment=${environment}&secretPath=${path_encoded}" \
    >/dev/null 2>&1; then
    printf '%s\texists\n' "$name"
    return 0
  fi
  secret_value="$(openssl rand -base64 "$bytes" | tr -d '\n')"
  jq -nc --arg workspace "$project_id" --arg env "$environment" --arg path "$secret_path" --arg value "$secret_value" \
    '{workspaceId:$workspace,environment:$env,secretPath:$path,secretValue:$value,type:"shared",secretComment:"Managed by fleet-infra"}' >"$payload_file"
  api_post_file "/v3/secrets/raw/${name}" | jq -r '.secret.secretKey + "\tcreated"'
  unset secret_value
}

create_secret GRAFANA_ADMIN_PASSWORD 24
create_secret RESTIC_PASSWORD 36
