# Chiho Cloud Skill Testing Runbook

Use this runbook for advanced headless service-token smoke tests of Chiho.ai Cloud MCP and the Telegram workflow skills. Interactive Claude and Codex onboarding uses browser OAuth instead of this flow.

## Context

- Repo: `telegram-for-agents`
- Cloud MCP URL: `https://api.chiho.ai/mcp`
- Advanced headless test env vars in `.env`:
  - `CHIHO_API_KEY`
  - `CHIHO_MCP_URL=https://api.chiho.ai/mcp`
- Do not use this service-token script to onboard an interactive Claude or Codex user.
- Do not print API keys or Telegram session data.
- Prefer non-mutating checks first. For CRM mutations, use a harmless bot/test peer.
- Do not send Telegram messages unless the user explicitly approves a preview/send workflow.

## Current Live Baseline

This section is a historical production record and intentionally preserves the
dotted tool names that were on the wire when the checks ran.

Already verified on 2026-06-08:

- DNS/TLS for `api.chiho.ai` works.
- Cloud MCP initializes as `chiho-cloud`, protocol `2025-11-25`.
- `tools/list` exposes 23 tools after `sync.once` shipped.
- `sync.once` is advertised with `dialogs.maximum: 1000`.
- `sync.once { dialogs: 20 }` synced 20/20 recent dialogs into CRM metadata.
- CRM metadata coverage improved from 5/20 to 20/20 after sync.
- `chat.read` may return a minimum page size of 10 even when a smaller limit is requested.
- Invalid CRM peers return `Chat metadata is not available yet for that peer in Chiho.`
- Invalid Telegram read peers return `TELEGRAM_PEER_RESOLUTION_FAILED`.

Additional testing on 2026-06-08:

- `tools/list` still exposes 23 tools.
- `auth.status` succeeds with `telegram.read` and `crm.write` scopes.
- `dialogs.list { limit: 20 }` returns 20 dialogs.
- `folders.list` succeeds and returns 8 folders.
- `rules.list` succeeds and returns 0 rules.
- `tasks.today` succeeds and returns 0 tasks.
- Local repo validation passed: `npm test`, `npm run validate:skills`, and `npm run build`.
- `npm run check:local-install` passed; local MCP startup and exported contracts report 38 local tools.
- `account.whoami` succeeds and returns account/scope metadata.
- `chat.read { peer: "777000", limit: 1 }` succeeds but returns 10 messages, confirming the minimum page-size behavior.
- `folders.create`, `folders.addDialog`, and `folders.removeDialog` return `Tool is not available for this token.`
- `search.messages`, `nudge.generate`, `outbox.preview`, `message.sendDraft`, `members.invitePreview`, and `groups.leavePreview` return `Tool is not available for this token.`
- CRM/rule cleanup boundary found: `tags.set { tags: [] }` is rejected, and `tags.clear`, `company.unlink`, `rules.delete`, and `rules.disable` are unavailable for the current token.
- Stopped before positive `tags.set`, `company.link`, or `rules.add` tests to avoid leaving durable smoke-test metadata with no cleanup path.

Historical open issue observation (the integer input below is retired by the
current hard-cut contract):

- `sync.once { dialogs: 100 }` can hit Telegram `FLOOD_WAIT`; see `chihoai/chiho#57`.
- The replacement is `sync_once { mode: "full", includeArchived: true }` plus
  `sync_status`; keep issue 57 open until the staging and production resume
  checks later in this document pass.

## Hosted Package Production Validation

The OAuth and portable-name backend is live at
`https://api.chiho.ai/mcp`. The hosted `chiho-telegram` package release gate
completed on 2026-07-23:

1. OAuth discovery, protected-resource metadata, JWKS, dynamic client
   registration, and the unauthenticated `WWW-Authenticate` challenge passed.
2. Claude Free completed browser OAuth, `auth_status`, and `account_whoami`
   through the production custom connector.
3. Codex completed production OAuth and reused the grant from the current
   client to call `auth_status`; authenticated tool discovery exposed portable
   snake_case names.
4. Claude created an `outbox_preview` record and then successfully called
   `write_approve_preview` with separate one-time client approvals. The
   non-human service peer was skipped as outside the token's dialog scope, the
   preview received an `approvedAt` timestamp, and no executor or scheduling
   tool ran; zero messages were sent.

