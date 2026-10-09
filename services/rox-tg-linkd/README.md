# rox-tg-linkd

Server-side half of Rox Telegram account linking (owner spec R4). One small
Bun/TypeScript service with no runtime dependencies:

* **Deep-link start** — `POST /api/link/start` mints a pending link with an
  8-character code and a `https://t.me/<bot>?start=<token>` deep link.
* **Bot long-poll** — raw Bot API `fetch` loop: `/start <token>` asks for the
  user's own contact, the contact binds the phone, and the bot sends the code.
* **Verification** — `POST /api/link/verify` turns the code into a durable
  phone binding, with attempt limits and a 30-minute TTL.

```
Rox desktop ──POST /api/link/start──▶ rox-tg-linkd ──getUpdates (long poll)──▶ Telegram
     │  deep link (tg:// / https)                    ◀── /start <token>
     └──────── user shares phone in Telegram ────────▶ contact (own only)
Rox desktop ──POST /api/link/verify {code}──▶ linked
```

## Flow

1. Desktop calls `POST /api/link/start { "roxUserId": "…" }` and receives
   `{ linkId, code, deepLink, tgDeepLink, expiresAt, status: "waiting-code" }`.
   `linkId` is the opaque pairing token (the same value embedded in the deep
   link); it addresses the link without adding a second secret.
   Repeated calls while a link is pending return the **same** token and code
   (idempotent).
2. The user opens the deep link; the bot replies with a **Share contact**
   keyboard. A forwards/foreign contact (`contact.user_id !== from.id`) is
   rejected and never binds a phone.
3. Sharing the user's own contact binds the phone and the bot replies
   «Ваш код: XXXX2345. У вас 30 минут — введите его в приложении Rox.»
4. The desktop polls `GET /api/link/status?roxUserId=…` and submits the code
   with `POST /api/link/verify { roxUserId, code }`, which returns
   `linked` | `expired` | `invalid`.

Codes are 8 characters from `A-Z2-9` (no `0`/`1`) and live for 30 minutes.

## Endpoints

| Method | Path | Purpose | Status codes |
|---|---|---|---|
| `POST` | `/api/link/start` | Pending link + deep link | `200` `400` `401` `503` |
| `POST` | `/api/link/verify` | Code → `linked`/`expired`/`invalid` | `200` `400` `401` |
| `GET`  | `/api/link/status?roxUserId=…` | Current state (plus `code` once issued) | `200` `400` `401` |
| `GET`  | `/api/health` | Honest readiness | `200` |

`401` only when `LINK_AUTH_TOKEN` is set (then every `/api/link/*` call needs
`Authorization: Bearer <token>`).

`503 {"error":"no_bot_token"}` / `{"error":"no_bot_username"}` — the service
cannot mint a usable link, so it refuses instead of inventing one.

### `GET /api/health`

* without `TG_BOT_TOKEN` → `{"ok":false,"reason":"no-token"}` (always `200`;
  the process is up but the feature is not — the header never claims success);
* with a token → `{"ok":true,"bot":"<username|null>"}`.

### Verify semantics

* no pending link / phone not shared yet → `invalid`;
* past TTL → `expired` (and the row is written back as expired);
* wrong code → `invalid`, and the pending link is invalidated on the attempt
  that crosses `LINK_MAX_ATTEMPTS`;
* correct code → `linked`, then idempotent (`linked` on every later call).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8095` | HTTP listen port |
| `TG_BOT_TOKEN` | — | bot token; empty is allowed but health reports `no-token` |
| `TG_BOT_USERNAME` | — | without `@`; learned from `getMe` when empty |
| `LINK_AUTH_TOKEN` | — | optional bearer for `/api/link/*` |
| `LINK_TTL_MS` | `1800000` | code lifetime (30 min) |
| `LINK_MAX_ATTEMPTS` | `10` | wrong codes before invalidation |
| `LINK_DB_PATH` | `./data/rox-tg-linkd.sqlite` | SQLite file (`:memory:` for tests) |
| `TG_POLL_TIMEOUT_SEC` | `25` | `getUpdates` long-poll timeout |
| `TG_BACKOFF_BASE_MS` | `1000` | first retry delay after a failed poll |
| `TG_BACKOFF_MAX_MS` | `60000` | backoff cap (exponential + jitter) |
| `TG_API_BASE` | `https://api.telegram.org` | override for a local Bot API server |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

Storage is a single SQLite database (`pending_links`, `links`). Tokens, phones
and codes are the only state; nothing is logged.

## Run locally (no Docker)

The owner's local secrets live in `/Users/t/.config/rox/platform-secrets-20261009.env`
(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_TEST_BOT_TOKEN`). Source
them with `set -a` so the exported `TELEGRAM_*` names become the environment,
then map them onto this daemon's `TG_BOT_TOKEN` / `TG_BOT_USERNAME`:

```sh
cd services/rox-tg-linkd
set -a; . /Users/t/.config/rox/platform-secrets-20261009.env; set +a
TG_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TG_BOT_USERNAME="$TELEGRAM_BOT_USERNAME" \
  PORT=18095 LINK_DB_PATH=./data/rox-tg-linkd.sqlite \
  bun run src/index.ts
```

Then, from another shell:

```sh
curl -s http://127.0.0.1:18095/api/health
# {"ok":true,"bot":"rox_one_bot"}

curl -s -X POST http://127.0.0.1:18095/api/link/start \
  -H 'content-type: application/json' -d '{"roxUserId":"user-1"}'
# {"ok":true,"roxUserId":"user-1","status":"waiting-code","code":"ABCD2345", ...}
```

Without sourcing the secrets (or with an empty `TG_BOT_TOKEN`) the daemon still
starts, but `/api/health` reports `{"ok":false,"reason":"no-token"}` and
`/api/link/start` refuses with `503 {"error":"no_bot_token"}`.

A one-off run without a secrets file:

```sh
TG_BOT_TOKEN=… TG_BOT_USERNAME=my_rox_bot bun run services/rox-tg-linkd/src/index.ts
```

Then:

```sh
curl -s http://127.0.0.1:8095/api/health
# {"ok":true,"bot":"my_rox_bot"}

curl -s -X POST http://127.0.0.1:8095/api/link/start \
  -H 'content-type: application/json' -d '{"roxUserId":"user-1"}'
# {"ok":true,"roxUserId":"user-1","status":"waiting-code","code":"ABCD2345",
#  "deepLink":"https://t.me/my_rox_bot?start=…","tgDeepLink":"tg://resolve?domain=my_rox_bot&start=…",
#  "expiresAt":…,"remainingMs":…}
```

Unit tests (pure primitives, SQLite state machine, own-contact rule, HTTP):

```sh
bun test services/rox-tg-linkd/test
```

## Deploy on testct (docker compose)

```sh
cd services/rox-tg-linkd
cp .env.example .env        # fill TG_BOT_TOKEN
docker compose up -d --build
curl -s http://127.0.0.1:8095/api/health
```

The desktop reaches the service through `ROX_TG_LINK_URL`
(default `http://127.0.0.1:8095`).

## Security notes

* Contact ownership is enforced server-side; a foreign contact is refused
  before any state changes.
* Codes and tokens are secrets: never logged, and returned only to the caller
  that created (or is verifying) the link.
* The service is loopback-only in compose; expose it through an authenticated
  tunnel and set `LINK_AUTH_TOKEN`.
* The bot token lives in the environment/secret store only — this repository
  ships no token.