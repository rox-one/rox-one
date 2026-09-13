#!/usr/bin/env bash
set -euo pipefail

# Run on control_plane as root. Temporary API material lives only in /run and
# is revoked on every exit path. The deploy private key never leaves control-01.

coolify_container="${COOLIFY_CONTAINER:-coolify}"
coolify_url="${COOLIFY_URL:-http://127.0.0.1:8000}"
token_name="rox-fleet-bootstrap"
token_file="/run/rox-fleet-coolify-api-token"
curl_config="/run/rox-fleet-coolify-curl.conf"
payload_file="/run/rox-fleet-coolify-payload.json"
deploy_key="/root/.ssh/coolify_deploy"

cleanup() {
  docker exec "$coolify_container" php artisan tinker --execute="\
    App\\Models\\User::first()?->tokens()->where('name', '${token_name}')->delete();\
    @unlink('/tmp/${token_name}.token');" >/dev/null 2>&1 || true
  if command -v shred >/dev/null 2>&1; then
    shred -u "$token_file" "$curl_config" "$payload_file" 2>/dev/null || true
  else
    rm -f "$token_file" "$curl_config" "$payload_file"
  fi
}
trap cleanup EXIT INT TERM

test "$(id -u)" -eq 0 || { printf 'must run as root\n' >&2; exit 1; }
test -s "$deploy_key" || { printf 'missing deploy key: %s\n' "$deploy_key" >&2; exit 1; }
command -v docker >/dev/null
command -v curl >/dev/null
command -v jq >/dev/null

docker exec "$coolify_container" php artisan tinker --execute="\
  \$settings = App\\Models\\InstanceSettings::get();\
  \$settings->is_api_enabled = true;\
  \$settings->save();\
  \$user = App\\Models\\User::firstOrFail();\
  session(['currentTeam' => \$user->teams()->firstOrFail()]);\
  \$user->tokens()->where('name', '${token_name}')->delete();\
  \$token = \$user->createToken('${token_name}', ['read', 'write']);\
  file_put_contents('/tmp/${token_name}.token', \$token->plainTextToken);" >/dev/null

docker cp "$coolify_container:/tmp/${token_name}.token" "$token_file" >/dev/null
docker exec "$coolify_container" rm -f "/tmp/${token_name}.token"
chmod 0600 "$token_file"

token_value="$(<"$token_file")"
umask 077
{
  printf 'silent\nshow-error\nfail-with-body\n'
  printf 'header = "Accept: application/json"\n'
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "Authorization: Bearer %s"\n' "$token_value"
} >"$curl_config"
unset token_value

api_get() {
  curl --config "$curl_config" "${coolify_url}/api/v1$1"
}

api_post() {
  curl --config "$curl_config" --request POST --data-binary "@${payload_file}" "${coolify_url}/api/v1$1"
}

api_post_empty() {
  curl --config "$curl_config" --request POST "${coolify_url}/api/v1$1"
}

key_uuid="$(api_get /security/keys | jq -r '.[] | select(.name == "rox-fleet-control-plane") | .uuid' | head -n 1)"
if [[ -z "$key_uuid" ]]; then
  jq -n --rawfile private_key "$deploy_key" '{
    name: "rox-fleet-control-plane",
    description: "Dedicated Coolify key; private half exists only on control-01",
    private_key: $private_key
  }' >"$payload_file"
  key_uuid="$(api_post /security/keys | jq -er '.uuid')"
fi

register_server() {
  local name="$1" ip="$2" build_server="$3"
  local existing_uuid server_uuid state
  existing_uuid="$(api_get /servers | jq -r --arg ip "$ip" '.[] | select(.ip == $ip) | .uuid' | head -n 1)"
  if [[ -n "$existing_uuid" ]]; then
    server_uuid="$existing_uuid"
    state="exists"
  else
    jq -n \
      --arg name "$name" \
      --arg ip "$ip" \
      --arg key "$key_uuid" \
      --argjson build "$build_server" \
      '{name:$name, description:"ROX fleet target via tailnet-only SSH", ip:$ip,
        port:2222, user:"coolify", private_key_uuid:$key, is_build_server:$build,
        instant_validate:false, proxy_type:"none"}' >"$payload_file"
    server_uuid="$(api_post /servers | jq -er '.uuid')"
    state="created"
  fi
  api_post_empty "/servers/${server_uuid}/validate" >/dev/null
  printf '%s\t%s\t%s\n' "$name" "$state" "$server_uuid"
}

# FLEET_COOLIFY_TARGETS="name=192.0.2.13=false name=192.0.2.11=false"
test -n "${FLEET_COOLIFY_TARGETS:-}" || { printf 'set FLEET_COOLIFY_TARGETS=name=ip=build ...\n' >&2; exit 1; }
registered_ips=()
for spec in $FLEET_COOLIFY_TARGETS; do
  IFS='=' read -r name ip build <<<"$spec"
  register_server "$name" "$ip" "$build"
  registered_ips+=("$ip")
done

sleep 15
filter=$(printf '%s\n' "${registered_ips[@]}" | jq -Rsc 'split("\n") | map(select(length>0))')
api_get /servers | jq -r --argjson ips "$filter" '.[] | select(.ip as $ip | $ips | index($ip)) |
  [.name,.uuid,.ip,(.port|tostring),.user,(.is_reachable|tostring),(.is_usable|tostring)] | @tsv'
