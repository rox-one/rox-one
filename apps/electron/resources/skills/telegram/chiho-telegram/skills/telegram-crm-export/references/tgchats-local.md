# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` for previews. For full local backup/export, use:

- `npm run dev -- export --format json --out ./exports/backup.json`

Keep `TELEGRAM_SESSION_PATH`, session strings, and API credentials out of exported artifacts.
