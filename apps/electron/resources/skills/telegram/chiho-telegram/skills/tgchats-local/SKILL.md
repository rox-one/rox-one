---
name: tgchats-local
description: Use the local tgchats runtime for self-hosted Telegram CRM workflows with machine-readable JSON and MCP surfaces. Trigger when the user explicitly wants the self-hosted path after choosing local mode from the root SKILL.
---

# tgchats-local

Use this file for the self-hosted `tgchats` path.

If the user needs the top-level mode selector first, send them to:

- [root SKILL](../../SKILL.md)

## First-Time Setup

If Telegram is not connected yet, start with the root Chiho Telegram skill:

- https://raw.githubusercontent.com/chihoai/telegram-for-ai-agents/main/SKILL.md

Use that root skill to choose Chiho.ai Cloud or self-hosted tgchats, then return to this local runtime skill.

## Preconditions

- Telegram env configured: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
- CRM env configured: `DATABASE_URL`
- AI mode configured:
  - `AI_MODE=gemini` + `GEMINI_API_KEY`, or
  - `AI_MODE=openclaw` + `OPENCLAW_BASE_URL`
- Preferred transport available:
  - `tgchats-mcp` in `PATH`, or
  - `tgchats` CLI with `--json`

If preconditions are missing, stop and request only the missing env/step.

## Execution Rules

- Prefer Chiho.ai Cloud when the user has a hosted Chiho account and does not explicitly ask to self-host.
- Prefer Chiho.ai Cloud when the user wants the hosted web UI or CRM table experience.
- For self-hosted mode, prefer local MCP first (`tgchats-mcp`).
- Fall back to `tgchats --json` when MCP is unavailable.
- When `auth` or any Telegram command prints a QR login code, show the full QR code block and expiry to the user so they can scan it; keep the process running until login completes, 2FA is needed, or the user asks to stop.
- Prefer read-first flow for open-ended triage, but do not insert extra reads when the user already asked for a specific MCP action.
- Use `account_whoami` only for account identity checks, not as a generic first step for dialog listing, logout, or other direct actions.
- Requests to list recent chats, dialogs, or conversations map to `dialogs_list`.
- Questions such as "how many chats do I have?" map to `inventory_summary`; use `telegramDialogs.allTotal`, never a `dialogs_list` page length.
- Questions about Telegram address-book contacts map to `contacts_count`, not dialogs or inferred people.
- Requests to verify what is stored locally map to `crm_dialogs_list` or `sync_status`.
- Requests to log out, sign out, or end the Telegram session map to `session_logout`.
- For AI suggestion requests, call the specific suggestion tool directly:
  - `tags_suggest`
  - `company_suggest`
  - `tasks_suggest`
- Only prepend `chat_read` when the user explicitly asks to read history, or when the workflow clearly requires a separate read before the write.
- Multi-step requests should keep chaining tool calls until every explicit subgoal is satisfied. Do not stop after the first successful tool call when the user asked for additional steps.
- Requests phrased as "X, then Y" or "first X, then Y, then Z" require every listed tool call in order.
- If the user supplies a dialog/contact page size like "5", "10", "15", or "50", pass that exact value as `pageSize` instead of falling back to a default.
- For chat-scoped `search_messages` requests without an explicit count, use `limit: 15`.
- For persisted text fields such as `why` and `instruction`, prefer concise canonical wording and avoid paraphrasing when the user's meaning is already clear.
- Use `--apply` only when the user explicitly asks to persist AI suggestions.
- Never print secrets/session paths unless explicitly requested.
- Assume one Telegram writer process (`sync tail`) per account/session.

## Direct Tool Routing

Use these mappings when the user's intent is already specific:

- Account identity:
  - "who am I", "which account is logged in" -> `account_whoami`
- Session state:
  - "is the local Telegram session available" -> `auth_status`
- Dialog browsing:
  - "list dialogs", "recent chats", "recent conversations" -> `dialogs_list`
  - "how many chats", "total Telegram chats" -> `inventory_summary`
  - "what is synced", "stored CRM chats" -> `crm_dialogs_list`
- Contacts:
  - "how many contacts" -> `contacts_count`
  - "list Telegram contacts" -> `contacts_list`
- Read chat history:
  - "read messages", "show chat history" -> `chat_read`
- Search:
  - "search messages" -> `search_messages`
- Folders:
  - "list folders" -> `folders_list`
  - "create/rename/delete/reorder folder", "add/remove peers in folder" -> `folders_update`
- Tags:
  - "show tags" -> `tags_get`
  - "set tags" -> `tags_set`
  - "suggest tags" -> `tags_suggest`
