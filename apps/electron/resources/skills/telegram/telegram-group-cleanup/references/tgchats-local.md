# Local tgchats

If `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.

Use local `tgchats-mcp` for reads, tags, tasks, folders, and group leave previews:

- `groups_leave_preview`
- `groups_leave_approved`

The preview is persisted next to the local Telegram session so a later `groups_leave_approved` call can execute by `previewId`.
