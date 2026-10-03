# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `telegram.message.preview` when drafting previews

Useful tools:

- `search_messages`
- `chat_read`
- `tasks_add`
- `tags_set`
- `nudge_generate`
- `outbox_preview`

Cloud Telegram reads and CRM metadata are separate. If CRM tools report that chat metadata is unavailable for a peer that `chat_read` can access, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for context and ask for sync/import before persisting intro-request tags or tasks.
