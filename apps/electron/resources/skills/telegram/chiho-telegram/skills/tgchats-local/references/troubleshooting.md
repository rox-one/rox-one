# Troubleshooting

## Missing Env Vars

- Error mentions `TELEGRAM_API_ID` or `TELEGRAM_API_HASH`:
  - Set Telegram app credentials.
- Error mentions `DATABASE_URL is not set`:
  - Set Postgres URL before CRM/sync/rules/export/import commands.
- Error mentions AI mode not configured:
  - Set `AI_MODE=gemini` + `GEMINI_API_KEY`, or
  - Set `AI_MODE=openclaw` + `OPENCLAW_BASE_URL`.

## Auth/Session Issues

- QR login path fails:
  - Use phone code fallback via `tgchats auth`.
- Session lost after restart:
  - Ensure `TELEGRAM_SESSION_PATH` is on persistent storage.
- Multiple workers conflict:
  - Run exactly one `sync tail` per Telegram account/session.

## Database Issues

- Schema/table errors:
  - Run `npm run dev -- db migrate`.
- Empty CRM metadata:
  - Run sync first (`backfill` then `tail`) or apply suggestions with `--apply`.

## OpenClaw Mode Issues

- 404/connection errors:
  - Verify `OPENCLAW_BASE_URL` and `/v1/chat/completions` compatibility.
- Unauthorized errors:
  - Set `OPENCLAW_API_KEY` when endpoint requires bearer auth.

## Proxy Issues

- Connectivity failures:
  - Validate `TELEGRAM_PROXY_URL` format (`http|https|socks4|socks5://host:port`).
