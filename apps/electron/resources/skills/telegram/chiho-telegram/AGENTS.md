# Agent Notes (telegram-for-agents)

This file is for coding agents working inside this repository.
It is not the runtime onboarding entry point for end users or external AI agents.

For agent setup and product entry paths, start at:

- `SKILL.md` for the public entry point
- Chiho.ai Cloud vs self-hosted mode selection lives there
- `README.md` for human setup and deployment details

## Contributor Commands

```bash
npm install
npm test
npm run build
npm run check:local-install
```

If `better-sqlite3` has a native module mismatch on the current Node version:

```bash
npm rebuild better-sqlite3 --build-from-source
```

This repo is a Node.js + TypeScript CLI that logs into a *user* Telegram account via `mtcute` and provides Telegram + CRM workflows (inbox/history/folders/tags/tasks/rules/sync/export). The intended direction is to evolve it further into a Telegram CRM-style inbox for Marketing + BD workflows.

## Guardrails

- Treat `TELEGRAM_API_HASH`, session DB files, and exported session strings as secrets.
- Never commit session files. Session data grants full account access.
- Expect Telegram rate limits; build with backoff + incremental sync cursors.
- Be explicit about what is stored locally (privacy, compliance).

## Current CLI

- Entry: `src/cli.ts`
- Config: `src/app/config.ts`
- Proxy parsing: `src/proxy.ts`
- Command handlers: `src/commands/*`
- Telegram service wrappers: `src/services/*`
- DB layer: `src/db/*`

### Environment

- `TELEGRAM_API_ID` (required)
- `TELEGRAM_API_HASH` (required)
- `TELEGRAM_SESSION_PATH` (optional; defaults to `~/.config/telegram-for-agents/telegram.session`)
- `TELEGRAM_PROXY_URL` (optional; `http|https|socks4|socks5://host:port`)
- `DATABASE_URL` (optional for read-only Telegram commands; required for CRM/sync/export/import)
- `TELEGRAM_ACCOUNT_LABEL` (optional; defaults to `default`)
- `AI_MODE` (optional; `gemini` or `openclaw`, auto-detects from key/url if omitted)
- `GEMINI_API_KEY`, `GEMINI_MODEL` (Gemini mode)
- `OPENCLAW_BASE_URL`, `OPENCLAW_API_KEY`, `OPENCLAW_MODEL` (OpenClaw mode)
- `AI_TIMEOUT_MS` (optional; defaults to `30000`)

### Commands (Implemented)

```bash
npm run dev -- inbox --limit 5
npm run dev -- auth
npm run dev -- auth status --json
npm run dev -- whoami
npm run dev -- logout
npm run dev -- chat <peer> --limit 50
npm run dev -- open <peer>
npm run dev -- search "pricing" --limit 20
npm run dev -- folders list
npm run dev -- archive <peer>
npm run dev -- unarchive <peer>
npm run dev -- tags set <peer> Lead
npm run dev -- tags suggest <peer> --apply
npm run dev -- company link <peer> --company "Acme"
npm run dev -- company suggest <peer> --apply
npm run dev -- tasks today
npm run dev -- tasks suggest <peer> --apply
npm run dev -- summary refresh <peer>
npm run dev -- nudge <peer> --style concise
npm run dev -- rules run
npm run dev -- db migrate
npm run dev -- sync backfill --per-chat-limit 100
npm run dev -- export --format json --out ./exports/backup.json
npm run dev -- import --from ./exports/backup.json
```

Command matrix (source of truth: `src/cli.ts`):

- `auth`, `whoami`, `logout`
- `inbox`, `chat`, `open`, `search`
- `folders list/create/rename/delete/order/add/remove`
- `archive`, `unarchive`
- `tags set/clear/ls/suggest`, `company link/unlink/show/suggest`, `tasks add/done/today/suggest`
- `summary show/refresh`, `nudge`
- `rules list/add/disable/delete/run/log`
- `sync backfill/once/tail`
- `export`, `import`
- `db migrate`

