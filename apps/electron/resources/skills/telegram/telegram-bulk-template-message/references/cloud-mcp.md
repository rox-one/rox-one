# Cloud MCP

Required scopes:

- `telegram.read`
- `telegram.message.preview`
- `telegram.message.send`
- `telegram.batch.write`

Tools:

- `dialogs_list`
- `chat_read`
- `outbox_preview`
- `write_approve_preview`
- `outbox_send_approved`

Approval behavior depends on token and team policy. Even with `never_ask`, create a preview first so the run has audit, idempotency, skipped-recipient reporting, and rate-limit metadata. When approval is required, call `write_approve_preview` after the user reviews the preview, then call `outbox_send_approved`; approval alone does not send.