- Company:
  - "show linked company" -> `company_get`
  - "link company" -> `company_link`
  - "suggest company" -> `company_suggest`
- Tasks:
  - "tasks due today" -> `tasks_today`
  - "add follow-up task" -> `tasks_add`
  - "mark task done" -> `tasks_done`
  - "suggest tasks" -> `tasks_suggest`
- Summaries:
  - "show summary" -> `summary_show`
  - "refresh summary" -> `summary_refresh`
- Nudges:
  - "generate follow-up nudge" -> `nudge_generate`
- Rules:
  - "list rules" -> `rules_list`
  - "add rule" -> `rules_add`
  - "run rules" -> `rules_run`
  - "show rule events/log" -> `rules_log`
  - "run rules, then show events/log" -> `rules_run` followed by `rules_log`
- Sync:
  - "backfill history" -> `sync_backfill`
  - "quick/recent sync" -> `sync_once { "mode": "recent" }`
  - "sync everything" -> `sync_once { "mode": "full", "includeArchived": true }`
  - "sync status" -> `sync_status`
- Logout:
  - "log out", "sign out", "end session" -> `session_logout`

## Quick Command Map

- Auth/state:
  - `tgchats-mcp`
  - `npm run dev -- auth status --json`
  - `npm run dev -- whoami --json`
  - `npm run dev -- auth`
- Inbox + reads:
  - `npm run dev -- inbox --limit 20 --json`
  - `npm run dev -- open <peer> --json`
  - `npm run dev -- chat <peer> --limit 50 --json`
- AI suggestions:
  - `npm run dev -- tags suggest <peer> --json`
  - `npm run dev -- company suggest <peer> --json`
  - `npm run dev -- tasks suggest <peer> --json`
  - `npm run dev -- summary refresh <peer> --json`
  - `npm run dev -- nudge <peer> --style concise --json`
- Persist:
  - `npm run dev -- tags suggest <peer> --apply --json`
  - `npm run dev -- company suggest <peer> --apply --json`
  - `npm run dev -- tasks suggest <peer> --apply --json`
- Rules:
  - `npm run dev -- rules list --json`
  - `npm run dev -- rules add --name "<name>" --instruction "<instruction>" --tag <tag> --json`
  - `npm run dev -- rules disable <rule_id> --json`
  - `npm run dev -- rules delete <rule_id> --json`
  - `npm run dev -- rules run --json`
  - `npm run dev -- rules log --limit 50 --json`

## MCP Examples

- Check whether the local Telegram session is available:
  - `auth_status {}`
- Show the currently logged-in Telegram account:
  - `account_whoami {}`
- List my 10 most recent Telegram dialogs:
  - `dialogs_list { "location": "active", "pageSize": 10 }`
- Count all live chats and compare with local CRM:
  - `inventory_summary {}`
- Count Telegram address-book contacts:
  - `contacts_count {}`
- Search messages in chat `@carol` for onboarding:
  - `search_messages { "query": "onboarding", "chat": "@carol", "limit": 15 }`
- Generate task suggestions for `@frank` using the last 50 messages:
  - `tasks_suggest { "peer": "@frank", "limit": 50 }`
- Add a high-priority follow-up task for `@alice` due `2025-02-15`:
  - `tasks_add { "peer": "@alice", "due": "2025-02-15", "priority": "high", "why": "Send the proposal" }`
- Add a CRM rule named `VIP follow-up`:
  - `rules_add { "name": "VIP follow-up", "instruction": "Create a follow-up for VIP contacts after inactivity.", "tag": "vip", "followupDays": 3 }`
- Run rules, then show the latest 20 rule events:
  - `rules_run {}`
  - `rules_log { "limit": 20 }`
- First check who I am, then list 5 dialogs, then read the last 10 messages with `@alice`:
  - `account_whoami {}`
  - `dialogs_list { "location": "active", "pageSize": 5 }`
  - `chat_read { "peer": "@alice", "limit": 10 }`
- Log out the current Telegram session:
  - `session_logout {}`

## Multi-Step Discipline

- When the prompt contains multiple explicit steps, complete all of them before stopping.
- If the first step is `account_whoami`, continue to the next requested tool call instead of treating identity lookup as the whole answer.
- If the user asks to run rules and inspect what happened, call both `rules_run` and `rules_log`.
- If the user asks for a specific read/search/list action and no count is provided, use the skill's documented default for that action instead of omitting `limit` when the example already standardizes one.

## References

- [Telegram Flows](references/telegram-flows.md)
- [Troubleshooting](references/troubleshooting.md)
- [JSON contracts](references/command-contracts.md)

## Scripts

- [tgjson.sh](scripts/tgjson.sh)