Behavior notes:

- AI features (`company/tags/tasks/summary/nudge/rules`) execute via configured AI mode (`gemini` or `openclaw`).
- Rules can apply AI-decided dynamic actions (suggested tag + task timing/priority/why) with rule defaults as fallback.
- `search` uses Telegram search by default; local DB mode is used when `--local`, `--tag`, or `--company` is provided.
- For agent integration, prefer supported command surfaces with `--json`; see `docs/COMMAND_CONTRACTS.md`.

## mtcute Primer (what we rely on)

Primary docs:
- Guide: https://mtcute.dev/guide/
- API reference: https://ref.mtcute.dev/

### Auth

- We use `TelegramClient.start()` (interactive).
- QR login uses `qrCodeHandler: (url, expires) => { ... }`.
- Phone fallback uses `phone`, `code`, and (optionally) `password` for 2FA.

Guide reference:
- https://mtcute.dev/guide/intro/sign-in

### Storage

- In `@mtcute/node`, passing `storage: 'file.session'` uses SQLite storage via `better-sqlite3`.
- This storage is *mtcute’s internal* caching/auth store. Do not put product/CRM data here.
- WAL mode is enabled by default; `-wal`/`-shm` files may appear next to the session DB.
- Session strings (`exportSession` / `importSession`) are useful for deployments with ephemeral disks.

Guide reference:
- https://mtcute.dev/guide/topics/storage

### Listing dialogs (chats)

- `iterDialogs({ limit, pinned, archived, folder, ... })` yields `Dialog`.
- `Dialog.peer.displayName` is a stable UI title.
- `Dialog.lastMessage` returns a `Message | null`.

API reference:
- https://ref.mtcute.dev/funcs/_mtcute_web.methods.iterDialogs.html

### History (messages)

- `iterHistory(chatId, { limit, offset, maxId, minId, reverse, ... })` yields `Message`.
- Use this for initial backfill and for fetching “what changed since last time”.

API reference:
- https://ref.mtcute.dev/funcs/_mtcute_web.methods.iterHistory.html

### Folders / filters (Telegram “chat folders”)

Telegram has native dialog filters (folders). mtcute exposes:
- `getFolders()`
- `createFolder({ title, ... })`
- `editFolder({ folder, modification })`
- `deleteFolder(id|folder)`
- `setFoldersOrder([...])`

API reference examples:
- `editFolder`: https://ref.mtcute.dev/funcs/_mtcute_bun.methods.editFolder

### Archive/unarchive

- `archiveChats([peer])`
- `unarchiveChats([peer])`

API reference examples:
- `archiveChats`: https://ref.mtcute.dev/funcs/_mtcute_bun.methods.archiveChats
- `unarchiveChats`: https://ref.mtcute.dev/funcs/_mtcute_core.highlevel_methods.unarchiveChats.html

### Updates (streaming new messages)

- `tg.start()` starts the updates loop automatically.
- For long-running sync/ingest services, handle updates and persist them incrementally.
- For richer update handling patterns, `@mtcute/dispatcher` provides a structured dispatcher + filters.

Guide references:
- Updates note in sign-in guide: https://mtcute.dev/guide/intro/sign-in
- Dispatcher intro: https://mtcute.dev/guide/dispatcher/intro
- Handlers: https://mtcute.dev/guide/dispatcher/handlers

## Native Dependency Note (better-sqlite3)

On some machines, `better-sqlite3` may not ship a prebuilt binary for the exact Node version.

Common fix:
```bash
npm rebuild better-sqlite3 --build-from-source
```

## Product Direction: Marketing + BD CRM Flows

These are target flows to drive architecture and data modeling. The CLI is the first surface; later we may add a local UI and/or a server deployment.

### Core inbox flows

