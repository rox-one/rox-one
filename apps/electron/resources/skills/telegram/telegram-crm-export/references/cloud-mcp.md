# Cloud MCP

Required scopes:

- `telegram.read`

Useful tools:

- `search_messages`
- `dialogs_list`
- `chat_read`
- `tags_get`
- `company_get`
- `tasks_today`
- `summary_show`

Cloud Telegram reads and CRM metadata are separate. If `dialogs_list` or `chat_read` can see a peer but CRM tools report that metadata is unavailable, that peer likely has not been synced/imported into the CRM store yet. Continue with Telegram reads where possible and ask for sync/import before treating the peer as export-ready CRM data.
