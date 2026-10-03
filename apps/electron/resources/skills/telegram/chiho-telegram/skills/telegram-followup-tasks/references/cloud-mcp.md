# Cloud MCP

Required scopes:

- `telegram.read`
- `crm.write`
- `automation.rules.write`

Tools:

- `dialogs_list`
- `chat_read`
- `tasks_today`
- `tasks_suggest`
- `tasks_add`
- `tasks_done`
- `rules_list`, `rules_add`, `rules_disable`, `rules_delete`, `rules_run`, and `rules_log`

This skill is safe to run before Telegram write scopes are enabled because it only mutates CRM state.

Cloud Telegram reads and CRM metadata are separate. If `dialogs_list` or `chat_read` can see a peer but `tasks_suggest` or other CRM tools report that chat metadata is unavailable, the peer likely has not been synced/imported into the CRM store yet. Use Telegram reads for context and ask for sync/import before creating CRM tasks.