Codex CLI 0.144.6 currently fails a fresh OAuth callback with an upstream
issuer-validation error even though the callback contains the correct
`iss=https://api.chiho.ai`. Codex CLI 0.142.5 completes the same login, after
which 0.144.6 can reuse the stored grant and call the hosted tools. Keep this
workaround documented until the current client regression is fixed.

Playwright was intentionally skipped at the project owner's request. The
production Claude flow above was verified directly in the browser.

Implementation follow-up on 2026-06-09:

- Local PR: `chihoai/telegram-for-ai-agents#18`, branch `codex/crm-cleanup-tools`, latest checked head `82fba96`.
- Cloud PR: `chihoai/chiho#59`, branch `codex/validate-sync-once-dialogs`, latest checked head `0cb4bfc`.
- Local `tgchats`/`tgchats-mcp` cleanup parity was implemented for `tags.clear`, `company.unlink`, `rules.disable`, and `rules.delete`.
- Local `tags.set { tags: [] }` now dispatches to tag cleanup.
- Local rule cleanup accepts canonical string IDs from Postgres `bigserial` results, while rejecting malformed, decimal, partial, leading-zero, boolean, and unsafe integer inputs.
- Local `tags set <peer> <tag...> --json` no longer persists `--json` as a tag.
- Hosted Chiho.ai Cloud backend support was implemented in `/Users/chris/Documents/Workspace/chiho/monorepo-cloud-mcp-pr` for `tags.clear`, `company.unlink`, `rules.disable`, `rules.delete`, and `tags.set { tags: [] }`.
- Hosted Cloud `sync.once` dialog-count validation was implemented so schema-invalid `dialogs` values are rejected instead of clamped.
- Hosted Cloud contracts were updated so cleanup `ruleId` accepts integer or canonical digit string IDs.
- Hosted Cloud smoke tooling now separates reversible write checks from tag/company metadata writes: use `--mutate` for reversible task/rule checks and add `--crm-metadata` only for safe test peers.
- Hosted Cloud smoke tooling now fails fast when an explicit `--peer` is not found instead of mutating a fallback dialog.
- Hosted Cloud peer-scoped CRM tools now advertise and honor `accountId` for personal multi-account routing.
- Hosted Cloud team token paths now reject forbidden `accountId` on peer CRM tools and `summary.refresh { all: true }` instead of silently mutating/reading outside the requested account boundary.
- Hosted Cloud `summary.refresh` now routes personal single-peer and bulk refreshes through the selected account, but deliberately avoids passing account IDs into team summary generation to prevent team dialog ID repair/corruption.
- Verification passed before handoff:
  - Local: `npm test`, `npm run build`, `npm run validate:skills`, `npm run check:local-install`, `git diff --check`; local install check reported 42 local MCP tools.
  - Cloud: `npm test --workspace @chiho/backend`, targeted MCP tests, `npm run typecheck --workspace @chiho/backend`, `npm run sync:agent-contracts:check --workspace @chiho/backend`, `node --check backend/scripts/smoke-agent-mcp.mjs`, `git diff --check`.
- Final subagent review passes reported no active P0/P1/P2 findings on both PR heads.
- Hosted Chiho.ai Cloud OAuth, portable tool discovery, authenticated reads,
  and the guarded preview boundary are now deployed and live-tested in
  production. The mutation-specific cases below remain explicitly marked for
  separate testing.

## Quick MCP Smoke Script

Run from this repo:

```bash
node --input-type=module <<'NODE'
import { config } from 'dotenv';
config();

const key = process.env.CHIHO_API_KEY;
const url = process.env.CHIHO_MCP_URL || 'https://api.chiho.ai/mcp';
if (!key) throw new Error('CHIHO_API_KEY missing');

let id = 1;
async function rpc(method, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  });
  return await res.json();
}

function contentJson(json) {
  const text = json?.result?.content?.find?.((c) => c.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'codex-skill-test', version: '0.0.0' },
});

const tools = await rpc('tools/list');
const names = tools.result.tools.map((tool) => tool.name);
console.log({ toolCount: names.length, hasSyncOnce: names.includes('sync_once') });

const auth = contentJson(await rpc('tools/call', {
  name: 'auth_status',
  arguments: {},
}));
console.log({
  authenticated: auth?.authenticated,
  accountCount: auth?.accountCount,
  scopes: auth?.token?.capabilityScopes,
});
NODE
```

## Tested Tools

These have been exercised against Chiho.ai Cloud:

- `auth_status`
- `account_whoami`
- `tools/list`
- `dialogs_list`
- `chat_read`
- `sync_once`
- `tags_get`
- `tags_suggest` with `apply:false`
- `company_get`
- `company_suggest` with `apply:false`
- `tasks_today`
- `tasks_add`
- `tasks_done`
- `tasks_suggest` with `apply:false`
- `summary_show`
- `summary_refresh`
- `folders_list`
- `rules_list`

Implemented in PRs but not yet live-retested against `https://api.chiho.ai/mcp`:

- `tags_clear`
- `company_unlink`
- `rules_disable`
- `rules_delete`
- `tags_set { tags: [] }`
- `summary_refresh` personal account routing
- `summary_refresh { all: true, accountId }`
- Team-token rejection for forbidden `accountId`

## Untested Or Lightly Tested Tools

Test these next:

1. Folder reads and writes
   - [x] `folders_list` tested on 2026-06-08
   - [x] `folders_create` unavailable for current token on 2026-06-08
   - [x] `folders_add_dialog` unavailable for current token on 2026-06-08
   - [x] `folders_remove_dialog` unavailable for current token on 2026-06-08

2. Rules
   - [x] `rules_list` tested on 2026-06-08
   - [ ] `rules_add` live retest after Cloud PR deploy
   - [ ] `rules_disable` live retest after Cloud PR deploy
   - [ ] `rules_delete` live retest after Cloud PR deploy
   - [ ] `rules_run`
   - [ ] `rules_log`

3. CRM mutations beyond tasks
   - [x] `tags_set { tags: [] }` cleanup boundary tested on 2026-06-08; rejected as non-empty array required
   - [ ] `tags_set` positive mutation live retest after Cloud PR deploy
   - [ ] `tags_clear` live retest after Cloud PR deploy
   - [ ] `company_link` positive mutation live retest after Cloud PR deploy
   - [ ] `company_unlink` live retest after Cloud PR deploy
   - [ ] `company_get` after linking not run
   - [ ] `tags_get` after setting not run

4. Account scope and summary routing
   - [ ] Personal multi-account `tags_get`/`tags_set`/`tags_clear` with explicit `accountId`
   - [ ] Personal multi-account `company_get`/`company_link`/`company_unlink` with explicit `accountId`
   - [ ] Personal `summary_refresh { peer, accountId }`
   - [ ] Personal `summary_refresh { all: true, accountId }`
   - [ ] Team token valid `accountId` on a scoped peer
   - [ ] Team token forbidden `accountId` should return `403`

5. Write/approval tools, if token scopes allow
   - [x] `outbox_preview` unavailable for current token on 2026-06-08
   - `outbox_send_approved`
   - [x] `message_send_draft` unavailable for current token on 2026-06-08

6. Member/group tools, if token scopes allow
   - [x] `members_invite_preview` unavailable for current token on 2026-06-08
   - `members_invite_approved`
   - [x] `groups_leave_preview` unavailable for current token on 2026-06-08
   - `groups_leave_approved`

7. Skill-referenced but possibly unavailable hosted tools
   - [x] `search_messages` unavailable for current token on 2026-06-08
   - [x] `nudge_generate` unavailable for current token on 2026-06-08

## Suggested Next Test Order

### 1. Non-Mutating Inventory

- Run `tools/list`.
- Run `auth_status`.
- Run `inventory_summary {}` and record live active/archive/all plus synced totals.
- Run `dialogs_list { location: "all", pageSize: 20 }` and confirm its page length is not presented as the total.
- Run `crm_dialogs_list { pageSize: 20 }` and confirm `syncedTotal` matches the persisted index.
- With a separately consented `telegram.contacts.read` grant, run `contacts_count {}` and `contacts_list { pageSize: 20 }`.
- Run `folders_list`.
- Run `rules_list`.
- Run `tasks_today`.

Expected:

- No errors.
- Tool availability matches token scopes.
- If a tool is unavailable, capture whether it is missing from `tools/list` or rejected by token scope.

### 2. Controlled CRM Mutations

Use a harmless peer such as a server notification bot or test group.

Test:

- `tags_set` with a clearly temporary tag, such as `Codex Smoke Test`.
- `tags_get` to confirm the tag.
- `tags_clear` to clean up the temporary tag.
- `company_link` with a test company value, such as `Codex Smoke Test`.
- `company_get` to confirm the link.
- `company_unlink` to clean up the temporary company.
- Optionally restore prior state if needed.

Avoid human contacts unless the user explicitly chooses one.

