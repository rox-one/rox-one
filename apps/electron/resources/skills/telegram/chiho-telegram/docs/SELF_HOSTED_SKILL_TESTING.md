# Self-Hosted Skill Testing Runbook

Use this runbook in a fresh Codex thread to test the self-hosted `tgchats` setup and the Telegram workflow skills.

## Context

- Repo: `telegram-for-agents`
- Runtime: local/self-hosted `tgchats` CLI plus local MCP server (`tgchats-mcp`)
- Public entry skill: `SKILL.md`
- Local runtime skill: `skills/tgchats-local/SKILL.md`
- Command contracts: `docs/COMMAND_CONTRACTS.md`
- Public MCP tool contracts: `docs/public-mcp-tool-contracts.json`

Do not print Telegram API hashes, session files, session strings, database URLs with passwords, or AI API keys.

## Current Local Baseline

The dated results below preserve the pre-inventory-cutover behavior. For the
current branch, replace legacy list/sync calls with the semantic checks in
"Inventory And Durable Sync Cutover" below.

Verified on 2026-06-10 and refreshed on 2026-06-11:

- `npm test` passed: 17 files / 80 tests.
- `npm run validate:skills` passed: 17 skill directories.
- `npm run check:local-install` passed.
- `npm run check:local-install` rebuilt the project, exported both internal and public MCP contracts, and reported 42 local MCP tools.
- Docker initially could not reach the OrbStack socket, but starting OrbStack made Docker available.
- `docker compose up -d` started the bundled Postgres 16 service.
- `npm run dev -- db migrate --json` applied migrations and returns `{ "ok": true, "action": "migrate" }`.
- Local MCP initialize passed for:
  - built server: `dist/mcp/stdio.js`
  - Codex plugin launcher
  - Claude plugin launcher
- Local MCP `tools/list` reports 47 tools.
- CLI read-only Telegram smoke passed:
  - `auth status --json`
  - `whoami --json`
  - `inbox --limit 10 --json`
  - `folders list --json`
- Local MCP read-only Telegram smoke passed:
  - `auth_status {}`
  - `account_whoami {}`
  - `inventory_summary {}`
  - `dialogs_list { "location": "active", "pageSize": 5 }`
  - `folders_list {}`
- Local CRM read smoke passed after Postgres startup:
  - `tasks today --json`
  - `rules list --json`
  - MCP `tasks_today {}`
  - MCP `rules_list {}`
  - MCP `tags_get {}`
  - MCP `search_messages { "query": "test", "local": true, "limit": 5 }`
- Small sync and local reads passed:
  - `sync once --mode recent --exclude-archived --json`
  - `search "test" --local --limit 5 --json`
  - `tags ls --json`
- Deeper read-only and sync smoke passed on a redacted synced peer:
  - `open <peer> --json`
  - `chat <peer> --limit 10 --json`
  - `search "test" --chat <peer> --limit 15 --json`
  - MCP `chat_read { "peer": "<peer>", "limit": 10 }`
  - `sync backfill --dialogs 20 --per-chat-limit 50 --json`
  - `sync tail --interval-seconds 60 --dialogs 20` started, completed one loop, and was stopped cleanly.
- Reversible CRM metadata smoke passed and cleaned up on a synced numeric peer:
  - `tags set`
  - `company link`
  - `tasks add`
  - `tasks done`
  - `tags clear`
  - `company unlink`
- Rules cleanup smoke partly passed:
  - `rules add`, `rules list`, `rules log`, `rules disable`, and `rules delete` passed.
  - `rules run --dry-run` failed at AI preflight because OpenClaw was unreachable.
