# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `automation.rules.write`

Useful tools:

- `search_messages`
- `chat_read`
- `tags_set`
- `tasks_add`
- `rules_add`
- `rules_log`

Cloud Telegram reads and CRM metadata are separate. If CRM tools report that chat metadata is unavailable for a peer that `chat_read` can access, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for context and ask for sync/import before persisting escalation tags, tasks, or rules.
