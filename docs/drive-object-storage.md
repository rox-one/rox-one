# Drive object storage — self-hosted S3 (SeaweedFS)

Status: live since 2026-10-09 (owner decision). This replaces **Cloudflare R2**,
which was dropped for the drive destination before it was ever enabled.

ROX Drive cloud imports (Google Drive / OneDrive / Yandex Disk) upload every
imported byte to an S3-compatible object store. That store is now self-hosted:
**SeaweedFS** on host `sw`, bucket **`rox-drive`**, public endpoint
**`https://s3.rox.one`**.

## Deployment facts

| Item | Value |
|---|---|
| Object store | SeaweedFS (`weed`) |
| Host | `sw` (eu-swiss; `100.124.37.102` NetBird / `34.65.148.193` public) |
| systemd unit | `rox-drive-s3` |
| Binary | `/opt/rox-drive/bin/weed` |
| Data directory | `/opt/rox-drive/data` |
| S3 credentials | `/opt/rox-drive/s3.json` (mode `0600`) |
| Bucket | `rox-drive` |
| Public endpoint | `https://s3.rox.one` |
| TLS | Caddy on `sw`, vhost file `/etc/caddy/s3-rox-one.caddy`, LE cert |
| Upstream | Caddy → SeaweedFS S3 on `127.0.0.1:8333` |
| DNS | `s3.rox.one` → `A 34.65.148.193`, Cloudflare, DNS-only (no proxy) |

Honest status: this is a **single-node** store on `sw` with **~33 GB free** and
**no off-host backup yet**. Treat capacity and durability accordingly.

## The five environment variables

The client reads exactly five `ROX_DRIVE_S3_*` variables (see
`s3TargetOptionsFromEnv` in `packages/shared/src/drive/importers/r2-target.ts`):

| Variable | Production value |
|---|---|
| `ROX_DRIVE_S3_ENDPOINT` | `https://s3.rox.one` |
| `ROX_DRIVE_S3_BUCKET` | `rox-drive` |
| `ROX_DRIVE_S3_REGION` | `us-east-1` |
| `ROX_DRIVE_S3_ACCESS_KEY_ID` | from `/opt/rox-drive/s3.json` |
| `ROX_DRIVE_S3_SECRET_ACCESS_KEY` | from `/opt/rox-drive/s3.json` |

`ROX_DRIVE_S3_REGION` **must be set explicitly** to `us-east-1`. The client
default is the literal `auto`, which is R2-specific and is not a valid SigV4
region for SeaweedFS.

The endpoint is base-path only (no bucket); the client addresses objects
**path-style** as `<endpoint>/<bucket>/<key>`. Streaming PUT bodies are signed
with `UNSIGNED-PAYLOAD` over TLS; byte bodies are SHA-256 hashed.

### Where the variables are consumed

1. `packages/shared/src/drive/importers/r2-target.ts` — SigV4 signer and
   `createS3UploadTarget`; `s3TargetOptionsFromEnv(env)` reads the five vars and
   returns `null` when any required one is missing.
2. `packages/server-core/src/handlers/rpc/drive.ts` — `configureDriveImport()`
   builds the resumable import runner on top of the upload target.
3. `apps/electron/src/main/drive/register.ts` —
   `composeDriveImportEngine()` registers the four providers and calls
   `configureDriveImport`. It resolves the target from `process.env` first,
   then from the operator env file `<configDir>/drive-s3.env` via `loadEnvFile`
   (`packages/shared/src/drive/importers/env-file.ts`). `CONFIG_DIR` comes from
   `packages/shared/src/config/env.ts`: `ROX_CONFIG_DIR` when set, else `~/rox`
   once it is the Rox home, else the legacy `~/.rox` — on the owner's Mac today
   it resolves to `~/rox`. If the target
   is absent or invalid, the engine is deliberately left uncomposed and
   `drive:import*` answers `UNSUPPORTED_OPERATION` instead of failing per file
   at runtime.

## Operator file on workstations

Workstations do not read `/opt/rox-drive/s3.json`; they load the same values
from an operator env file. There are two equivalent copies, kept in sync:

