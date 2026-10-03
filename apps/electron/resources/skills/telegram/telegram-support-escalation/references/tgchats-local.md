# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` when available. Fall back to:

- `npm run dev -- search "urgent" --limit 50 --json`
- `npm run dev -- chat <peer> --limit 50 --json`
- `npm run dev -- tags set <peer> Support Escalated --json`
- `npm run dev -- tasks add <peer> --due <date> --priority high --why "<support escalation>" --json`
- `npm run dev -- rules add --name "Support escalation" --instruction "Create a high-priority task when a customer reports an urgent bug, outage, payment issue, or customer risk." --tag Escalated --followup-days 1 --json`
