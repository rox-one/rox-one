#!/usr/bin/env bash
# Rox chat relay (based on Block's Buzz, Apache-2.0) — reversible deploy on eu-swiss.
set -euo pipefail
D=/opt/rox-chat; TS=$(date +%Y%m%d-%H%M%S); BK=/opt/rox-chat-backups/$TS
mkdir -p "$D" "$BK"; chmod 700 /opt/rox-chat-backups
cp -a /etc/caddy "$BK/caddy-etc"
docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' > "$BK/docker-ps.txt"
cp /tmp/rox-chat-compose.yml "$D/compose.yml"
# bind relay to loopback only
sed -i 's|"${BUZZ_HTTP_PORT:-3000}:3000"|"127.0.0.1:${BUZZ_HTTP_PORT:-3300}:3000"|' "$D/compose.yml"
sed -i 's/^name: buzz-prod/name: rox-chat/' "$D/compose.yml"
if [ ! -f "$D/.env" ]; then
  umask 077
  h(){ openssl rand -hex 32; }
  KEYDIR=$D/keys; mkdir -p $KEYDIR
  gen(){ openssl ecparam -name secp256k1 -genkey -noout -out "$1.pem"; openssl ec -in "$1.pem" -text -noout 2>/dev/null > "$1.txt"
    python3 - "$1" <<'PY'
import sys,re
t=open(sys.argv[1]+".txt").read()
def blk(n): 
  m=re.search(n+r":\s*\n((?:\s+[0-9a-f:]+\n)+)",t); return m.group(1).replace(":","").replace(" ","").replace("\n","")
p=blk("priv"); p=p[-64:].rjust(64,"0"); pub=blk("pub"); x=pub[2:66]
open(sys.argv[1]+".priv","w").write(p); open(sys.argv[1]+".pub","w").write(x)
PY
    rm -f "$1.txt"; }
  gen $KEYDIR/owner; gen $KEYDIR/relay
  cat > "$D/.env" <<E
BUZZ_IMAGE=ghcr.io/block/buzz:main
BUZZ_DOMAIN=chat.rox.one
RELAY_URL=wss://chat.rox.one
BUZZ_MEDIA_BASE_URL=https://chat.rox.one/media
BUZZ_MEDIA_SERVER_DOMAIN=chat.rox.one
BUZZ_CORS_ORIGINS=https://chat.rox.one
BUZZ_REQUIRE_AUTH_TOKEN=true
BUZZ_REQUIRE_RELAY_MEMBERSHIP=true
BUZZ_ALLOW_NIP_OA_AUTH=true
BUZZ_AUTO_MIGRATE=true
BUZZ_GIT_CONFORMANCE_PROBE=true
BUZZ_PUSH_ENABLED=false
BUZZ_PUSH_GATEWAY_DELIVERY_URL=https://push.buzz.xyz/v1/deliveries/apns
RUST_LOG=buzz_relay=info,buzz_db=info,buzz_auth=info,tower_http=info
RELAY_OWNER_PUBKEY=$(cat $KEYDIR/owner.pub)
BUZZ_RELAY_PRIVATE_KEY=$(cat $KEYDIR/relay.priv)
BUZZ_GIT_HOOK_HMAC_SECRET=$(h)
POSTGRES_DB=rox_chat
POSTGRES_USER=rox_chat
POSTGRES_PASSWORD=$(h)
REDIS_PASSWORD=$(h)
BUZZ_S3_ACCESS_KEY=$(openssl rand -hex 12)
BUZZ_S3_SECRET_KEY=$(h)
BUZZ_S3_BUCKET=rox-chat-media
BUZZ_S3_ADDRESSING_STYLE=path
BUZZ_HTTP_PORT=3300
E
  rm -f $KEYDIR/relay.priv
fi
chmod 600 "$D/.env"; cp -a "$D/.env" "$BK/env.bak"
cd "$D"
docker compose --env-file .env -f compose.yml pull -q
docker compose --env-file .env -f compose.yml up -d --wait
curl -fsS http://127.0.0.1:3300/_liveness && echo LIVE_OK
