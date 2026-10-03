# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `automation.rules.write`

Useful tools:

- `search_messages`
- `chat_read`
- `tasks_add`
- `nudge_generate`
- `rules_add`

Cloud Telegram reads and CRM metadata are separate. If CRM tools report that chat metadata is unavailable for a peer that `chat_read` can access, the peer likely has not been synced/imported into the CRM store yet. Use `chat_read` for context and ask for sync/import before persisting follow-up CRM changes.