- Sync dialogs + messages into a CRM inbox (fast search, rich context).
- “What changed since last time” per chat (diff-aware catch-up).
- Conversation summaries and rolling context windows (per chat, per folder).
- Multi-account support (multiple Telegram sessions).

### Triage + organization flows

- Manage folders: Leads / Customers / Hiring / Friends / Investors / Partners.
- Bulk move/“archive done” workflows (CLI now; drag/drop later in UI).
- Pin/flag “Needs follow-up” + due date + reason.
- Daily queue: “who needs a follow up today” + explanation + suggested next message.

### Identity + enrichment flows

- AI tag peers with likely company + role + category (Lead/Customer/Press/etc.).
- Link peers to external entities (CRM records, emails, notes).
- Detect “same person” across chats (username/phone/name heuristics, with manual override).

### Search + retrieval flows

- Global search across all chats with filters:
  - folder (Telegram folder + internal CRM folder)
  - tags (internal)
  - company
  - date range
  - participants (group chats)
- Export results as Markdown/CSV for follow-ups and reporting.

### Automation flows

- Rules engine:
  - “Pricing request” -> tag Lead + follow-up tomorrow
  - “Intro ask” -> create task + draft response template
  - “Sent deck” -> follow-up in 3 days if no reply
- Human-in-the-loop approvals before sending any message.

### Backup / compliance flows

- Export chats + metadata (participants, tags, tasks, summaries) for audit.
- Restore from export into a new install.
- Data retention controls (per chat/folder retention policies).

## Architecture Notes (how to build the next features)

### Separate mtcute storage from app data

- Keep mtcute session storage DB strictly for mtcute.
- Store “CRM data” (tags, tasks, summaries, automation rules, embeddings) in a separate datastore.

Suggested approach:
- Local + VPS: Postgres for app DB (`DATABASE_URL`).
- mtcute session DB remains separate on persistent volume (`TELEGRAM_SESSION_PATH`).

### Sync pipeline (recommended)

Split into two loops:

1. Backfill (idempotent)
- `iterDialogs({ archived: 'keep', pinned: 'include' })`
- For each dialog, fetch history in pages using `iterHistory(chatId, { limit, offset })`
- Persist:
  - peers
  - dialogs
  - messages (dedupe by `(peer_id, msg_id)`)
  - high-water marks (per dialog: last_message_id/date synced)

2. Incremental updates (continuous)
- Run updates loop and record:
  - new messages
  - edits
  - deletes
  - read markers (optional)
- Periodically reconcile with `iterDialogs` for dialogs ordering/metadata drift.

### Data model sketch (app DB)

- `peer`: telegram id, type, username, display name, phone (if known), photo id, updated_at
- `dialog`: peer id, archived/pinned flags, folder ids (Telegram), last_message_id/date, unread counts
- `message`: peer id, msg id, date, sender peer id, text, entities, media metadata, reply/thread ids
- `folder`: Telegram folder id/title + internal folder groupings
- `tag`: internal tags (Lead/Customer/etc.) + confidence + provenance (AI/manual/rule)
- `task`: follow-up tasks with due date, status, and “why”
- `summary`: per chat rolling summaries + “since last seen” deltas
- `automation_rule`: triggers + actions + audit log
- `sync_cursor`: per dialog cursors + last run metadata

### Deploying on a Coolify VPS

- Persist mtcute session DB on a mounted volume (`TELEGRAM_SESSION_PATH` pointing inside it).
- If you need horizontal scaling, avoid multiple writers using the same mtcute session at once:
  - Run exactly one “telegram ingest worker” per Telegram account.
  - Other services read from the app DB (Postgres) and never touch the Telegram session.

## Repo Conventions (for future changes)

- Keep CLI UX stable; add new features as explicit flags/subcommands.
- Add small, focused tests for pure logic (parsers, formatting, rules), not for Telegram network calls.
- Prefer mtcute high-level methods (`iterDialogs`, `iterHistory`, `searchGlobal`, `searchMessages`) over raw TL calls unless needed.
