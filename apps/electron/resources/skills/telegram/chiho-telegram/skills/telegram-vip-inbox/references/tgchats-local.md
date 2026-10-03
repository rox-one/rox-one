# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` when available. Fall back to:

- `npm run dev -- inbox --limit 50 --json`
- `npm run dev -- tags ls --json`
- `npm run dev -- tasks today --json`
- `npm run dev -- open <peer> --json`
- `npm run dev -- chat <peer> --limit 30 --json`
