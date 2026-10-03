# Cloud MCP

Recommended Chiho.ai Cloud scopes:

- `telegram.read` to inspect dialogs and chat history.
- `telegram.message.preview` to create approval-ready challenge messages.
- `telegram.message.send` only when the user approves sending.
- `telegram.batch.write` to execute an approved outbox preview.
- `crm.write` to tag chats or create verification tasks.

Use `outbox_preview` for the challenge message. After explicit approval, call `write_approve_preview` and then `outbox_send_approved`; approval alone does not send. Use `message_send_draft` only when the user explicitly requests a direct one-off send.
