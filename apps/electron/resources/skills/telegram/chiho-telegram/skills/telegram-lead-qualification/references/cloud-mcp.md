# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`

Useful tools:

- `dialogs_list`
- `chat_read`
- `tags_suggest`
- `company_suggest`
- `tasks_suggest`
- `tags_set`
- `company_link`
- `tasks_add`
- `summary_refresh`

Cloud Telegram reads and CRM metadata are separate. If `dialogs_list` or `chat_read` can see a peer but CRM tools report that chat metadata is unavailable, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for context and ask for sync/import before persisting lead tags, company links, tasks, or summaries.
