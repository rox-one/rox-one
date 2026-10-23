# rox-chat — self-hosted chat relay

Deployment for the ROX chat relay: a self-hosted Apache-2.0 relay (see NOTICE) that
speaks the NIP-01/NIP-42 protocol (`wss://chat.rox.one`) and exposes the
matching REST + media endpoints (`https://chat.rox.one/api/...`,
`https://chat.rox.one/media`). It is what backs the messenger surface
described in [`docs/messenger/messenger-contract.md`](../../docs/messenger/messenger-contract.md).

> **Already live.** The relay is deployed and serving on host `sw` (region
> `eu-swiss`). This directory is the *record* of that deployment, not a
> deployer: **do not run a deploy from this repo.** Re-running the installer
> is only meaningful on a fresh host or for a deliberate re-deploy.

## Deployment facts

| Item | Value |
| --- | --- |
| Host | `sw` (region `eu-swiss`), public IP `34.65.148.193` |
| Domain | `chat.rox.one` (TLS terminated locally by Caddy) |
| Relay upstream | `127.0.0.1:3300` on the host (loopback only) |
| Compose project / dir | `rox-chat` / `/opt/rox-chat` |
| Backups | `/opt/rox-chat-backups/<ts>/` (mode `700`) |
| Upstream image | `ghcr.io/block/buzz:main` (override with `BUZZ_IMAGE`) |

Container service names, volumes, networks and the `BUZZ_*` environment
variables are **upstream identifiers required by the image** and are kept
as-is. Only two values are host-specific, and `deploy.sh` rewrites them at
install time (see below): the compose project `name:` and the loopback port
binding.

## Files

| File | Purpose |
| --- | --- |
| `compose.yml` | Verbatim upstream-style stack: `relay`, `postgres`, `redis`, `minio`, `minio-init`. |
| `deploy.sh` | Idempotent installer for the `sw` host. Snapshots `/etc/caddy` and `docker ps`, rewrites the two host-specific values, generates `.env` + keys on first run, then brings the stack up. |
| `Caddy.site` | Caddy site block (`chat.rox.one` → `127.0.0.1:3300`, WebSocket-capable). Installed as `/etc/caddy/chat-rox-one.caddy`. |
| `NOTICE` | Upstream attribution. |

## Layout on the host

| Path | Notes |
| --- | --- |
| `/opt/rox-chat/compose.yml` | Copied from the installer's `/tmp/rox-chat-compose.yml` input, then rewritten. |
| `/opt/rox-chat/.env` | All secrets and runtime config, mode `600`. Generated once, never overwritten. |
| `/opt/rox-chat/keys/` | `owner.pub` / `owner.priv` / `relay.pub` (mode `700`). |
| `/opt/rox-chat-backups/<ts>/` | `caddy-etc/` (full copy of `/etc/caddy`) and `docker-ps.txt`; plus `env.bak` once `.env` exists. |
| `/etc/caddy/chat-rox-one.caddy` | Installed from `Caddy.site`, imported by `/etc/caddy/Caddyfile`. |

`relay.priv` is copied into `.env` as `BUZZ_RELAY_PRIVATE_KEY` and then
deleted from disk by the installer; only `.env` retains it.

## What `deploy.sh` does

1. Snapshots the current state into `/opt/rox-chat-backups/<ts>/`:
   `cp -a /etc/caddy <ts>/caddy-etc` and `docker ps -a` → `<ts>/docker-ps.txt`.
   (`/opt/rox-chat-backups` is forced to mode `700`.)
2. Copies the compose input to `/opt/rox-chat/compose.yml` and rewrites two
   values in place:
   - the port mapping → `"127.0.0.1:${BUZZ_HTTP_PORT:-3300}:3000"` (loopback
     only; Caddy is the sole public entry point);
   - the compose project name → `name: rox-chat`.
3. On first run only (no `/opt/rox-chat/.env`), generates every secret on the
   server and writes `.env` (mode `600`), then backs it up to `<ts>/env.bak`.
4. `docker compose pull` and `docker compose up -d --wait`.
5. Health check: `curl -fsS http://127.0.0.1:3300/_liveness` must return `200`.

The installer is run as root, with the compose file staged where it expects
it:

```sh
# on the host, as root
install -m 600 /dev/stdin /tmp/rox-chat-compose.yml < deploy/rox-chat/compose.yml
mkdir -p /opt/rox-chat/infra && cp deploy/rox-chat/deploy.sh /opt/rox-chat/infra/deploy.sh
bash /opt/rox-chat/infra/deploy.sh
```

## Secrets and keys

All secrets are generated **on the server** — nothing secret is ever committed
to this repository.

- The relay identity is a secp256k1 key pair produced with OpenSSL, under
  `/opt/rox-chat/keys/` (the installer calls
  `openssl ecparam -name secp256k1 -genkey`).
- Database, Redis, MinIO and the git-hook HMAC secret are 32-byte hex strings
  from `openssl rand -hex 32`.
- `deploy.sh` never regenerates an existing `.env`: delete it deliberately if
  you intend to re-key (and expect all clients to re-authenticate).

`.gitignore` in this directory excludes `.env`, `keys/`, `*.pem`, `*.priv`,
`*.pub` and `backups/`. See [`NOTICE`](NOTICE) for upstream attribution.

## Up / down

Run these on the host, in `/opt/rox-chat`:

```sh
cd /opt/rox-chat
docker compose --env-file .env up -d --wait   # start (or reconcile) the stack
docker compose ps                             # status
docker compose --env-file .env logs -f relay  # relay logs
docker compose down                           # stop and remove containers (volumes kept)
```

`docker compose down -v` additionally removes the data volumes and is **not**
part of a normal rollback.

## Reversible rollback

Every install snapshots the state it is about to change, so a rollback is a
two-part, fully reversible operation:

```sh
# 1) Stop the stack (containers only; volumes/data are preserved).
cd /opt/rox-chat
docker compose down

# 2) Restore the Caddy configuration that predates the deploy.
TS=<the timestamp of the backup to revert to>          # e.g. 20261014-181500
sudo rm -rf /etc/caddy
sudo cp -a /opt/rox-chat-backups/$TS/caddy-etc /etc/caddy
sudo systemctl reload caddy            # or: caddy reload --config /etc/caddy/Caddyfile
```

`/opt/rox-chat-backups/<ts>/caddy-etc` is a byte-for-byte copy of `/etc/caddy`
as it was before the installer ran, and `docker-ps.txt` records the containers
that were running at that moment (restore any that the deploy displaced). If
`.env` was touched, `<ts>/env.bak` holds the pre-install environment file.

Because the snapshot is taken before any change, and no state outside
`/opt/rox-chat` and `/etc/caddy` is mutated, this rollback returns the host to
its pre-deploy state.

## DNS

`chat.rox.one` is an `A` record pointing at the host's public IP:

```
chat.rox.one.  A  34.65.148.193
```

Cloudflare, DNS-only (no proxy). Caddy on `sw` issues the Let's Encrypt
certificate for `chat.rox.one` directly, which is why the record must stay
unproxied. Caddy is the only public listener; the relay itself binds to
`127.0.0.1:3300`.