```
<configDir>/drive-s3.env        # what the apps read (drive imports; mode 0600)
~/.config/rox/drive-s3.env      # ops/platform copy for shells (mode 0600)
```

`<configDir>` is the app config dir resolved by
`packages/shared/src/config/env.ts` (`ROX_CONFIG_DIR` → `~/rox` when it is the
Rox home → legacy `~/.rox`); on the owner's Mac today that is
`~/rox/drive-s3.env`. The packaged desktop app cannot see the shell
environment, so `composeDriveImportEngine()` reads that file itself
(`loadEnvFile`, same `KEY=VALUE` format); servers and shells can `set -a;
source` either copy.

Contents (same five names as above):

```
ROX_DRIVE_S3_ENDPOINT=https://s3.rox.one
ROX_DRIVE_S3_BUCKET=rox-drive
ROX_DRIVE_S3_REGION=us-east-1
ROX_DRIVE_S3_ACCESS_KEY_ID=...
ROX_DRIVE_S3_SECRET_ACCESS_KEY=...
```

Keep it `0600`; it holds a write-capable S3 key.

## Runbook

### Service status / restart (on host `sw`)

```sh
systemctl status rox-drive-s3
systemctl restart rox-drive-s3
journalctl -u rox-drive-s3 -n 100 --no-pager
```

### Bucket operations (`weed shell`)

```sh
/opt/rox-drive/bin/weed shell
# then, inside the shell:
s3.bucket.list
s3.bucket.create -name rox-drive
```

### Smoke test

From a workstation with either operator file exported, a path-style SigV4
client round-trip (boto3 shown; the verified checks on 2026-10-09 used the
repo's own client over `https://s3.rox.one` plus a stdlib `hmac`/`hashlib`
SigV4 script, both green):

```sh
set -a; . ~/.config/rox/drive-s3.env; set +a   # or <configDir>/drive-s3.env
python3 - <<'PY'
import os, boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["ROX_DRIVE_S3_ENDPOINT"],
    region_name=os.environ["ROX_DRIVE_S3_REGION"],
    aws_access_key_id=os.environ["ROX_DRIVE_S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["ROX_DRIVE_S3_SECRET_ACCESS_KEY"],
    config=Config(s3={"addressing_style": "path"}),
)
print("buckets:", [b["Name"] for b in s3.list_buckets()["Buckets"]])
s3.put_object(Bucket=os.environ["ROX_DRIVE_S3_BUCKET"], Key="smoke/hello.txt", Body=b"hello")
print("read back:", s3.get_object(Bucket=os.environ["ROX_DRIVE_S3_BUCKET"], Key="smoke/hello.txt")["Body"].read())
PY
```

The repo's own client is exercised by the `r2-target` unit tests (SigV4
signing, path-style addressing, timeouts); the boto3 script above is the
end-to-end check against the live endpoint.

### Backup

Data lives in a single directory: `/opt/rox-drive/data`. Back it up by copying
that directory (stop `rox-drive-s3` first, or take a filesystem snapshot, so the
volume files are consistent):

```sh
systemctl stop rox-drive-s3
tar -C /opt/rox-drive -czf /var/backups/rox-drive-$(date +%F).tar.gz data
systemctl start rox-drive-s3
```

There is currently **no scheduled off-host backup** — this is a known gap and
the main durability risk of the single-node setup.

### Credential rotation

1. Edit `/opt/rox-drive/s3.json` (mode `0600`) — it holds the SeaweedFS S3
   identity list (identity name, `accessKey`/`secretKey`, actions). Change the
   access key / secret, or add a new identity and remove the old one.
2. `systemctl restart rox-drive-s3`.
3. Update `ROX_DRIVE_S3_ACCESS_KEY_ID` / `ROX_DRIVE_S3_SECRET_ACCESS_KEY` in
   each workstation's `<configDir>/drive-s3.env` **and** the ops copy
   `~/.config/rox/drive-s3.env` to the new pair.
4. Re-run the smoke test above to confirm.

## Related

- Plan / status: `docs/plans/2026-10-09-platform-program.md` (§7.12 wave 4).
- Client header: `packages/shared/src/drive/importers/r2-target.ts`.