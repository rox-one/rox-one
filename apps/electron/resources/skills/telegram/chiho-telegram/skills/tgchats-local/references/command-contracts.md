# Command Contracts

Machine-readable contracts are documented in:

- `docs/COMMAND_CONTRACTS.md`

Use `--json` for agent calls whenever available.

Baseline behavior:

- Success payloads include `"ok": true`.
- Error payloads include `"ok": false` and `"error": "<message>"`, with non-zero exit code.

High-value JSON commands:

- `whoami --json`
- `inbox --json`
- `inventory summary --json`
- `contacts count|list --json`
- `crm dialogs list --json`
- `sync once|status --json`
- `chat <peer> --json`
- `open <peer> --json`
- `tags ls|clear --json`
- `company unlink <peer> --json`
- `tasks today --json`
- `summary show <peer> --json`
- `rules list|disable|delete|run|log --json`