- Gemini local AI smoke passed with `AI_MODE=gemini` process override:
  - `tags suggest <peer> --json` returned `ok: true` without applying tags.
  - `company suggest <peer> --json`, `tasks suggest <peer> --json`, and `summary refresh <peer> --json` returned `ok: true`.
  - `nudge <peer> --style concise --json` returned `ok: true` with draft text.
  - `tags suggest --apply`, `company suggest --apply`, and `tasks suggest --apply` were tested on a harmless peer; tag/company metadata was cleaned up and the created task was marked done.
  - `rules run --dry-run --json` with Gemini did not finish within the 180-second smoke timeout, but the temporary smoke rule was disabled and deleted.
  - Follow-up implementation added `rules run --dialogs <n>` / MCP `rules_run { "dialogs": n }` so smoke tests can bound AI rule evaluation.
  - Bounded Gemini rule smoke passed with `rules run --dry-run --dialogs 3 --json`; the disposable rule was disabled and deleted.
- Export/import smoke passed:
  - JSON, CSV, and Markdown exports were written under `/tmp/tgchats-selfhosted-smoke`.
  - JSON import passed against a disposable `tgchats_import_smoke` database.
- Folder write cleanup smoke passed with a short test folder and two synced peers:
  - `folders create --title CodexTest --peer <peerA>`
  - `folders add CodexTest <peerB>`
  - `folders remove CodexTest <peerB>`
  - `folders delete CodexTest`
- Preview-only write smoke passed without executing approved writes:
  - `outbox preview`
  - `members invite-preview`
  - `groups leave-preview`
- Approved high-risk write smoke ran on 2026-06-10 with explicit user-provided targets, redacted here so future smoke runs do not reuse stale targets:
  - DM/user target: `<approved-dm-peer-id>`.
  - Group target: `<approved-test-group-id>`.
  - `outbox preview` followed by `outbox send-approved` succeeded and sent one test DM.
  - `message send-draft` succeeded and sent one test DM.
  - `members invite-preview` succeeded; `members invite-approved` returned a clear Telegram result: the user was already in the group.
  - `groups leave-preview` followed by `groups leave-approved` succeeded; the local Telegram account left the approved test group.
  - `archive <approved-dm-peer-id> --json` followed by `unarchive <approved-dm-peer-id> --json` succeeded and restored the DM.
- Failure-mode checks passed:
  - Missing Telegram credentials return `TELEGRAM_NOT_CONFIGURED`.
  - Missing `DATABASE_URL` returns `DATABASE_NOT_CONFIGURED` for CRM commands.
  - Missing Gemini config returns `AI_NOT_CONFIGURED`.
  - Invalid peers for `chat`, `open`, `tags`, and `tasks` return `TELEGRAM_PEER_INVALID`.
  - Bad export output directories return `EXPORT_PATH_INVALID`.
  - Bad session storage paths return `TELEGRAM_SESSION_STORAGE_OPEN_FAILED`.
  - Invalid folder references and invalid task-id syntax return non-zero JSON errors.
  - A syntactically valid but absent task id returns `ok: true` with `updated: false`.
- Workflow skill coverage completed for all 15 workflow skills listed below, using local MCP where supported and the previously verified CLI export/import path for full local exports, with one retried AI-output failure:
  - Low/medium-risk workflows used read tools, local search, AI suggestions, summaries, nudges, and dry-run rules.
  - High-risk workflows used preview-only tools: `outbox_preview`, `members_invite_preview`, and `groups_leave_preview`.
  - No approved send, invite, or leave tools were executed in this workflow pass.
  - Five preview records were created as audit artifacts.
  - One disposable conditional-reply rule was created, dry-run, logged, disabled, and deleted.
  - One full-matrix `summary_refresh` call returned `ok: false`; an isolated local MCP retry of the meeting-recap sequence (`chat_read`, `summary_refresh`, `nudge_generate`) passed. Treat this as a transient AI-output smoke hiccup unless it recurs.

Implementation fixes made during the same run:

