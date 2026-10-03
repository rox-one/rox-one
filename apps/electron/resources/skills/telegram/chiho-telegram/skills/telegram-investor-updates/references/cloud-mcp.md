# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `telegram.message.preview` for update previews

Useful tools:

- `search_messages`
- `chat_read`
- `summary_refresh`
- `tasks_add`
- `nudge_generate`
- `outbox_preview`

Cloud Telegram reads and CRM metadata are separate. If CRM tools report that chat metadata is unavailable for a peer that `chat_read` can access, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for context and ask for sync/import before persisting investor CRM metadata.
