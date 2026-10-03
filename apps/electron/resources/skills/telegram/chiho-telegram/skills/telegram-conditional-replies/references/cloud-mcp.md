# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `telegram.message.preview`
- `telegram.message.send`
- `telegram.batch.write`
- `automation.rules.write`

Read/CRM tools:

- `rules_list`
- `rules_add`
- `rules_run`
- `rules_log`
- `dialogs_list`
- `chat_read`

Write tools for message execution:

- `message_send_draft`
- `outbox_preview`
- `write_approve_preview`
- `outbox_send_approved`

Chiho Cloud does not expose the local-only rule dry-run tool. Review the rule conditions and affected scope before calling `rules_run`. Use `outbox_preview` for a non-sending message preview, call `write_approve_preview` only after explicit approval, and then call `outbox_send_approved` to execute the approved preview. Approval alone does not send. `message_send_draft` sends directly.
