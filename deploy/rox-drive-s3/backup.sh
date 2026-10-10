#!/usr/bin/env bash
# Nightly offsite backup for the ROX Drive object store (SeaweedFS on host `sw`).
#
# Installed as /usr/local/bin/rox-drive-backup.sh and driven by
# rox-drive-backup.timer (03:30 Europe/Moscow, Persistent=true).
#
# What it does, in order:
#   1. takes the flock, so two runs can never overlap;
#   2. stops rox-drive-s3 so the LevelDB filer store (data/filerldb2) and the
#      volume files (.dat/.idx) are frozen — a live copy can capture an .idx
#      that references bytes the matching .dat has not flushed yet;
#   3. writes MANIFEST.sha256 over the frozen tree;
#   4. tars data/ + s3.json + MANIFEST.sha256 and restarts the service;
#   5. encrypts the tarball with gpg (symmetric, AES-256, passphrase file);
#   6. uploads it, plus a .sha256 sidecar, to the GCS bucket;
#   7. keeps only the newest KEEP_LOCAL archives on local disk.
#
# Config on the host, all mode 0600, directory mode 0700:
#   /etc/rox-drive-backup/sa.json       GCS service-account key (objectAdmin on
#                                       the backup bucket only)
#   /etc/rox-drive-backup/passphrase    gpg symmetric passphrase
#   /etc/rox-drive-backup/backup.env    optional overrides (see below)
#
# Why gpg and not age: age reads a passphrase only from a TTY and has no
# --passphrase-file, which makes unattended runs awkward; gpg does both
# symmetric encryption and a batch passphrase file. The passphrase never leaves
# the host, so read access to the GCS bucket alone cannot recover the SeaweedFS
# credentials in s3.json.
set -euo pipefail

