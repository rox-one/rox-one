# rox-maild

Server-side half of Rox Mail. Two responsibilities, one small Bun/TypeScript
service that sits in front of a local Stalwart:

* **Inbound relay** — `POST /api/inbound` accepts a signed message from the
  Cloudflare Email Worker and hands the raw RFC 5322 body to Stalwart over SMTP.
* **Provisioning** — `POST /api/provision` turns a Rox access token into a real
  JMAP mailbox (`handle@rox.one`) using `@rox/shared/mail` (Stalwart management API).

```
Cloudflare Email Worker ──HTTPS+HMAC──▶ rox-maild ──SMTP :2525──▶ Stalwart
Rox desktop client ──Bearer token──▶ rox-maild ──JMAP mgmt──▶ Stalwart
Rox desktop client ──JMAP Basic auth──────────────────────▶ Stalwart :8480
```

Nothing is stored on the service: no database, no mail spool. Stalwart owns all
mailbox state; rox-maild is stateless apart from a bounded in-memory dedupe cache.

## Endpoints

| Method | Path | Purpose | Status codes |
|---|---|---|---|
| `POST` | `/api/inbound` | Signed message → local Stalwart SMTP | `200` `400` `401` `413` `502` |
| `POST` | `/api/provision` | Token → JMAP mailbox | `200` `401` `409` `502` |
| `GET`  | `/api/health` | Liveness + Stalwart reachability | `200` |

### `POST /api/inbound`

Request body (JSON, the exact bytes are what the signature covers):

```json
{ "from": "sender@example.com", "to": "mark@rox.one", "rawB64": "<base64 raw message>",
  "messageId": "<optional Message-ID>", "receivedAt": "<optional ISO timestamp>" }
```

* `X-Rox-Signature` — hex HMAC-SHA256 of the raw request body, key
  `MAIL_INBOUND_SECRET`. Missing/invalid → `401`.
* Body limit: **25 MiB** of raw message (the JSON envelope is capped slightly
  higher). Oversized → `413`.
* Idempotency: the `messageId` (or a SHA-256 of the raw message when absent) is
  remembered in a bounded LRU **after** a successful SMTP hand-off. A repeat
  returns `200` with `"duplicate": true`; a retry after a failed hand-off is
  allowed.
* `from`/`to` may carry a display name; the envelope address is extracted and
  header-injection characters are rejected (`400`).
* SMTP failure (unreachable, 4xx/5xx, timeout) → `502`.

Response: `{"ok":true,"messageId":"<id|null>","duplicate":false}`.

### `POST /api/provision`

Header: `Authorization: Bearer <rox access token>`.

1. The token is verified with `GET ${ROX_BROKER_URL}/api/me/account`
   (default base `https://rox.one`). `401`/`403` from the broker → `401`;
   network/5xx → `502`.
2. The account handle (`user.handle`, falling back to the local part of
   `user.email`, then `mark`) picks the address `handle@rox.one`.
3. Provisioning goes through `@rox/shared/mail` `StalwartAdmin`
   (`STALWART_ADMIN_URL` / `STALWART_ADMIN_USER` / `STALWART_ADMIN_PASSWORD`,
   domain `MAIL_DOMAIN`), idempotently:
   * free handle → account created;
   * handle already owned by the same Rox user → password rotated, same address
     returned;
   * handle owned by another account → `409`;
   * mail server unreachable / rejected → `502`.

Response: `{"address":"mark@rox.one","username":"mark@rox.one","password":"<one-time secret>","jmapUrl":"http://127.0.0.1:8480"}`.
The password is returned once and never persisted by this service.

### `GET /api/health`

`{"ok":true,"stalwart":true|false}` — always `200` while the process is up;
`stalwart` reflects `${STALWART_ADMIN_URL}/healthz/live`.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `MAIL_INBOUND_SECRET` | — | **required**; use 32+ random bytes (`openssl rand -hex 32`) |
| `MAIL_SMTP_HOST` | `127.0.0.1` | local Stalwart inbound listener |
| `MAIL_SMTP_PORT` | `2525` | |
| `MAIL_SMTP_TIMEOUT_MS` | `20000` | per-command SMTP timeout |
| `MAIL_SMTP_HELO` | `rox-maild` | EHLO name |
| `MAIL_DEDUPE_CAPACITY` | `5000` | remembered message ids |
| `ROX_BROKER_URL` | `https://rox.one` | token verification origin |
| `ROX_BROKER_TIMEOUT_MS` | `10000` | |
| `STALWART_ADMIN_URL` | `http://127.0.0.1:8480` | JMAP/management origin |
| `STALWART_ADMIN_USER` | — | **required** |
| `STALWART_ADMIN_PASSWORD` | — | **required** |
| `MAIL_DOMAIN` | `rox.one` | provisioned mailbox domain |
| `MAIL_JMAP_URL` | `STALWART_ADMIN_URL` | value returned as `jmapUrl` |
| `MAIL_HEALTH_TIMEOUT_MS` | `2500` | |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

Secrets are read from the environment only. Nothing is committed, and the
service never logs bodies, tokens or passwords.

## Run locally (no Docker)

