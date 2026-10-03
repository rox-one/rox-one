# Cloud MCP

Required scopes:

- `telegram.read`
- `telegram.members.invite`

Tools:

- `dialogs_list`
- `chat_read`
- `members_invite_preview`
- `write_approve_preview`
- `members_invite_approved`

Use `members_invite_preview` for every run. When approval is required, call `write_approve_preview` only after the user reviews the preview, then call `members_invite_approved`; approval alone does not invite anyone. Approval mode controls whether the user must confirm, not whether a preview is created.
