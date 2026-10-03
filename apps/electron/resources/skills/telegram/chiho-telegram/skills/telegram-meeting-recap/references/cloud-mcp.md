# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write` when creating tasks

Useful tools:

- `chat_read`
- `summary_refresh`
- `summary_show`
- `tasks_suggest`
- `tasks_add`

Cloud Telegram reads and CRM metadata are separate. If CRM tools report that chat metadata is unavailable for a peer that `chat_read` can access, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for recap context and ask for sync/import before persisting summaries or tasks.