- Fixed `folders add/remove ... --json` parsing so trailing flags are not treated as peers.
- Added a parser regression for negative numeric peer IDs followed by `--json`.
- Fixed `folders create --peer` stale replay by only using folder-create idempotency replay when an explicit `--idempotency-key` is provided.
- Fixed `db migrate --json` so it returns machine-readable JSON instead of plain text.
- Fixed `archive` and `unarchive` so trailing flags are ignored, numeric peer IDs are normalized, and `--json` returns machine-readable JSON.
- Added bounded `rules run --dialogs <n>` support and exposed it through local MCP `rules_run` / `rules_dry_run` contracts.
- Added stable JSON error codes for missing AI config, invalid Telegram peers, invalid export paths, and bad Telegram session storage paths.
- Added local folder preflight errors for empty folder creation and removing the last included peer.
- Added local MCP `accountId` validation against `TELEGRAM_ACCOUNT_LABEL` and advertised `accountId` across local MCP tool contracts.
- Added bounded Telegram rate-limit backoff for `sync backfill`; JSON output now includes `rateLimitBackoffs` and `skippedDialogs` when a large backfill has to continue after a flood-wait.

Current local blockers and gaps from the same run:

- AI-backed commands are blocked only when using the configured OpenClaw endpoint: `OpenClaw health preflight failed after 4 attempts: fetch failed`.
- OpenClaw diagnosis on 2026-06-10: `OPENCLAW_BASE_URL` was set and `OPENCLAW_API_KEY` was present, but the configured OpenClaw host failed TLS/network handshakes with `ECONNRESET` / `SSL_ERROR_SYSCALL`.
- Use `AI_MODE=gemini` locally until the OpenClaw endpoint is healthy; Gemini smoke passed for `tags suggest` and `nudge`.
- Use `rules run --dry-run --dialogs <small-n> --json` for smoke testing; unbounded rule runs still default to recent 200 dialogs and can be slow with AI.
- Approved high-risk Telegram writes were executed only against the user-provided smoke targets listed above.
- Rejoining `<approved-test-group-id>` was not attempted after `groups leave-approved`; the group leave was the intended approved side effect for this smoke run.
- `folders create --title <title>` without `--peer` now fails locally with `FOLDER_PEER_REQUIRED`.
- `folders remove` now fails locally with `FOLDER_EMPTY_NOT_ALLOWED` before removing the last included peer.
- Long folder titles such as `Codex Smoke Test <timestamp>` can fail with Telegram `400` / "message too long"; use a short folder name for smoke tests.
- Workflow preview records remain in the local preview store as audit artifacts; they did not execute Telegram writes.

Harness note:

- MCP stdio uses the official SDK's newline-delimited JSON transport. Smoke tests
  should use `Client` with `StdioClientTransport` from
  `@modelcontextprotocol/sdk` instead of implementing framing independently.

## Recommended Self-Hosted Test Loop

Use this order for each fresh local verification pass:

1. Validate the repository and local install.
2. Confirm auth/session state without printing session paths.
3. Run read-only CLI smoke.
4. Run read-only local MCP smoke.
5. Start or verify Postgres, run migrations, then repeat CRM reads.
6. Run small sync jobs first, then local search/export checks.
7. Run non-mutating AI suggestions.
8. Run reversible CRM mutations and clean them up.
9. Run folder write cleanup.
10. Run preview-only high-risk tools.
11. Execute sends, invites, leaves, or archive/unarchive only after explicit user approval and with safe targets.
12. Record the dated baseline, failures, cleanup status, and remaining gaps in this file.

## Preconditions

Required:

- Node.js 22 or 23
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

Recommended:

- `DATABASE_URL`, for CRM metadata, sync, rules, export/import, and local search
- `TELEGRAM_ACCOUNT_LABEL=default`
- `TELEGRAM_SESSION_PATH`, pointing at a persistent session file

AI mode, choose one:

- `AI_MODE=gemini` plus `GEMINI_API_KEY`
- `AI_MODE=openclaw` plus `OPENCLAW_BASE_URL`

Optional:

- `TELEGRAM_PROXY_URL`
- `AI_TIMEOUT_MS`

## Setup Checks

Run:

```bash
npm install
npm test
npm run build
npm run export:contracts
npm run check:local-install
```

If `better-sqlite3` has a native module mismatch:

```bash
npm rebuild better-sqlite3 --build-from-source
```

If using local Postgres:

```bash
docker compose up -d
npm run dev -- db migrate
```

