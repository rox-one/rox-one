# rox-tg-bot

Rox Telegram verification bot. One small Bun/TypeScript service that proves the
user owns a phone number and issues the 8-letter code the Rox desktop client
(and the site) collect during account linking. No runtime dependencies: the Bot
API is spoken over `fetch`, state lives in `bun:sqlite`.

```
Rox desktop/site ──POST /api/link/start──▶ rox-tg-bot         ┌─ GET /api/link/status
     │  deep link https://t.me/<bot>?start=<linkId>            │  (poll)
     └─ user opens Telegram ──▶ bot asks to share own phone    └─ POST /api/link/confirm {code}
                                  │  contact (own only)
                                  └─▶ 8-letter code, valid 30 min, shown in the chat
```

## HTTP API

`Bun.serve`, no framework. Every `/api/link/*` call requires
`Authorization: Bearer <TG_LINK_SERVICE_TOKEN>`; `/api/health` is public.

| Method | Path | Body / query | Success response |
|---|---|---|---|
| `POST` | `/api/link/start` | `{ accountId, accountLabel? }` | `200 { linkId, code: null, deepLink, expiresAt }` |
| `GET`  | `/api/link/status` | `?linkId=…` | `200 { status, code?, phoneMasked?, confirmedAt? }` |
| `POST` | `/api/link/confirm` | `{ linkId, code }` | `200 { status: "confirmed" }` |
| `GET`  | `/api/health` | — | `200 { ok: true, bot: "<username>"\|null }` |

* **`start`** mints a fresh link (default 30-minute TTL) and returns the deep
  link `https://t.me/<botUsername>?start=<linkId>`. `code` is always `null`
  here — the code only exists after the user shares their phone.
  `503 {"error":"no_bot_username"}` when neither `BOT_USERNAME` nor `getMe`
  produced a username; `400 {"error":"invalid_account_id"}` on a missing id.
* **`status`** reports `waiting` | `code_issued` | `confirmed` | `expired`.
  `code` is present only while `code_issued` (i.e. after the user shared their
  phone); `phoneMasked` shows the bound number as `+7********67`; `confirmedAt`
  is set once confirmed. Unknown `linkId` → `404`.
* **`confirm`** validates the code server-side, single-use per link, honouring
  the TTL and the attempt cap. `400 {"status":"invalid"}` for a wrong code,
  `410 {"status":"expired"}` once the link expired or the attempt cap was hit,
  `404` for an unknown link. Replaying a confirm for an already-confirmed link
  returns `200 {"status":"confirmed"}` (idempotent).

## Bot behaviour

* `/start <linkId>` — links the chat to the pending link and replies with a
  **Share contact** keyboard (`request_contact: true`, RU text).
  Unknown or already-finished link ids get
  «Ссылка не найдена или истекла. Откройте приложение Rox и нажмите
  «Привязать Telegram» ещё раз.»
* contact message — accepted only when it is the **sender's own** contact
  (`contact.user_id === from.id`). A forwarded/foreign contact is rejected and
  never binds a phone. On success the phone is bound and the bot sends
  `Ваш код: <CODE>` followed by **«У вас 30 минут, чтобы ввести код в
  приложении Rox.»** A repeated contact keeps the same code.
* `/status` — re-sends the current code (or the contact request / a
  not-found / already-confirmed message).
* Any other command or update is ignored.

Codes are exactly 8 letters `A-Z` and live for 30 minutes. A link is
invalidated after 5 wrong codes (`TG_LINK_MAX_ATTEMPTS`).

## State

SQLite via `bun:sqlite`, file at `TG_LINK_DB` (default
`/var/lib/rox-tg-bot/state.sqlite`; `:memory:` in tests).

```sql
links(link_id PK, account_id, account_label, code, phone, status,
      created_at, expires_at, confirmed_at, attempts)
chat_links(chat_id PK, link_id, updated_at)   -- internal: routes contact → link
```

Expiry is swept on every access (`status`, `confirm`, `issueCode`, `createLink`).
The public `status` projection never exposes the raw phone.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | **yes** | — | Bot token from @BotFather |
| `TG_LINK_SERVICE_TOKEN` | **yes** | — | Bearer token for `/api/link/*` |
| `TG_LINK_DB` | no | `/var/lib/rox-tg-bot/state.sqlite` | SQLite file |
| `PORT` | no | `8789` | HTTP listen port |
| `BOT_USERNAME` | no | discovered via `getMe` | Bot username for deep links |
| `TG_LINK_TTL_MS` | no | `1800000` (30 min) | Link/code lifetime |
| `TG_LINK_MAX_ATTEMPTS` | no | `5` | Wrong codes before invalidation |
| `TG_API_BASE` | no | `https://api.telegram.org` | Bot API origin |
| `TG_POLL_TIMEOUT_SEC` | no | `25` | Long-poll timeout |
| `TG_BACKOFF_BASE_MS` / `TG_BACKOFF_MAX_MS` | no | `1000` / `60000` | Poll retry envelope |
| `LOG_LEVEL` | no | `info` | `debug`\|`info`\|`warn`\|`error` |

The process **refuses to boot** when `TELEGRAM_BOT_TOKEN` or
`TG_LINK_SERVICE_TOKEN` is missing, printing
`{"level":"error","msg":"configuration invalid","detail":"TELEGRAM_BOT_TOKEN is required"}`
and exiting non-zero — never a half-usable service. Secrets are never logged.

## Run

```bash
# from the repository root
TELEGRAM_BOT_TOKEN=… TG_LINK_SERVICE_TOKEN=… bun run services/rox-tg-bot/src/index.ts

# typecheck / tests (no bot token or network needed)
cd services/rox-tg-bot
bun run typecheck
bun test
```

Tests drive the bot through a fake transport (`test/helpers.ts`) and the HTTP
layer through its request handler, so they never touch Telegram.

## Deployment

```bash
cd services/rox-tg-bot
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN + TG_LINK_SERVICE_TOKEN
docker compose up -d --build
```

The image builds the service with `bun build` and runs it with `bun run`
(`oven/bun:1.4.2`). The SQLite file lives in the `tg-link-bot-data` volume so
links survive a redeploy. The port is published loopback-only; front it with
the same tunnel as the desktop client.

## Design note

The service deliberately owns a minimal `BotTransport` seam instead of pulling
in grammY/telegraf: the required fake-transport tests and the "must boot
without a token" rule are simpler and dependency-free this way, matching the
sibling `services/rox-tg-linkd` daemon. The seam is small enough that swapping
in a library later only touches `src/bot.ts`.