Do not run tag/company mutation smoke on a real business contact unless the prior state has been captured and the user accepts timestamp churn. The Cloud smoke runner intentionally requires `--crm-metadata` for these writes.

### 3. Rules Smoke

Create a rule that only touches CRM metadata and is clearly a test.

Suggested behavior:

- `rules_add` with a name like `Codex smoke test - safe to delete`.
- Rule instruction should be narrow and harmless.
- `rules_list` should show it.
- `rules_run` should execute without sending messages.
- `rules_log` should show the run.
- `rules_disable` should disable the smoke rule.
- `rules_delete` should delete the smoke rule.

If any cleanup step is missing after deployment, record it as a regression against `chihoai/chiho#59`.

### 4. Folder Write Smoke

Only do this if the token has `telegram.folders.write`.

Suggested behavior:

- Create a folder named `Codex Smoke Test`.
- Add a harmless peer.
- Remove the peer.
- Leave or delete the folder depending on available tools.

Record whether cleanup is possible.

### 5. Preview/Send Boundary

Only do this with explicit user approval and the right token scopes.

Safe progression:

- `outbox_preview` only.
- Verify preview/audit record.
- Do not call `outbox_send_approved` or `message_send_draft` unless the user chooses a safe recipient and explicitly approves sending.

### 6. Large Sync Boundary

Validate the durable replacement after the matching Chiho deployment:

- Run `sync_once { mode: "full", includeArchived: true }`.
- Poll `sync_status { runId: "<returned runId>" }`.
- Confirm `FLOOD_WAIT` becomes `waiting_for_telegram` with a future `resumeAt`, no synchronous sleep, and no lost committed pages.
- Confirm the worker resumes automatically and eventually reports `complete`.
- Confirm `crm_dialogs_list.syncedTotal` equals the completed run's committed unique count.

## Skill Workflow Coverage

Partially covered:

- `telegram-followup-tasks`
- `telegram-meeting-recap`
- `telegram-lead-qualification`

Not yet tested end to end:

- `telegram-partner-pipeline`
- `telegram-vip-inbox`
- `telegram-deck-followup`
- `telegram-intro-request-triage`
- `telegram-support-escalation`
- `telegram-hiring-pipeline`
- `telegram-investor-updates`
- `telegram-crm-export`
- `telegram-bulk-template-message`
- `telegram-conditional-replies`
- `telegram-add-colleagues-to-group`
- `telegram-group-cleanup`

For each workflow skill:

1. Read the skill `SKILL.md`.
2. Read only the relevant `references/cloud-mcp.md` and `references/safety.md`.
3. Map the workflow to available hosted tools.
4. Run read-only steps first.
5. Use CRM mutations only on a chosen safe peer.
6. Use message, invite, or leave execution only with explicit user approval.

## Product Gaps To Watch For

- Durable `sync_once`/`sync_status`, full active+archive traversal, and true Telegram contact counts require live deployment and production retest before issue `chihoai/chiho#57` can close.
- Some skill catalog tools may not be exposed by hosted Cloud MCP yet, especially `search_messages`, `nudge_generate`, and planned group leave tools.
- Rule cleanup/disable/delete was implemented in PR `chihoai/chiho#59`; live deployment and production retest are still pending.
- CRM cleanup paths were implemented in PR `chihoai/chiho#59`; live deployment and production retest are still pending.
- Folder write cleanup path should be confirmed.
- Preview/send tools need token scopes beyond the current read/CRM token.

## Still Not Done

- Merge/deploy Cloud PR `chihoai/chiho#59`.
- Live retest `tools/list` after deploy; expected tool count should increase from the earlier 23-tool baseline if cleanup tools are exposed to the token.
- Live retest `tags_clear`, `company_unlink`, `rules_disable`, `rules_delete`, and `tags_set { tags: [] }`.
- Live retest account-scoped CRM behavior for personal multi-account tokens.
- Live retest team-token forbidden-account behavior: switching `peer` or `accountId` outside team scope should return `403`.
- Live retest Cloud smoke script with `--mutate` only, then separately with `--mutate --crm-metadata` on a safe test peer.
- Retest `sync_once { mode: "full", includeArchived: true }`, automatic `FLOOD_WAIT` resume, `sync_status`, and persisted totals from `crm_dialogs_list` for `chihoai/chiho#57`.
- Confirm folder write tools and cleanup once a token with `telegram.folders.write` is available.
- Confirm preview/send and member/group approval tools only with explicit user approval and appropriate token scopes.