Expected:

- Tests pass.
- Build passes.
- `docs/tool-contracts.json` and `docs/public-mcp-tool-contracts.json` are current.
- Local install check passes, or reports only missing runtime credentials/session.

## Auth And Session

Check non-interactive status:

```bash
npm run dev -- auth status --json
```

If not logged in:

```bash
npm run dev -- auth
```

Rules:

- If a QR code appears, show the full QR code block and expiry to the user.
- Keep the process running until login completes, 2FA is needed, or the user asks to stop.
- Never commit or print session files.

After login:

```bash
npm run dev -- whoami --json
```

Expected:

- `auth status --json` returns `ok: true`.
- `whoami --json` returns account identity and account label without disclosing the session path.

## Read-Only CLI Smoke

Run:

```bash
npm run dev -- inbox --limit 10 --json
npm run dev -- folders list --json
npm run dev -- tasks today --json
npm run dev -- rules list --json
```

Pick a harmless peer from `inbox`, then run:

```bash
npm run dev -- open <peer> --json
npm run dev -- chat <peer> --limit 10 --json
npm run dev -- search "test" --chat <peer> --limit 15 --json
```

Expected:

- JSON responses have `ok: true`.
- `chat` returns recent messages.
- `open` includes CRM metadata when `DATABASE_URL` is configured; otherwise metadata may be unavailable.

## Local MCP Smoke

Start local MCP:

```bash
npm run mcp
```

After build:

```bash
./dist/mcp/stdio.js
```

If testing through an MCP client, call:

- `auth_status {}`
- `account_whoami {}`
- `inventory_summary {}`
- `dialogs_list { "location": "active", "pageSize": 10 }`
- `crm_dialogs_list { "pageSize": 10 }`
- `contacts_count {}` (requires Telegram contact consent on Cloud; local mode uses the connected account)
- `chat_read { "peer": "<peer>", "limit": 10 }`
- `folders_list {}`
- `tasks_today {}`
- `rules_list {}`

Expected:

- Local MCP tool calls mirror CLI JSON behavior.
- Local MCP tools accept `accountId` when it matches the configured `TELEGRAM_ACCOUNT_LABEL` for the running process. Set `TELEGRAM_ACCOUNT_LABEL` before starting `tgchats-mcp` to select a different local account.

## Inventory And Durable Sync Cutover

Read each inventory independently:

```bash
npm run dev -- inventory summary --json
npm run dev -- inbox --location all --page-size 20 --json
npm run dev -- contacts count --json
npm run dev -- crm dialogs list --page-size 20 --json
```

Confirm that `telegramDialogs.allTotal`, `inventoryTotal`, `contactTotal`, and
`syncedTotal` remain distinct. Never compare a page array length with an
inventory total.

Start or resume the durable inventory job:

```bash
npm run dev -- sync once --mode full --include-archived --json
npm run dev -- sync status --json
npm run dev -- sync backfill --dialogs 20 --per-chat-limit 50 --json
```

If the run reports `waiting_for_telegram`, do not retry before `resumeAt`.
After that time, invoke the same `sync once` command and confirm it resumes
from the previously committed cursor. `crm dialogs list` must show the
committed `syncedTotal` even when live `dialogs_list` returns a smaller page.

For worker testing:

```bash
npm run dev -- sync tail --interval-seconds 60 --dialogs 100
```

Rules:

- Run only one writer process per Telegram account/session.
- Stop `sync tail` after confirming it starts and processes updates.
- Expect Telegram rate limits for large backfills; `sync backfill --json` now reports bounded retry metadata in `rateLimitBackoffs` and any partial skips in `skippedDialogs`.

After sync:

```bash
npm run dev -- search "test" --local --limit 20 --json
npm run dev -- tags ls --json
npm run dev -- tasks today --json
```

Expected:

- Dialogs/messages are persisted to Postgres.
- Local filtered search works when `DATABASE_URL` is configured.

## AI And CRM Suggestions

Pick a harmless peer and run non-mutating suggestions first:

