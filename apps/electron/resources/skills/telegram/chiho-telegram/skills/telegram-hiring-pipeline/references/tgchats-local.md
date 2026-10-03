# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` when available. Fall back to:

- `npm run dev -- search "interview" --limit 50 --json`
- `npm run dev -- chat <peer> --limit 50 --json`
- `npm run dev -- tags suggest <peer> --json`
- `npm run dev -- tasks suggest <peer> --json`
- `npm run dev -- tasks add <peer> --due <date> --why "<hiring next step>" --json`
