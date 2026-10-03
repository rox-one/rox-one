# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write` for persisted tags or tasks

Useful tools:

- `dialogs_list`
- `chat_read`
- `tags_get`
- `tags_set`
- `tasks_today`
- `summary_show`

Cloud Telegram reads and CRM metadata are separate. If `dialogs_list` or `chat_read` can see a peer but `tags_get`, `summary_show`, or other CRM tools report that chat metadata is unavailable, the peer likely has not been synced/imported into the CRM store yet. Continue with Telegram reads and ask for sync/import before persisting VIP metadata.
