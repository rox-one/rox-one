# rox-drive-s3

Deployment for the self-hosted Drive object store: a single-node SeaweedFS
instance that provides the S3-compatible upload target for ROX Drive imports,
replacing Cloudflare R2. This mirrors what is running on host `sw`.

## Files

| File | Purpose |
| --- | --- |
| `rox-drive-s3.service` | systemd unit (master + volume + filer + S3 gateway in one process). |
| `s3.json.example` | SeaweedFS S3 identities file with placeholder credentials. |
| `install.sh` | Idempotent installer for a Debian/Ubuntu host (run as root). |

## Host assumptions

- Debian/Ubuntu with systemd, root access, `amd64` architecture.
- Outbound HTTPS to `github.com` to fetch the SeaweedFS release binary.
- Caddy already running on the host (it terminates TLS for `s3.rox.one`).

## Layout on the host

| Path | Notes |
| --- | --- |
| `/opt/rox-drive/bin/weed` | SeaweedFS binary from the `linux_amd64` release tarball. |
| `/opt/rox-drive/data` | Volume data (`-dir`). Never overwritten by the installer. |
| `/opt/rox-drive/s3.json` | S3 identities, mode `600`. Never overwritten if present. |
| `/etc/systemd/system/rox-drive-s3.service` | The unit. |
| `/etc/caddy/s3-rox-one.caddy` | Caddy vhost, imported from `/etc/caddy/Caddyfile`. |

All SeaweedFS ports bind to loopback: master `9333`, filer `8888`, volume
`8080`, S3 gateway `8333`. Nothing listens on a public interface directly.

## Public endpoint, TLS and DNS

- Endpoint: `https://s3.rox.one`, path-style addressing (`/<bucket>/<key>`).
- TLS: terminated by Caddy on `sw`, which `reverse_proxy`s to `127.0.0.1:8333`.
- DNS: A record `s3.rox.one` -> the host's public IP, **DNS-only** (grey cloud)
  in the Cloudflare `rox.one` zone, so Caddy issues the certificate.
- Bucket: `rox-drive`.

## Install

```sh
sudo deploy/rox-drive-s3/install.sh
```

The script creates `/opt/rox-drive/{bin,data}`, downloads the latest SeaweedFS
`linux_amd64` release into `/opt/rox-drive/bin`, installs a placeholder
`s3.json` (mode 600) only if one does not already exist, installs and enables
`rox-drive-s3`, then prints the follow-up steps (real credentials, bucket
creation, Caddy vhost, DNS, client env vars). Existing data and an existing
`s3.json` are left untouched. `FORCE_REINSTALL=1` re-downloads the binary.

Create the bucket from the loopback shell:

```sh
/opt/rox-drive/bin/weed shell <<< "s3.bucket.create -name rox-drive"
```

## Client configuration

The clients consume exactly these five environment variables (see
`packages/shared/src/drive/importers/r2-target.ts` and `.env.example`):

| Variable | Value |
| --- | --- |
| `ROX_DRIVE_S3_ENDPOINT` | `https://s3.rox.one` (base path, no bucket) |
| `ROX_DRIVE_S3_BUCKET` | `rox-drive` |
| `ROX_DRIVE_S3_REGION` | `us-east-1` |
| `ROX_DRIVE_S3_ACCESS_KEY_ID` | access key id from `s3.json` |
| `ROX_DRIVE_S3_SECRET_ACCESS_KEY` | secret access key from `s3.json` |

`ROX_DRIVE_S3_REGION` **must be set explicitly** to `us-east-1`; it is signed
into every request and the R2 default `auto` will not work against SeaweedFS.
Never commit real values — these are secrets.

## Key rotation

1. Add a second credential entry under the identity's `credentials` array in
   `/opt/rox-drive/s3.json` (keep mode `600`).
2. `systemctl restart rox-drive-s3`.
3. Update `ROX_DRIVE_S3_ACCESS_KEY_ID` / `ROX_DRIVE_S3_SECRET_ACCESS_KEY` on the
   clients and verify traffic still succeeds.
4. Remove the old credential entry and restart again.

## Backup

Copy `/opt/rox-drive/data` (the SeaweedFS volume directory) to another host to
back up the store. There is currently **no off-host backup** — the data lives
only on `sw`, so a host loss loses the objects.

## Smoke test

SigV4 PUT then GET against the public endpoint (curl 7.75+):

```sh
EP=https://s3.rox.one; BUCKET=rox-drive; KEY=smoke/$(date +%s).txt
export ROX_DRIVE_S3_ENDPOINT=$EP ROX_DRIVE_S3_REGION=us-east-1
# ROX_DRIVE_S3_ACCESS_KEY_ID / ROX_DRIVE_S3_SECRET_ACCESS_KEY must already be exported
printf 'drive smoke %s\n' "$(date -u)" > /tmp/smoke.txt
curl -fsS --aws-sigv4 "aws:amz:${ROX_DRIVE_S3_REGION}:s3" \
  --user "$ROX_DRIVE_S3_ACCESS_KEY_ID:$ROX_DRIVE_S3_SECRET_ACCESS_KEY" \
  -X PUT --data-binary @/tmp/smoke.txt "${EP}/${BUCKET}/${KEY}"
curl -fsS --aws-sigv4 "aws:amz:${ROX_DRIVE_S3_REGION}:s3" \
  --user "$ROX_DRIVE_S3_ACCESS_KEY_ID:$ROX_DRIVE_S3_SECRET_ACCESS_KEY" \
  "${EP}/${BUCKET}/${KEY}"
```

Alternatively exercise the repo client (`packages/shared` drive importer), which
signs with the same five `ROX_DRIVE_S3_*` variables. From the host itself you can
rule out Caddy/DNS with `curl http://127.0.0.1:8333/` after step 2 above.