```bash
npm run dev -- tags suggest <peer> --json
npm run dev -- company suggest <peer> --json
npm run dev -- tasks suggest <peer> --json
npm run dev -- summary refresh <peer> --json
npm run dev -- nudge <peer> --style concise --json
```

Expected:

- AI-backed commands return `ok: true`.
- If AI env is missing, errors should clearly identify missing `GEMINI_API_KEY` or `OPENCLAW_BASE_URL`.

Only after user approval:

```bash
npm run dev -- tags suggest <peer> --apply --json
npm run dev -- company suggest <peer> --apply --json
npm run dev -- tasks suggest <peer> --apply --json
```

## Controlled CRM Mutations

Use a test peer or harmless bot/group.

```bash
npm run dev -- tags set <peer> "Codex Smoke Test" --json
npm run dev -- company link <peer> --company "Codex Smoke Test" --json
npm run dev -- tasks add <peer> --due <YYYY-MM-DD> --priority low --why "Codex self-hosted smoke test" --json
npm run dev -- tasks today --json
```

Then clean up smoke metadata and mark the smoke task done:

```bash
npm run dev -- tags clear <peer> --json
npm run dev -- company unlink <peer> --json
npm run dev -- tasks done <taskId> --json
```

Expected:

- CRM metadata persists in Postgres.
- Re-running reads does not create duplicates.
- Tags and company links can be cleaned up.
- Task can be closed cleanly.

## Rules Smoke

Create a harmless CRM-only rule. Keep the smoke rule free of default tag or
follow-up actions so cleanup can remove the rule without leaving rule-created
tags or tasks behind.

```bash
npm run dev -- rules add --name "Codex smoke test - safe to delete" --instruction "Smoke-test rule listing and dry-run only; do not create tags or tasks." --json
npm run dev -- rules list --json
npm run dev -- rules run --dry-run --dialogs 3 --json
npm run dev -- rules log --limit 20 --json
npm run dev -- rules disable <ruleId> --json
npm run dev -- rules delete <ruleId> --json
```

Expected:

- `rules_list` shows the rule.
- `rules run --dry-run --dialogs 3` evaluates a bounded recent-dialog sample without writing.
- `rules_log` remains readable.
- `rules_disable` and `rules_delete` clean up the smoke rule by stable `ruleId`.

## Folder And Telegram State Smoke

Read-only:

```bash
npm run dev -- folders list --json
```

Controlled folder writes:

```bash
npm run dev -- folders create --title "CodexTest" --peer <peer-a> --json
npm run dev -- folders add "CodexTest" <peer-b> --json
npm run dev -- folders remove "CodexTest" <peer-b> --json
npm run dev -- folders delete "CodexTest" --json
```

Archive/unarchive only on a safe peer:

```bash
npm run dev -- archive <peer>
npm run dev -- unarchive <peer>
```

Expected:

- Folder create/add/remove/delete works and can clean up.
- Folder create should include at least one peer; Telegram rejects empty folder filters.
- Folder remove cannot remove the last included peer; delete the folder instead when cleaning up a one-peer smoke folder.
- Keep smoke folder titles short.
- Archive/unarchive returns success and does not affect unintended peers.

## Preview, Send, Invite, And Leave Boundaries

These are high-risk. Do not execute send/invite/leave without explicit user approval and a safe target.

Test order:

1. Preview only.
2. Inspect preview record.
3. Execute only if the user explicitly approves.

Tool families to test when safe:

- `outbox_preview`
- `outbox_send_approved`
- `message_send_draft`
- `members_invite_preview`
- `members_invite_approved`
- `groups_leave_preview`
- `groups_leave_approved`

Expected:

- Preview creates an inspectable record without sending or changing Telegram state.
- Approved execution is idempotent where an idempotency key is provided.
- Unsafe targets are rejected clearly.

Audit behavior:

