# rox-tg-linkd

Server-side half of Rox Telegram flows — the platform's single consumer of
`@rox_one_bot`. One small Bun/TypeScript service with no runtime dependencies:

* **Account linking (desktop, owner spec R4)** — `POST /api/link/start` mints a
  pending link with an 8-character code and a `https://t.me/<bot>?start=<token>`
  deep link; the bot asks for the user's own contact, the contact binds the
  phone, and the bot sends the code; `POST /api/link/verify` turns the code into
  a durable phone binding (attempt limits, 30-minute TTL).
* **Phone registration / sign-in (web)** — `POST /api/register/start` mints a
  token and the user opens the bot, presses **Share phone** and sends their own
  contact. That is the whole interaction: **no code**. The website polls
  `GET /api/register/status?token=…` until `ready`, then calls
  `POST /api/register/consume` (exactly-once) and creates the account.
* **Bot long-poll** — a raw Bot API `fetch` loop subscribing to `message` and
  `callback_query`.

```
Website     ──POST /api/register/start──▶ rox-tg-linkd ──getUpdates──▶ Telegram
   │  deep link (tg:// / https)                ◀── /start <token>
   │                                           ◀── contact (own only)
   └──GET /api/register/status (poll)──▶ ready { phone } ──consume──▶ account created
Rox desktop ──POST /api/link/start─────▶ pending link + code ──▶ /api/link/verify
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
| `POST` | `/api/register/start` | Registration token + deep link (no code) | `201` `400` `401` `503` |
| `GET`  | `/api/register/status?token=…` | `waiting`/`ready`/`expired`/`cancelled`/`consumed` | `200` `400` `401` `404` |
| `POST` | `/api/register/consume` | Close a ready registration once | `200` `400` `401` `404` `409` `410` |
| `GET`  | `/api/health` | Honest readiness | `200` |

`401` only when `LINK_AUTH_TOKEN` is set (then every `/api/link/*` and
`/api/register/*` call needs `Authorization: Bearer <token>`).

`503 {"error":"no_bot_token"}` / `{"error":"no_bot_username"}` — the service
cannot mint a usable link, so it refuses instead of inventing one.

### `GET /api/health`

* without `TG_BOT_TOKEN` → `{"ok":false,"reason":"no-token"}` (always `200`;
  the process is up but the feature is not — the header never claims success);
* with a token → `{"ok":true,"bot":"<username|null>"}`.

## Phone registration (code-free)

The web flow the owner asked for — *share the contact and that is it*:

1. The website calls `POST /api/register/start` (after the user ticked the legal
   consent checkbox) and shows the returned `deepLink`/`tgDeepLink`.
2. The user opens the bot: `/start <token>` answers with a sign-up greeting and a
   one-time reply keyboard holding a single **📱 Поделиться телефоном** button
   (`request_contact`).
3. Sharing the user's own contact (`contact.user_id === from.id`) stores the
   E.164 phone and flips the record to `ready`; the bot confirms with the masked
   phone and an inline **Это не я** button (`callback_data = rx-cancel:<token>`)
   so a forwarded deep link can be cancelled by the person who received it.
4. The website polls `GET /api/register/status?token=…`; on `ready` it creates or
   finds the account by phone, then calls `POST /api/register/consume`, which
   wins exactly once (`409 already_consumed` afterwards).

Statuses: `waiting` → `ready` → `consumed`, plus `expired` (TTL) and `cancelled`
(the inline button). Phone numbers are stored normalized (`+79991234512`) and
rendered masked (`+7 999 ***-**-12`).

## Verify semantics

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

Storage is a single SQLite database (`pending_links`, `links`, `registrations`).
Tokens and phones are the only state; secrets are never logged.

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

## Deploy on the platform host (CT101, systemd)

`@rox_one_bot` has exactly **one** update consumer. The platform host owns it:
the website and the desktop client both talk to the loopback service.

```sh
services/rox-tg-linkd/deploy/install-ct.sh root@100.126.90.2   # build + rsync + unit + restart
```

* `/etc/rox-tg-linkd.env` (mode 600, root) — `TG_BOT_TOKEN`, `TG_BOT_USERNAME`,
  `LINK_AUTH_TOKEN`, `TG_POLL_TIMEOUT_SEC`; the unit sets `PORT`/`LINK_DB_PATH`.
* `deploy/rox-tg-linkd.service` — `DynamicUser`, `StateDirectory=rox-tg-linkd`
  (`/var/lib/rox-tg-linkd/links.sqlite`), `ProtectSystem=strict`, loopback only.
* The website calls it through `TG_LINKD_URL`/`TG_LINKD_TOKEN`; the desktop's
  `ROX_TG_LINK_URL` defaults to `https://rox.one`, whose website proxy forwards
  `/api/link/*` to this daemon and adds the daemon bearer server-side. The
  desktop presents the proxy's own bearer in `ROX_TG_LINK_TOKEN` (the value of
  the website's `ROX_TG_LINK_PUBLIC_TOKEN`).
* Never run this service and a local desktop daemon against the same bot at the
  same time — `getUpdates` would 409 for one of them.

## Deploy as a macOS LaunchAgent

`scripts/install-macos.sh`-style installs (bundle in `~/.local/share/rox/tg-linkd`,
wrapper sourcing the 600 secrets file, `com.rox.tg-linkd` agent) must keep the
process out of launchd's throttled background class — otherwise the first
request after an idle period takes seconds (measured 5.3 s with
`ProcessType=Background`, 2 ms with `Interactive`):

```xml
<key>ProcessType</key><string>Interactive</string>
<key>EnvironmentVariables</key>
<dict><key>NSAppSleepDisabled</key><string>1</string></dict>
```

## Security notes

* Contact ownership is enforced server-side; a foreign contact is refused
  before any state changes.
* Codes and tokens are secrets: never logged, and returned only to the caller
  that created (or is verifying) the link.
* Registration tokens are single-use (`consume` wins once), expire with
  `LINK_TTL_MS`, and can be cancelled from the bot; the phone is stored E.164
  and only ever rendered masked outside the API response.
* The service is loopback-only in compose; expose it through an authenticated
  tunnel and set `LINK_AUTH_TOKEN`.
* The bot token lives in the environment/secret store only — this repository
  ships no token.