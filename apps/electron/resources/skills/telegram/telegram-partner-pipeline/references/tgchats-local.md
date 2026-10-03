# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` when available. Fall back to:

- `npm run dev -- search "partner" --limit 50 --json`
- `npm run dev -- chat <peer> --limit 50 --json`
- `npm run dev -- tags set <peer> "Partner Prospect" --json`
- `npm run dev -- company link <peer> --company "<company>" --json`
- `npm run dev -- tasks add <peer> --due <date> --why "<next step>" --json`