- Preview tools write JSON records next to the Telegram session under `agent-write-previews/`.
- Approved execution tools write idempotency/audit JSON records under `agent-write-runs/`.
- `message_send_draft` is a direct send path, not a preview-first path. It writes only an `agent-write-runs/` record keyed by `clientProvidedDraftId` when present, otherwise by a payload hash.
- Preview records include `previewId`, `kind`, `createdAt`, `expiresAt`, `payloadHash`, `payload`, and `summary`.
- Preview records expire after 30 minutes; first-time approved execution fails if the referenced preview is missing, expired, or has the wrong kind.
- Run records for preview-approved tools are keyed by tool name, preview id, and optional idempotency key. Reusing the same idempotency key returns an `idempotentReplay`, even if the original preview later expires or is removed.
- Treat both preview and run records as sensitive because they can include peer ids, message text, invite targets, and group ids.

## Export And Import

After a small sync:

```bash
mkdir -p exports
npm run dev -- export --format json --out ./exports/codex-smoke.json
npm run dev -- export --format csv --out ./exports/codex-smoke.csv
npm run dev -- export --format md --out ./exports/codex-smoke.md
```

For import testing, use a temporary database when possible:

```bash
npm run dev -- import --from ./exports/codex-smoke.json
```

Expected:

- Export files are created.
- Exported chat content is treated as sensitive.
- Import succeeds in a disposable DB or clearly reports duplicate/validation behavior.

## Workflow Skill Coverage

Verified on 2026-06-10 with redacted user and group targets. Workflow tools
used local MCP where supported; full local export/import relies on the verified
CLI fallback. All listed workflows were exercised. High-risk workflows stopped
at preview records; no approved send, invite, or leave tools were executed.

Test these with local MCP or CLI fallback:

- `telegram-followup-tasks`
- `telegram-meeting-recap`
- `telegram-lead-qualification`
- `telegram-partner-pipeline`
- `telegram-vip-inbox`
- `telegram-deck-followup`
- `telegram-intro-request-triage`
- `telegram-support-escalation`
- `telegram-hiring-pipeline`
- `telegram-investor-updates`
- `telegram-crm-export`

High-risk workflows require preview/approval discipline:

- `telegram-bulk-template-message`
- `telegram-conditional-replies`
- `telegram-add-colleagues-to-group`
- `telegram-group-cleanup`

For each workflow:

1. Read `skills/<skill-name>/SKILL.md`.
2. Read `references/tgchats-local.md` and `references/safety.md`.
3. Start with read-only tools.
4. Use `--apply` only when the user approves.
5. Use preview/approval for any send, invite, or leave action.
6. Prefer a harmless peer or test group for state-changing tests.

## Failure Cases To Test

Missing env:

- Unset or hide `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` and confirm clear `TELEGRAM_NOT_CONFIGURED` style errors.
- Unset `DATABASE_URL` and confirm CRM/sync/export commands fail clearly while read-only Telegram commands still work.
- Unset AI config and confirm AI commands fail clearly.

Bad session/storage:

- Set `TELEGRAM_SESSION_PATH` to an unwritable path and confirm a clear storage error.
- If native module errors occur, confirm the guidance points to rebuilding `better-sqlite3`.

Invalid inputs:

- Invalid peer for `chat`, `open`, `tags`, and `tasks`.
- Invalid folder name/id.
- Invalid task id for `tasks done`.
- Invalid export path.

Expected:

- JSON mode returns `{ "ok": false, "error": "..." }` and, where available, a useful `code`.
- Non-JSON mode exits non-zero with a readable message.

## Product Gaps To Watch For

- Rule cleanup/disable/delete path is now covered for local CRM rules; keep retesting cleanup when rule actions expand.
- Large backfills now have bounded Telegram rate-limit backoff; keep live-testing larger limits gradually because Telegram can still require waits longer than the local smoke threshold.
- Local MCP `accountId` now validates against `TELEGRAM_ACCOUNT_LABEL`; true multi-session switching still requires starting `tgchats-mcp` with the matching session/account environment.
- High-risk preview/run audit behavior is documented above; keep it current when write tool payloads change.
- Export/import should be tested against a disposable DB to avoid polluting real CRM state.
