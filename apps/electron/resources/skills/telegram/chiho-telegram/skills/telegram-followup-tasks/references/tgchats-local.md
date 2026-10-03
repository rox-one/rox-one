# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` or `tgchats --json` for task flows.

CLI equivalents:

- `tgchats tasks today --json`
- `tgchats tasks suggest <peer> --json`
- `tgchats tasks add <peer> --due <date> --why <reason> --json`

Prefer MCP when available.
