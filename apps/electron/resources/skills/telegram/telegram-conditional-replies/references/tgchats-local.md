# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` for rule and read tools. For message execution:

- `message_send_draft`
- `outbox_preview`
- `outbox_send_approved`

Always call `rules_dry_run` before `rules_run` for conditional reply workflows.
Use `outbox_preview` for a non-sending preview and call `outbox_send_approved` only after explicit approval. `message_send_draft` sends directly.