```sh
MAIL_INBOUND_SECRET=$(openssl rand -hex 32) \
STALWART_ADMIN_USER=admin STALWART_ADMIN_PASSWORD=… \
bun run services/rox-maild/src/index.ts
```

Assumes Stalwart already listens on `127.0.0.1:8480` (JMAP/admin) and
`127.0.0.1:2525` (inbound SMTP) — see [docs/mail-local-stalwart.md](../../docs/mail-local-stalwart.md).

Unit tests for the pure helpers (signature, dot-stuffing, base64, dedupe):

```sh
bun test services/rox-maild/test
```

## Deploy on testct (docker compose)

`docker-compose.yml` runs Stalwart plus rox-maild; Stalwart state lives in the
named volumes, so the wizard below is a one-time step.

```sh
cd services/rox-maild
cp .env.example .env        # fill MAIL_INBOUND_SECRET, STALWART_ADMIN_PASSWORD
docker compose up -d --build
```

The first build compiles the image from the repository root
(`bun install` + `bun build`), which takes a few minutes.

### One-time Stalwart setup

Stalwart v0.16 stores everything except the datastore in its database, so a
fresh volume starts in **bootstrap mode**.

1. `docker compose up -d stalwart`, then open `http://127.0.0.1:8480/admin` and
   sign in with `STALWART_ADMIN_USER` / `STALWART_ADMIN_PASSWORD` (pinned via
   `STALWART_RECOVERY_ADMIN`).
2. **Server identity:** hostname `mx.rox.one`, default domain `rox.one`,
   *disable* automatic TLS (no public DNS in the test deployment), keep DKIM on.
3. **Storage / directory / logging:** accept defaults; keep the internal
   directory and use the **Console** log destination.
4. Finish the wizard, note the generated `admin@rox.one` credential (or keep
   using the pinned `STALWART_ADMIN_USER`), then `docker compose restart stalwart`.
5. **Listeners.** In Management → Network → Listeners make sure:
   * HTTP/JMAP is served on container port `8080` (reachable as
     `http://127.0.0.1:8480`, published by the compose file);
   * an **SMTP listener on port `2525`** accepts inbound mail, with the
     authentication policy exempting port `2525` — the same rule the local pilot
     uses (`local_port != 25 && local_port != 2525` in `MtaStageAuth.require`,
     see [docs/mail-local-stalwart.md](../../docs/mail-local-stalwart.md)).
   Restart the container after changing listeners.
6. `docker compose up -d` brings up rox-maild (it tolerates Stalwart being
   briefly unavailable).

Port `2525` is published on host loopback so external MX relays can reach the
inbound listener through a tunnel; `8480` exposes JMAP/management to the
desktop client. The rox-maild port (`MAILD_PORT`, default `8090`) is likewise
loopback-only — front it with the same tunnel/reverse proxy the Email Worker
uses.

## Verifying the deployment

Health:

```sh
curl -s http://127.0.0.1:8090/api/health
# {"ok":true,"stalwart":true}
```

Inbound — sign the body exactly as it is sent:

```sh
SECRET=…   # MAIL_INBOUND_SECRET
BODY='{"from":"friend@example.com","to":"mark@rox.one","rawB64":"UmVjZWl2ZWQ6IGZyb20geA0KDQpIZWxsbw==","messageId":"<demo-1@example.com>"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -s -X POST http://127.0.0.1:8090/api/inbound \
  -H "content-type: application/json" -H "X-Rox-Signature: $SIG" \
  --data-binary "$BODY"
# {"ok":true,"messageId":"<demo-1@example.com>","duplicate":false}   (second call: "duplicate":true)

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/api/inbound \
  -H "content-type: application/json" -H 'X-Rox-Signature: deadbeef' --data-binary "$BODY"
# 401
```

Provision:

```sh
curl -s -X POST http://127.0.0.1:8090/api/provision \
  -H "authorization: Bearer $ROX_ACCESS_TOKEN"
# {"address":"mark@rox.one","username":"mark@rox.one","password":"…","jmapUrl":"http://127.0.0.1:8480"}
```

Mailbox reachable over JMAP with the returned credentials:

```sh
curl -s -u "mark@rox.one:<password>" http://127.0.0.1:8480/jmap/session | head -c 200
```

## Cloudflare Email Worker contract

The worker must, for every incoming message:

1. read the raw message bytes and base64-encode them into `rawB64`;
2. build the JSON body
   `{"from": …, "to": …, "rawB64": …, "messageId": …, "receivedAt": …}`;
3. compute `HMAC-SHA256(bodyBytes, MAIL_INBOUND_SECRET)` and send the lowercase
   hex digest as `X-Rox-Signature`;
4. POST it to `https://<rox-maild-host>/api/inbound` and retry non-`2xx`
   responses with backoff (idempotency makes retries safe).

The signature covers the **exact** request bytes — re-serialising the JSON on
the way changes the digest and yields `401`.

## Security notes

* Loopback-only port bindings in the compose file; expose through an
  authenticated tunnel, not on the open internet.
* The HMAC secret never travels with the message; only the digest does.
* Message ids are the only retained state, capped by `MAIL_DEDUPE_CAPACITY`.
* The provisioning password is generated per request and never logged or
  stored; a repeated call for the same handle rotates it.