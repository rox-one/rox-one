#!/usr/bin/env bash
# Install the ROX Drive S3 object store (SeaweedFS) on a Debian/Ubuntu host.
# Mirrors the live unit on host `sw`: a single-node loopback-only SeaweedFS
# with the S3 gateway on 127.0.0.1:8333, exposed publicly by Caddy as
# https://s3.rox.one.
#
# Idempotent: an existing /opt/rox-drive/data directory and an existing
# /opt/rox-drive/s3.json are never overwritten. Run as root:
#
#   sudo deploy/rox-drive-s3/install.sh
#
# Set FORCE_REINSTALL=1 to re-download the SeaweedFS binary over an existing one.
set -euo pipefail

PREFIX=/opt/rox-drive
BIN_DIR="$PREFIX/bin"
DATA_DIR="$PREFIX/data"
SECRET_FILE="$PREFIX/s3.json"
UNIT_NAME=rox-drive-s3
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}.service"
RELEASE_URL=https://github.com/seaweedfs/seaweedfs/releases/latest/download/linux_amd64.tar.gz
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (sudo $0)" >&2
  exit 1
fi

for cmd in curl tar install systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: missing required command: $cmd" >&2; exit 1; }
done

install -d -m 755 "$PREFIX" "$BIN_DIR"
install -d -m 755 "$DATA_DIR"

if [ ! -x "$BIN_DIR/weed" ] || [ "${FORCE_REINSTALL:-0}" = "1" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading SeaweedFS release from $RELEASE_URL"
  curl -fsSL "$RELEASE_URL" -o "$tmp/seaweedfs.tar.gz"
  tar -xzf "$tmp/seaweedfs.tar.gz" -C "$tmp"
  [ -f "$tmp/weed" ] || { echo "error: weed binary not found in release archive" >&2; exit 1; }
  install -m 755 "$tmp/weed" "$BIN_DIR/weed"
  echo "installed $BIN_DIR/weed"
else
  echo "SeaweedFS binary already present: $BIN_DIR/weed (set FORCE_REINSTALL=1 to replace)"
fi

if [ ! -e "$SECRET_FILE" ]; then
  install -m 600 "$HERE/s3.json.example" "$SECRET_FILE"
  echo "installed placeholder credentials at $SECRET_FILE (mode 600)"
  echo "!! replace the placeholder accessKey/secretKey before relying on this store"
else
  echo "keeping existing $SECRET_FILE (not overwritten)"
fi

install -m 644 "$HERE/${UNIT_NAME}.service" "$UNIT_PATH"
systemctl daemon-reload
systemctl enable --now "$UNIT_NAME"
echo "enabled and started ${UNIT_NAME}"

cat <<'EOT'

Follow-up steps (on the host that runs this unit):
  1. Put real credentials in /opt/rox-drive/s3.json (identities[0].credentials),
     then `systemctl restart rox-drive-s3`. Generate them, e.g.:
       openssl rand -hex 16   # access key id
       openssl rand -hex 32   # secret access key
  2. Create the bucket via the loopback shell:
       /opt/rox-drive/bin/weed shell <<< "s3.bucket.create -name rox-drive"
  3. Expose it over TLS with Caddy. /etc/caddy/s3-rox-one.caddy:
       s3.rox.one {
         reverse_proxy 127.0.0.1:8333
       }
     and in /etc/caddy/Caddyfile:  import /etc/caddy/s3-rox-one.caddy
     then `systemctl reload caddy`.
  4. Point DNS at this host: A record s3.rox.one -> <host public IP>, DNS-only
     (grey cloud in Cloudflare) so Caddy handles the certificate.
  5. Give the clients the five environment variables (never commit real values):
       ROX_DRIVE_S3_ENDPOINT          https://s3.rox.one
       ROX_DRIVE_S3_BUCKET            rox-drive
       ROX_DRIVE_S3_REGION            us-east-1
       ROX_DRIVE_S3_ACCESS_KEY_ID     <access key id from s3.json>
       ROX_DRIVE_S3_SECRET_ACCESS_KEY <secret access key from s3.json>
EOT