#!/usr/bin/env bash
set -euo pipefail

api_base="${INFISICAL_API_BASE:-http://127.0.0.1:18080/api}"
token_file="${INFISICAL_TOKEN_FILE:-$HOME/.local/share/infisical/runtime/access-token}"
org_id="${INFISICAL_ORG_ID:?set INFISICAL_ORG_ID}"
project_id="${INFISICAL_PROJECT_ID:?set INFISICAL_PROJECT_ID}"
identity_file="${FLEET_SSH_IDENTITY:-$HOME/.ssh/fleet_ansible_ed25519}"

if INFISICAL_DOMAIN="${api_base%/api}" infisical login status --silent >/dev/null 2>&1; then
  api_token="$(INFISICAL_DOMAIN="${api_base%/api}" infisical user get token --plain --silent)"
else
  test -s "$token_file" || { printf 'missing Infisical token file\n' >&2; exit 1; }
  api_token="$(<"$token_file")"
fi
trap 'unset api_token' EXIT INT TERM

curl_config() {
  printf 'silent\nshow-error\nfail-with-body\n'
  printf 'header = "Authorization: Bearer %s"\n' "$api_token"
  printf 'header = "Accept: application/json"\n'
  printf 'header = "Content-Type: application/json"\n'
}

api_get() {
  curl --config <(curl_config) "${api_base}$1"
}

api_send() {
  local method="$1" path="$2" body="$3"
  curl --config <(curl_config) --request "$method" --data-binary "$body" "${api_base}${path}"
}

provision_node() {
  local node="$1" tailnet_ip="$2"
  local identity_name="fleet-${node}" role_slug="node-${node}"
  local identities identity_id ua ua_client_id membership privileges secret_response client_secret
  local credentials_present=false

  if ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$identity_file" "root@${tailnet_ip}" \
      'test -s /etc/infisical/runtime/client-id && test -s /etc/infisical/runtime/client-secret'; then
    credentials_present=true
  fi

  identities="$(api_get "/v1/identities?orgId=${org_id}&limit=20000")"
  identity_id="$(jq -r --arg name "$identity_name" '.identities[]? | select(.identity.name == $name) | .identityId' <<<"$identities" | head -n 1)"
  if [[ -z "$identity_id" ]]; then
    identity_id="$(api_send POST /v1/identities "$(jq -nc --arg name "$identity_name" --arg org "$org_id" '{name:$name,organizationId:$org,role:"no-access",hasDeleteProtection:true,metadata:[{key:"managed-by",value:"fleet-infra"}]}')" | jq -er '.identity.id')"
  fi

  ua="$(api_get "/v1/auth/universal-auth/identities/${identity_id}" 2>/dev/null || true)"
  ua_client_id="$(jq -r '.identityUniversalAuth.clientId // empty' <<<"$ua")"
  if [[ -z "$ua_client_id" ]]; then
    # Current self-hosted plan rejects IP allowlists. Compensating controls:
    # unique per-node credential, viewer-only project membership, short token TTL.
    ua="$(api_send POST "/v1/auth/universal-auth/identities/${identity_id}" '{"accessTokenTTL":3600,"accessTokenMaxTTL":86400,"accessTokenNumUsesLimit":0,"accessTokenPeriod":0,"lockoutEnabled":true,"lockoutThreshold":5,"lockoutDurationSeconds":300,"lockoutCounterResetSeconds":30}')"
    ua_client_id="$(jq -er '.identityUniversalAuth.clientId' <<<"$ua")"
  fi

  membership="$(api_get "/v2/workspace/${project_id}/identity-memberships/${identity_id}" 2>/dev/null || true)"
  if ! jq -e '.identityMembership.identityId' >/dev/null 2>&1 <<<"$membership"; then
    api_send POST "/v2/workspace/${project_id}/identity-memberships/${identity_id}" '{"role":"viewer"}' >/dev/null
  fi

  api_send PATCH "/v2/workspace/${project_id}/identity-memberships/${identity_id}" \
    '{"roles":[{"role":"no-access","isTemporary":false}]}' >/dev/null

  privileges="$(api_get "/v2/identity-project-additional-privilege?identityId=${identity_id}&projectId=${project_id}")"
  if ! jq -e --arg slug "$role_slug" '.privileges[]? | select(.slug == $slug)' >/dev/null 2>&1 <<<"$privileges"; then
    api_send POST "/v2/identity-project-additional-privilege" "$(jq -nc \
      --arg identity "$identity_id" \
      --arg project "$project_id" \
      --arg slug "$role_slug" \
      --arg path "/nodes/${node}/**" \
      '{identityId:$identity,projectId:$project,slug:$slug,type:{isTemporary:false},permissions:[
        {subject:"secrets",action:["describeSecret","readValue"],conditions:{environment:"prod",secretPath:{"$glob":$path}}},
        {subject:"secret-folders",action:"read",conditions:{environment:"prod",secretPath:{"$glob":$path}}}
      ]}')" >/dev/null
  fi

  if [[ "$credentials_present" == false ]]; then
    secret_response="$(api_send POST "/v1/auth/universal-auth/identities/${identity_id}/client-secrets" '{"numUsesLimit":0,"ttl":31536000}')"
    client_secret="$(jq -er '.clientSecret' <<<"$secret_response")"

    jq -nc --arg client_id "$ua_client_id" --arg client_secret "$client_secret" \
      '{clientId:$client_id,clientSecret:$client_secret}' |
      ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$identity_file" "root@${tailnet_ip}" \
        'python3 -c '\''import json, os, pathlib, sys
d=json.load(sys.stdin)
p=pathlib.Path("/etc/infisical/runtime")
p.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, key in (("client-id","clientId"),("client-secret","clientSecret")):
    f=p/name
    f.write_text(d[key]+"\n")
    os.chmod(f,0o600)'\'''
    unset client_secret secret_response
  fi
  printf '%s\tidentity=%s\trole=%s\tcredentials=%s\n' "$node" "$identity_id" "$role_slug" "$credentials_present"
}

# FLEET_INFISICAL_NODES="name=192.0.2.10 name2=192.0.2.11"
test -n "${FLEET_INFISICAL_NODES:-}" || { printf 'set FLEET_INFISICAL_NODES=name=ip ...\n' >&2; exit 1; }
for pair in $FLEET_INFISICAL_NODES; do
  provision_node "${pair%%=*}" "${pair#*=}"
done
