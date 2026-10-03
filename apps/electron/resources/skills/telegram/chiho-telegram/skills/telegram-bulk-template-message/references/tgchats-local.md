# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` when available. The local MCP exposes the same tool names as Chiho.ai Cloud:

- `outbox_preview`
- `outbox_send_approved`

The preview is persisted next to the local Telegram session so a later `outbox_send_approved` call can execute by `previewId`.
