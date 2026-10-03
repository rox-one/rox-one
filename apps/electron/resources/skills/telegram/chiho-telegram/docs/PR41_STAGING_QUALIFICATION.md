# PR #41 staging qualification

Recorded 2026-09-30 for `chihoai/telegram-for-ai-agents` PR #41. This ledger distinguishes local package checks from a hosted staging MCP connection. It does not authorize a production cutover.

## Source and local checks

- Cursor parser fix: `b446b32672064882ba29a3dda59763982bb080c2`. An opaque base64url cursor beginning with `-` previously failed parsing as a missing `--cursor` value. The parser now accepts it and still rejects another known value option in place of a cursor.
- Node 22: `npm test` passed 156 tests in 36 files; `npm run check:local-install` passed; `npm run validate:skills` validated 19 skill directories; `git diff --check` passed.
- The installed local plugin check reported 69 local MCP tools. This is a local package check, not hosted v8 behavior.

## Hosted staging v8 personal connection

- Resource: `https://stagingapi.chiho.ai/mcp/v8`. Codex MCP authentication reported OAuth after the owner completed sign-in. No bearer token, message content, or peer identifier was recorded here.
- The loaded authenticated connector catalog contained 106 unique tool names, with no missing or extra names against the prepared v8 source name list. This does not attest to the 106 returned schemas or annotations.
- `auth_status` returned authenticated with two connected Telegram accounts; `account_whoami` and `teams_list` succeeded.
- For each account, bounded reads of the private `Chiho MCP QA Forum 2026-09` supergroup returned two topics and two members. `member_get` reported membership for a member returned by the listing. `chat_capabilities_get` succeeded. The member list reported `completeness: unknown`; its two visible members must not be described as a complete export.
- On one account, `drafts_list` found no existing draft in the QA forum. `draft_save` saved a unique test draft, `drafts_list` read it back, and an empty `draft_save` cleared it. A final `drafts_list` returned zero drafts. No message was sent.

## Empty team fixture

- The first `teams_create` attempt returned `Authentication required` before a result. After the owner signed in again, `teams_list` showed that attempt had created no team. A later retry created one disposable staging team named `Chiho MCP v8 QA 2026-09-30`, with one admin and no shared Telegram account or conversation.
- On that team, `team_report_get` reported one member and zero shared conversations, opportunities, assignments, and pending tasks. `team_activity_list`, `team_opportunities_list`, `team_templates_list`, and `team_queue_list` succeeded. A `team_report_get` with an unrelated random team ID returned `team_not_found`.
- A disposable opportunity was created, found by `team_opportunities_list`, and deleted. Its create call stalled after the server-side creation, so the list was used to reconcile the write before deletion; the final list returned zero opportunities. An independent template upsert/list/delete cycle also finished with zero templates. Activity history showed the corresponding create and delete actions. No existing business team was changed.
- `team_dialogs_list` on the empty team returned `requires_reauth` / "No connected Telegram account is available for this token." The team had no shared account or conversation. A later populated-team call succeeded, so this was an empty-team account-selection result rather than evidence that the owner's Telegram sessions needed reauthentication.
- The product supports selective chat sync. An initial attempt at `https://staging.chiho.ai/crm` failed; that was the wrong frontend for this candidate. The configured staging preview is `https://stagingchihonewpreview.chiho.ai/crm`.
- The exact disposable team was deleted with `team_delete({confirmed:true})`. A final `teams_list` returned the original two teams and no team with the QA name or ID. Opportunity and template lists were empty immediately before deletion.

## Populated QA-only team fixture

- A second disposable team, `Chiho MCP v8 QA 2026-09-30 C`, was created in staging. The owner signed in to the configured preview frontend in Brave and selected that team. Its live chat picker initially showed 35 chats while `dialogs_list` returned 37. After a scoped `sync_peer` of one QA group and a picker refresh, both QA forum fixtures appeared. The UI search returned exactly those two QA rows; selecting the filtered result selected 2 of 2 rows. `Sync selected` then showed exactly two QA conversations in the team CRM.
- `team_report_get` reported two shared conversations. `team_dialogs_list` with the selected Telegram account returned those same two QA peers, `syncedTotal: 2`, and no next page. No other owner chat was shared to the team.
- `team_conversation_get` returned the QA conversation with no assignment or task and a fields revision of zero. `team_conversation_update` saved a temporary note, read it back at revision one, then cleared it at revision two. `team_conversation_assign` assigned the sole owner/admin at revision one, read back the assignment, then cleared it at revision two.
- `team_tasks_add` created one unassigned, low-priority disposable task. `team_conversation_get` and `team_tasks_list` read it; `team_tasks_update` completed it at revision two. The final conversation read showed a cleared note, no assignee, and the task marked `done`. `team_report_get` showed zero assigned conversations and zero pending tasks. `team_queue_list` returned zero reviews; no message was sent or review action performed. Activity history contained the task, assignment, field-update, and team-create actions.
- The exact second team was deleted with `team_delete({confirmed:true})`. `teams_list` returned the original two teams and no second QA team name or ID; a report read against its deleted ID returned `not_team_member`. The staging preview's team switcher also showed only the original two teams after reload.

## Remaining release gates

- At approximately 00:33 UTC, Codex still displayed the staging entry as `OAuth`, but its tool calls stopped authenticating. Desktop logs showed MCP startup failing during OAuth metadata discovery with an HTTP transport error, followed by `tools/list` timeouts. The public staging protected-resource and authorization-server metadata endpoints later returned HTTP 200. The later sign-in and tool retry worked. This is a client transport/startup observation, not proof of token expiry or a backend OAuth defect.
- No v2–v6 candidate package was installed in a real Codex or Claude client for this PR. The PR's candidate builder does not support v8.
- Authenticated full-schema comparison, production v8 qualification, and Claude directory migration are separate release gates. The published plugin and connector remain on `/mcp`.

This qualifies the hosted v8 personal and QA-only team paths exercised above. A source-only merge of PR #41 is distinct from releasing a candidate package or retargeting the Claude listing; real-client installation, full-schema comparison, production v8, and listing migration remain unqualified.