CONF_DIR=${ROX_DRIVE_BACKUP_CONF:-/etc/rox-drive-backup}
SOURCE_DIR=${ROX_DRIVE_SOURCE_DIR:-/opt/rox-drive/data}
CRED_FILE=${ROX_DRIVE_CRED_FILE:-/opt/rox-drive/s3.json}
WORK_DIR=${ROX_DRIVE_BACKUP_WORK:-/var/backups/rox-drive}
SERVICE=${ROX_DRIVE_SERVICE:-rox-drive-s3}
GCS_BUCKET=${ROX_DRIVE_BACKUP_BUCKET:-gs://rox-drive-backup}
GCS_PREFIX=${ROX_DRIVE_BACKUP_PREFIX:-daily}
KEEP_LOCAL=${ROX_DRIVE_BACKUP_KEEP_LOCAL:-2}
LOCK_FILE=${ROX_DRIVE_BACKUP_LOCK:-/run/rox-drive-backup.lock}

SA_KEY="$CONF_DIR/sa.json"
PASSPHRASE_FILE="$CONF_DIR/passphrase"

# shellcheck source=/dev/null
[ -r "$CONF_DIR/backup.env" ] && . "$CONF_DIR/backup.env"

log() { printf '%s rox-drive-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

for cmd in tar gpg gcloud sha256sum flock systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done
[ -d "$SOURCE_DIR" ] || die "source directory not found: $SOURCE_DIR"
[ -r "$CRED_FILE" ] || die "credentials file not readable: $CRED_FILE"
[ -r "$PASSPHRASE_FILE" ] || die "gpg passphrase file not readable: $PASSPHRASE_FILE"
# Service-account keys are optional: hosts that run on GCE (like `sw`) mint
# tokens from the metadata server with the VM's attached service account, and
# the project forbids creating SA keys outright, so a key file is required only
# when the metadata server cannot be reached.
HAVE_METADATA=0
if curl -sf -m 2 -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/ >/dev/null 2>&1; then
  HAVE_METADATA=1
elif [ ! -r "$SA_KEY" ]; then
  die "no GCE metadata server and service-account key not readable: $SA_KEY"
fi

exec 9>"$LOCK_FILE"
flock -n 9 || { log "another run already holds $LOCK_FILE; nothing to do"; exit 0; }

install -d -m 700 "$WORK_DIR"

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
BASE="rox-drive-$STAMP"
STAGE="$WORK_DIR/$BASE.stage"
TARBALL="$WORK_DIR/$BASE.tar.gz"
ENC="$TARBALL.gpg"

rm -rf "$STAGE"
install -d -m 700 "$STAGE"

# Restart the service on every exit path once it has been stopped, so a failure
# half-way through can never leave the object store down.
restart_needed=0
restore_service() {
  if [ "$restart_needed" = 1 ]; then
    log "restarting $SERVICE"
    systemctl start "$SERVICE" || log "ERROR: failed to restart $SERVICE"
    restart_needed=0
  fi
}
trap restore_service EXIT

if systemctl is-active --quiet "$SERVICE"; then
  log "stopping $SERVICE for a consistent snapshot (brief downtime)"
  systemctl stop "$SERVICE"
  restart_needed=1
  sync
else
  log "WARN: $SERVICE is not active; snapshotting a cold store"
fi

# MANIFEST.sha256 is generated from /opt/rox-drive with paths relative to the
# archive root (data/..., s3.json), so `sha256sum -c MANIFEST.sha256` verifies
# the extraction directly.
(
  cd "$(dirname "$SOURCE_DIR")"
  find "$(basename "$SOURCE_DIR")" -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum "$(basename "$CRED_FILE")"
) > "$STAGE/MANIFEST.sha256"

FILE_COUNT=$(wc -l < "$STAGE/MANIFEST.sha256")
log "manifest: $FILE_COUNT files"

tar -czf "$TARBALL" \
  -C "$(dirname "$SOURCE_DIR")" "$(basename "$SOURCE_DIR")" "$(basename "$CRED_FILE")" \
  -C "$STAGE" MANIFEST.sha256

restore_service

RAW_SIZE=$(stat -c %s "$TARBALL")
log "archive: $TARBALL ($RAW_SIZE bytes raw)"

gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --compress-algo none \
  --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  --output "$ENC" "$TARBALL"

# The raw tarball holds s3.json in the clear; never leave it on disk.
rm -f "$TARBALL"
rm -rf "$STAGE"

ENC_SIZE=$(stat -c %s "$ENC")
ENC_SHA=$(sha256sum "$ENC" | awk '{print $1}')
printf '%s  %s\n' "$ENC_SHA" "$(basename "$ENC")" > "$ENC.sha256"

OBJECT="$GCS_BUCKET/$GCS_PREFIX/$(basename "$ENC")"
log "uploading $ENC ($ENC_SIZE bytes, sha256 $ENC_SHA) -> $OBJECT"

if [ "$HAVE_METADATA" = 0 ]; then
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$SA_KEY"
  export GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY"
fi
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

gcloud storage cp --quiet "$ENC" "$OBJECT"
gcloud storage cp --quiet "$ENC.sha256" "$OBJECT.sha256"

REMOTE_SIZE=$(gcloud storage ls -l "$OBJECT" | awk '$1 ~ /^[0-9]+$/ {print $1}' | head -1)
[ "$REMOTE_SIZE" = "$ENC_SIZE" ] || die "remote size $REMOTE_SIZE != local $ENC_SIZE for $OBJECT"
log "upload verified: $OBJECT ($REMOTE_SIZE bytes)"

# Local rotation: keep the newest KEEP_LOCAL encrypted archives only.
mapfile -t OLD < <(ls -1t "$WORK_DIR"/rox-drive-*.tar.gz.gpg 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)))
if [ "${#OLD[@]}" -gt 0 ]; then
  log "rotating out ${#OLD[@]} local archive(s) older than the newest $KEEP_LOCAL"
  printf '%s\n' "${OLD[@]}" | while read -r f; do rm -f "$f" "$f.sha256"; done
fi

log "done: $OBJECT"