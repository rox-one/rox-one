# Implementation plan: 52 work packages (Revision 2)

Все пакеты **PROPOSED / planned**. [work-packages.json](../../plans/macro-integration/work-packages.json) содержит primary operation JSON Schema request/response envelope, дополнительные domain API input/result/error contracts, migration constraints, verified existing entry points, proposed new artifacts, prerequisites, acceptance и negative controls. Domain DTO type names должны пройти compile/schema contract gate при реализации.

WP-01 — минимальный secured private Project bootstrap без FK на будущие таблицы; WP-02/03/04 generalize registry, grants, commands/outbox. WP-49 editor binding и WP-51 single-writer/revoke fence обязательны до Page. WP-50 provenance до shared transcripts/context. WP-52 — deployment/provider prerequisites, WP-47 — итоговый restore/retention E2E; это устраняет cycle. WP-35 device recording независим от Google и hosted STT; offline summary не обещается.

Shared module paths повторяются намеренно: один владелец domain file area, независимые workers только в независимых файлах. Existing symbols marked discovery-required нельзя выдавать за verified runtime. Proposed migration IDs переименовывает выбранный migrator. M/L/XL — относительный объём, не календарная оценка.

## WP-01

**Private shared Project: authenticated actor and workspace boundary** (XL), dependencies: нет.

Текущее исполнение 2026-09-30: [WP-01 implementation](wp-01-implementation.md) и [service runtime](wp-01-runtime.md). Canonical PostgreSQL/auth/HTTP/WS механизм интегрирован, Connections и Projects подключены в существующий Electron. Source-bound результаты и открытая native/DoD приёмка находятся в `plans/compound-implementation/wp01-integration-verification.json`; это частичная проверка, не закрытие пакета. Исторический план и нормативные критерии ниже сохраняются.

Goal: A opens private Project in native ROX; B without membership gets 403 and no title through RPC/HTTP; client cannot forge principal/workspace.

Primary operation: `project.createShared`. Additional contracts: CreateSharedProject / GetProject; Actor injected in RPC and HTTP. DB: principal, auth_subject_alias, workspace_member, project; unique workspace membership.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/transport/types.ts`, `packages/server-core/src/handlers/rpc/identity.ts`, `packages/shared/src/orgs/types.ts`, `packages/server-core/src/handlers/rpc/projects.ts`, `packages/shared/src/projects/storage.ts`, `apps/electron/src/renderer/hooks/useProjects.ts`, `packages/server-core/src/transport/server.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/identity/contracts.ts`, `apps/workspace-service/src/modules/identity/commands.ts`, `apps/workspace-service/src/modules/identity/repository.ts`, `tests/macro-integration/wp-01.test.ts`, `apps/workspace-service/migrations/01-domain-contract.sql`.

Acceptance:

- A opens private Project in native ROX
- B without membership gets 403 and no title through RPC/HTTP
- client cannot forge principal/workspace

Negative control: forge actor in payload. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: workspace.member_joined, project.created. Risks: Existing RequestContext lacks authenticated principal; local profile must not become remote identity by email.

## WP-02

**Canonical Rox2 registry, alias import and typed backlinks** (L), dependencies: WP-01.

Goal: Retry same provider binding reuses one entity; collision quarantines; backlink is symmetric query; cross-workspace and forbidden cycle rejected.

Primary operation: `entity.link`. Additional contracts: RegisterEntity / LinkEntity / GetBacklinks; extend kinds additively. DB: entity/alias/link scoped composite keys; type+source provenance; cycle guards.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/core/src/rox2/project-membership.ts`, `packages/core/src/rox2/surface-context.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/graph/contracts.ts`, `apps/workspace-service/src/modules/graph/commands.ts`, `apps/workspace-service/src/modules/graph/repository.ts`, `tests/macro-integration/wp-02.test.ts`, `apps/workspace-service/migrations/02-domain-contract.sql`.

Acceptance:

- Retry same provider binding reuses one entity
- collision quarantines
- backlink is symmetric query
- cross-workspace and forbidden cycle rejected

Negative control: drop account namespace and merge remote IDs. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: entity.created, entity.linked. Risks: Legacy path IDs and provider accounts collide; typed enum migration must preserve unknown payloads.

## WP-03

**Unified resource grants and revocation during open surface** (XL), dependencies: WP-01, WP-02.

Goal: Viewer cannot edit/share; editor loses subscription and future reads after revoke; agent allow-all still denied; preview/link/search hide revoked target.

Primary operation: `permission.revoke`. Additional contracts: Authorize / Grant / Revoke / Subscribe; add resource-scoped action vocabulary. DB: grant subject/resource/action/expiry; epoch monotonic in revoke tx.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/transport/types.ts`, `packages/server-core/src/handlers/rpc/identity.ts`, `packages/shared/src/orgs/types.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/identity/contracts.ts`, `apps/workspace-service/src/modules/identity/commands.ts`, `apps/workspace-service/src/modules/identity/repository.ts`, `tests/macro-integration/wp-03.test.ts`, `apps/workspace-service/migrations/03-domain-contract.sql`.

Acceptance:

- Viewer cannot edit/share
- editor loses subscription and future reads after revoke
- agent allow-all still denied
- preview/link/search hide revoked target

Negative control: honor cached client grants after revoke. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: permission.changed. Risks: Cached plaintext cannot be made unread retroactively; channels/mail inheritance must be explicit.

## WP-04

**Durable revisioned command and outbox receipt in Project update** (L), dependencies: WP-02, WP-03.

Goal: Crash after commit before response: retry yields same Project revision/event; stale version 409; same key altered payload rejected; event replay dedup.

Primary operation: `project.update`. Additional contracts: UpdateProject expectedRevision/idempotencyKey; native adapter uses same gateway. DB: project mutation+receipt+event atomic; consumer inbox unique; immutable request hash.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `packages/server-core/src/handlers/rpc/projects.ts`, `packages/shared/src/projects/storage.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-04.test.ts`, `apps/workspace-service/migrations/04-domain-contract.sql`.

Acceptance:

- Crash after commit before response: retry yields same Project revision/event
- stale version 409
- same key altered payload rejected
- event replay dedup

Negative control: ACK before transaction commit. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: entity.updated, project.updated. Risks: Legacy direct store writes can bypass gateway; revision continuity across import.

## WP-05

**Shared client projection and offline replay with policy rejection** (XL), dependencies: WP-04.

Goal: Offline task edit remains queued; reconnect accepted once; revoked queued mutation rejected and draft quarantined; restart restores queue; standalone personal task regression.

Primary operation: `command.replay`. Additional contracts: SyncSince(cursor) / ReplayCommand / GetCommandReceipt. DB: SQLite shared projection/outbox, durable cursor; personal local-authority adapter separate.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `packages/core/src/tasks/personal/cache.ts`, `packages/core/src/tasks/personal/store.ts`, `apps/electron/src/renderer/lib/personal-tasks-sync.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-05.test.ts`, `apps/workspace-service/migrations/05-domain-contract.sql`.

Acceptance:

- Offline task edit remains queued
- reconnect accepted once
- revoked queued mutation rejected and draft quarantined
- restart restores queue
- standalone personal task regression

Negative control: mark rejected offline draft synced. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: projection.advanced, command.rejected. Risks: Dual writable authorities and silent personal-to-team exposure.

## WP-06

**Search and Memory projection for authorized Page/Task** (L), dependencies: WP-04.

Goal: New task/Page searchable and agent-readable after watermark; revoke before index update prevents snippet leakage; tombstone disappears; worker crash replay does not lose document.

Primary operation: `search.reindex`. Additional contracts: Search scoped by actor / GetProjectionWatermark / Reindex. DB: FTS projection/chunks revision + ACL epoch; provenance refs; durable consumer inbox.

Existing files: `packages/server-core/src/handlers/rpc/knowledge.ts`, `packages/server-core/src/handlers/rpc/memory.ts`, `packages/core/src/rox2/surface-context.ts`, `packages/server-core/src/services/search.ts`, `packages/server-core/src/memory/fts-index.ts`, `packages/server-core/src/knowledge/vault-index.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/search/contracts.ts`, `apps/workspace-service/src/modules/search/commands.ts`, `apps/workspace-service/src/modules/search/repository.ts`, `tests/macro-integration/wp-06.test.ts`, `apps/workspace-service/migrations/06-domain-contract.sql`.

Acceptance:

- New task/Page searchable and agent-readable after watermark
- revoke before index update prevents snippet leakage
- tombstone disappears
- worker crash replay does not lose document

Negative control: apply stale update after tombstone. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: search.indexed, memory.context_updated. Risks: Projection consistency and derived memory leakage; metadata titles leak without read-time ACL.

## WP-07

**Assignment and mention attention with one durable Notification** (L), dependencies: WP-04, WP-03.

Goal: Assignment delivers once to assignee after restart/replay; mark done survives second device; permission-filtered payload; 100 edits coalesce without 100 pings.

Primary operation: `notification.markDone`. Additional contracts: ListNotifications / MarkSeen / MarkDone / SubscribeActivity. DB: recipient/event/reason unique; seen/done timestamp; cursor read_state.

Existing files: `packages/shared/src/team/state.ts`, `packages/shared/src/team/sync.ts`, `apps/electron/src/main/notifications.ts`, `apps/electron/src/renderer/pages/inbox/inbox-model.ts`, `apps/electron/src/renderer/hooks/useInboxItems.ts`, `apps/electron/src/renderer/components/team/TeamInboxSection.tsx`, `apps/electron/src/renderer/pages/InboxPage.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/attention/contracts.ts`, `apps/workspace-service/src/modules/attention/commands.ts`, `apps/workspace-service/src/modules/attention/repository.ts`, `tests/macro-integration/wp-07.test.ts`, `apps/workspace-service/migrations/07-domain-contract.sql`.

Acceptance:

- Assignment delivers once to assignee after restart/replay
- mark done survives second device
- permission-filtered payload
- 100 edits coalesce without 100 pings

Negative control: insert processed inbox before effect. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: notification.created, activity.recorded. Risks: Notification amplification, private snippets and mixed session unread versus entity notifications.

## WP-08

**Human Channel and entity Discussion on common Message store** (XL), dependencies: WP-04, WP-03.

Goal: Two users exchange channel messages; same API posts Company discussion; edit/delete/replies persist and notify authorized subscribers; agent transcript stays separate.

Primary operation: `message.post`. Additional contracts: CreateChannel / PostMessage / EditMessage / DeleteMessage / GetTimeline. DB: channel/member, discussion parent ref, message revisions, thread parent validation.

Existing files: `packages/shared/src/team/types.ts`, `packages/shared/src/team/state.ts`, `packages/server-core/src/handlers/rpc/messaging.ts`, `packages/shared/src/agent/session-tool-defs.ts`, `packages/shared/src/team/sync.ts`, `apps/electron/src/renderer/pages/ChatPage.tsx`, `packages/messaging-gateway/src/index.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/messaging/contracts.ts`, `apps/workspace-service/src/modules/messaging/commands.ts`, `apps/workspace-service/src/modules/messaging/repository.ts`, `tests/macro-integration/wp-08.test.ts`, `apps/workspace-service/migrations/08-domain-contract.sql`.

Acceptance:

- Two users exchange channel messages
- same API posts Company discussion
- edit/delete/replies persist and notify authorized subscribers
- agent transcript stays separate

Negative control: reply into thread from another parent. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: message.created, message.edited, message.deleted. Risks: Human messages confused with agent runtime tool/thinking records; legacy team comment ID preservation.

## WP-09

**Cross-entity mention extraction, linking and recipient policy** (L), dependencies: WP-08, WP-07, WP-06.

Goal: Company and teammate mention opens authorized target; teammate receives one notification; edited occurrence removes backlink; text mention grants no implicit access.

Primary operation: `mention.create`. Additional contracts: CreateMention / ResolveMention / RemoveOccurrence. DB: mention source revision + occurrence key unique; targets canonical refs.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/core/src/rox2/project-membership.ts`, `packages/core/src/rox2/surface-context.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/graph/contracts.ts`, `apps/workspace-service/src/modules/graph/commands.ts`, `apps/workspace-service/src/modules/graph/repository.ts`, `tests/macro-integration/wp-09.test.ts`, `apps/workspace-service/migrations/09-domain-contract.sql`.

Acceptance:

- Company and teammate mention opens authorized target
- teammate receives one notification
- edited occurrence removes backlink
- text mention grants no implicit access

Negative control: grant access when mention created. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: mention.created, mention.deleted. Risks: Offset drift and undesired auto-share; mention of company must not ping entire team.

## WP-10

**Two-user collaborative document inside existing ROX Pages** (XL), dependencies: WP-05, WP-03, WP-06, WP-09, WP-49, WP-51.

Goal: A+B edit one Page concurrently; presence/cursor; offline reload/reconnect converges; durable ack survives crash; revoked updates refused; HTML pages still work.

Primary operation: `page.createDocument`. Additional contracts: CreatePage(contentKind) / OpenSync / PushUpdate / Materialize. DB: page discriminated content kind; durable CRDT WAL/snapshot; policy lease; update receipts.

Existing files: `packages/shared/src/pages/types.ts`, `packages/shared/src/pages/storage.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `apps/electron/src/renderer/components/pages/PageView.tsx`, `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`, `apps/electron/src/renderer/components/pages/PageFrame.tsx`, `apps/electron/src/renderer/hooks/usePages.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/pages/contracts.ts`, `apps/workspace-service/src/modules/pages/commands.ts`, `apps/workspace-service/src/modules/pages/repository.ts`, `tests/macro-integration/wp-10.test.ts`, `apps/workspace-service/migrations/10-domain-contract.sql`.

Acceptance:

- A+B edit one Page concurrently
- presence/cursor
- offline reload/reconnect converges
- durable ack survives crash
- revoked updates refused
- HTML pages still work

Negative control: ACK before durable CRDT write. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: document.content_materialized, document.shared. Risks: Editor binding is substantial; Loro adapter needs schema/undo compatibility; no direct Macro licensed copy.

## WP-11

**Chat → RoxTask with backlink, assignment and Project membership** (L), dependencies: WP-08, WP-09, WP-07, WP-04.

Goal: Create from message twice with same key yields one task; source backlink visible; assignee notified; Project lists task; agent retrieves authorized conversation.

Primary operation: `task.createFromMessage`. Additional contracts: CreateTaskFromMessage / AssignTask / GetSourceContext. DB: RoxTask description/source refs; legacy PersonalTask mapping; one canonical task id.

Existing files: `packages/core/src/tasks/personal/types.ts`, `packages/server-core/src/tasks/personal-tasks-service.ts`, `packages/server-core/src/handlers/rpc/personal-tasks.ts`, `apps/electron/src/renderer/pages/tasks/TaskDetail.tsx`, `packages/server-core/src/tasks/personal-persist.ts`, `apps/electron/src/renderer/pages/tasks/atoms.ts`, `packages/core/src/tasks/personal/rpc.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/tasks/contracts.ts`, `apps/workspace-service/src/modules/tasks/commands.ts`, `apps/workspace-service/src/modules/tasks/repository.ts`, `tests/macro-integration/wp-11.test.ts`, `apps/workspace-service/migrations/11-domain-contract.sql`.

Acceptance:

- Create from message twice with same key yields one task
- source backlink visible
- assignee notified
- Project lists task
- agent retrieves authorized conversation

Negative control: create duplicate on retried message intent. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: task.created, task.assigned, entity.linked. Risks: PersonalTask global namespace and workflow TaskSpec confusion.

## WP-12

**Project as context container with typed domain memberships** (L), dependencies: WP-11, WP-02.

Goal: Project shows Page/task/channel/meeting/file/agent context; private mail linked remains private; task project migration no title-based merge.

Primary operation: `project.linkEntity`. Additional contracts: LinkToProject / ProjectOverview / AddMember. DB: migrate TaskProject aliases; project membership relation role/visibility; cwd/assets preserved.

Existing files: `packages/shared/src/projects/types.ts`, `packages/shared/src/projects/storage.ts`, `packages/server-core/src/handlers/rpc/projects.ts`, `packages/core/src/rox2/project-membership.ts`, `packages/core/src/tasks/personal/types.ts`, `packages/core/src/rox2/surface-context.ts`, `apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/projects/contracts.ts`, `apps/workspace-service/src/modules/projects/commands.ts`, `apps/workspace-service/src/modules/projects/repository.ts`, `tests/macro-integration/wp-12.test.ts`, `apps/workspace-service/migrations/12-domain-contract.sql`.

Acceptance:

- Project lists registered Task/Channel and authorized existing Page refs; unsupported not silently rendered live
- cwd/assets/details retained; private mail link does not share content
- TaskProject→ProjectConfig mapping never merges by name

Negative control: share private mail via project link. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: project.member_added, project.entity_linked. Risks: Inheritance must not silently share private linked entities; duplicate project stores.

## WP-13

**Task status, priority, assignee and date command completeness** (M), dependencies: WP-11.

Goal: Concurrent assignee/status updates conflict deterministically; filters list/board agree; dates survive timezone/restart; done notification dedup.

Primary operation: `task.update`. Additional contracts: UpdateTask expectedRevision / QueryTasks filters. DB: status transitions, priority, start/due timezone, creator/assignee refs, checklist revision.

Existing files: `packages/core/src/tasks/personal/types.ts`, `packages/server-core/src/tasks/personal-tasks-service.ts`, `packages/server-core/src/handlers/rpc/personal-tasks.ts`, `apps/electron/src/renderer/pages/tasks/TaskDetail.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/tasks/contracts.ts`, `apps/workspace-service/src/modules/tasks/commands.ts`, `apps/workspace-service/src/modules/tasks/repository.ts`, `tests/macro-integration/wp-13.test.ts`, `apps/workspace-service/migrations/13-domain-contract.sql`.

Acceptance:

- Concurrent assignee/status updates conflict deterministically
- filters list/board agree
- dates survive timezone/restart
- done notification dedup

Negative control: lose other user assignee change. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: task.updated, task.completed. Risks: Existing string enums/date semantics differ from imported document properties.

## WP-14

**Recurring task completion and reminder scheduler** (L), dependencies: WP-13, WP-07.

Goal: Completing recurring task creates exactly next occurrence; DST and missed execution replay tested; completed task does not duplicate after retry.

Primary operation: `task.completeOccurrence`. Additional contracts: CompleteOccurrence / SnoozeReminder / ListOccurrences. DB: series RRULE/timezone; occurrence key unique; job leases; recurrence exceptions.

Existing files: `packages/core/src/tasks/personal/types.ts`, `packages/server-core/src/tasks/personal-tasks-service.ts`, `packages/server-core/src/handlers/rpc/personal-tasks.ts`, `apps/electron/src/renderer/pages/tasks/TaskDetail.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/tasks/contracts.ts`, `apps/workspace-service/src/modules/tasks/commands.ts`, `apps/workspace-service/src/modules/tasks/repository.ts`, `tests/macro-integration/wp-14.test.ts`, `apps/workspace-service/migrations/14-domain-contract.sql`.

Acceptance:

- Completing recurring task creates exactly next occurrence
- DST and missed execution replay tested
- completed task does not duplicate after retry

Negative control: generate two next occurrences. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: task.occurrence_created, reminder.due. Risks: Existing recurrence data migration and schedule timezone ambiguity.

## WP-15

**Document anchors, history and collaborative undo** (XL), dependencies: WP-10, WP-08.

Goal: Comment remains on intended content after concurrent insert; deleted selection becomes orphan anchor; A undo does not erase B edit; history permissions checked.

Primary operation: `document.comment`. Additional contracts: CreateAnchoredComment / ReadRevision / UndoLocal / RestoreAsNewRevision. DB: stable CRDT position anchors; immutable snapshot metadata; revision evidence.

Existing files: `packages/shared/src/pages/types.ts`, `packages/shared/src/pages/storage.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `apps/electron/src/renderer/components/pages/PageView.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/pages/contracts.ts`, `apps/workspace-service/src/modules/pages/commands.ts`, `apps/workspace-service/src/modules/pages/repository.ts`, `tests/macro-integration/wp-15.test.ts`, `apps/workspace-service/migrations/15-domain-contract.sql`.

Acceptance:

- Comment remains on intended content after concurrent insert
- deleted selection becomes orphan anchor
- A undo does not erase B edit
- history permissions checked

Negative control: anchor uses DOM offsets after remote insert. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: document.revision_created, message.created. Risks: Index offsets are invalid remote anchors; restore may overwrite concurrent data.

## WP-16

**Notes bridge and portable files as one Page/Document graph** (L), dependencies: WP-02, WP-06, WP-10.

Goal: Rename Note preserves backlinks; stale save rejected; authorized Note searchable/linkable; Markdown export/import round-trip content and mention refs.

Primary operation: `note.import`. Additional contracts: ImportNote / SaveNote expectedRevision / ExportMarkdown. DB: stable note UUID path alias; revision CAS; content-kind adapter; preserve local Markdown files.

Existing files: `packages/core/src/rox2/notes-engine.ts`, `packages/server-core/src/handlers/rpc/notes.ts`, `apps/electron/src/renderer/pages/notes/NotesViewHost.tsx`, `apps/electron/src/renderer/pages/NotesPage.tsx`, `packages/core/src/rox2/notes-repository.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/notes/contracts.ts`, `apps/workspace-service/src/modules/notes/commands.ts`, `apps/workspace-service/src/modules/notes/repository.ts`, `tests/macro-integration/wp-16.test.ts`, `apps/workspace-service/migrations/16-domain-contract.sql`.

Acceptance:

- Rename Note preserves backlinks
- stale save rejected
- authorized Note searchable/linkable
- Markdown export/import round-trip content and mention refs

Negative control: rename changes canonical identity. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: document.content_materialized. Risks: Existing frontend not passing expectedRevision; filesystem paths are mutable identity.

## WP-17

**Preserve JMAP Mail and expose provider-neutral domain** (L), dependencies: WP-04, WP-03, WP-06.

Goal: Existing Stalwart inbox/detail/draft/send still work; threads canonical/searchable; other user cannot read account; actual send uses provider receipt.

Primary operation: `mail.openThread`. Additional contracts: GetMailThread, QueryInbox. DB: provider account aliases; mail entity metadata and immutable message body; token references separate.

Existing files: `packages/shared/src/mail/jmap-client.ts`, `apps/electron/src/main/mail/mail-service.ts`, `apps/electron/src/renderer/pages/inbox/mail/useMail.ts`, `apps/electron/src/main/mail/local-ipc.ts`, `apps/electron/src/main/mail/mail-model.ts`, `apps/electron/src/shared/mail-local.ts`, `apps/electron/src/preload/bootstrap.ts`, `packages/shared/src/mail/provisioning.ts`, `packages/shared/src/mail/__tests__/mail.test.ts`, `apps/electron/src/main/mail/__tests__/mail-model.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/mail/contracts.ts`, `apps/workspace-service/src/modules/mail/commands.ts`, `apps/workspace-service/src/modules/mail/repository.ts`, `tests/macro-integration/wp-17.test.ts`, `packages/shared/src/workspace-domain/mail/types.ts`, `packages/shared/src/workspace-domain/mail/provider-contract.ts`, `packages/shared/src/workspace-domain/mail/commands.ts`, `apps/workspace-service/src/modules/mail/service.ts`, `apps/workspace-service/src/modules/mail/adapters/jmap-adapter.ts`, `apps/workspace-service/migrations/017_mail_accounts_entities_aliases.sql`, `tests/macro-integration/mail-domain-jmap-regression.test.ts`, `apps/workspace-service/migrations/17-domain-contract.sql`.

Acceptance:

- Existing Stalwart inbox/detail/draft/send still work
- threads canonical/searchable
- other user cannot read account
- actual send uses provider receipt
- Existing JMAP mailbox provisioning, push, inbox, draft, move/flag/send pass without connecting Gmail.
- Two workspaces with same email address cannot see each other’s metadata via IPC broadcast or attachment retrieval.
- Remote submission rejected in loopback environment remains explicit unsupported path; do not turn fixture success into production receipt.

Negative control: read another account body via thread alias. Permissions: Account owner/delegated inbox; links never grant email-body access. Events: mail.message_received, mail.message_sent. Risks: Existing loopback sender restrictions must remain capability-based; API connection not mailbox authority.

## WP-18

**Mail sync cursor, webhook dedup and full refresh recovery** (XL), dependencies: WP-17, WP-05.

Goal: Duplicate/out-of-order webhook imports message once; expired cursor rebuilds without loss; disconnect reconnect resumes; deletion replay does not resurrect.

Primary operation: `mail.ingestDelta`. Additional contracts: IngestProviderChange, SyncMail. DB: account cursor transaction after durable ingest; inbox dedup; tombstone; reset/backfill leases.

Existing files: `packages/shared/src/mail/jmap-client.ts`, `apps/electron/src/main/mail/mail-service.ts`, `apps/electron/src/renderer/pages/inbox/mail/useMail.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/mail/contracts.ts`, `apps/workspace-service/src/modules/mail/commands.ts`, `apps/workspace-service/src/modules/mail/repository.ts`, `tests/macro-integration/wp-18.test.ts`, `apps/workspace-service/src/modules/mail/sync.ts`, `apps/workspace-service/src/modules/mail/webhooks.ts`, `apps/workspace-service/src/jobs/mail-sync.ts`, `apps/workspace-service/migrations/018_mail_cursors_ingestion_tombstones.sql`, `tests/macro-integration/mail-cursor-tombstone-recovery.test.ts`, `apps/workspace-service/migrations/18-domain-contract.sql`.

Acceptance:

- Duplicate/out-of-order webhook imports message once
- expired cursor rebuilds without loss
- disconnect reconnect resumes
- deletion replay does not resurrect
- Replay same webhook 10 times and in inverse order yields one normalized message and monotonic latest state.
- Provider cursor expired/invalid -> bounded rebuild; crash after rows but before cursor does not lose message.
- Delete then replay older create keeps tombstone; reconnect does not resurrect revoked account.
- Authenticate webhooks always in target; Macro gmail_webhook_auth compile feature is not acceptable default.

Negative control: advance cursor before durable ingest. Permissions: Account owner/delegated inbox; links never grant email-body access. Events: mail.sync_advanced, provider.sync_failed. Risks: Gmail history/JMAP state/IMAP UIDVALIDITY have different semantics.

## WP-19

**Compose, reply, forward and draft attachment upload** (L), dependencies: WP-17, WP-18, WP-39.

Goal: Compose/reply/forward with durable draft and provider intent; reconcile provider acceptance or ambiguous effect without blind resend; verified attachment ownership.

Primary operation: `mail.sendDraft`. Additional contracts: SendDraft, SaveDraft. DB: versioned draft recipients/body; object upload finalize; provider send idempotency receipt.

Existing files: `packages/shared/src/mail/jmap-client.ts`, `apps/electron/src/main/mail/mail-service.ts`, `apps/electron/src/renderer/pages/inbox/mail/useMail.ts`, `apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx`, `apps/electron/src/main/mail/mail-model.ts`, `apps/electron/src/main/mail/local-ipc.ts`, `apps/electron/src/shared/mail-local.ts`, `apps/electron/src/renderer/pages/inbox/mail/mail-view.ts`, `apps/electron/src/renderer/pages/inbox/mail/__tests__/mail-view.test.ts`, `packages/shared/src/mail/__tests__/mail.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/mail/contracts.ts`, `apps/workspace-service/src/modules/mail/commands.ts`, `apps/workspace-service/src/modules/mail/repository.ts`, `tests/macro-integration/wp-19.test.ts`, `apps/workspace-service/src/modules/mail/drafts.ts`, `apps/workspace-service/src/modules/mail/send.ts`, `apps/workspace-service/src/modules/mail/attachments.ts`, `packages/shared/src/workspace-domain/mail/send-receipt.ts`, `apps/workspace-service/migrations/019_mail_draft_revisions_submissions.sql`, `tests/macro-integration/mail-submission-ambiguity.test.ts`, `apps/workspace-service/migrations/19-domain-contract.sql`.

Acceptance:

- reply references/thread correct
- attachments integrity
- failed upload draft recoverable
- Inject provider success then lost response: submission is ambiguous and reconciles by provider evidence; never blind automatic resend promising exactly-once remote delivery.
- Inject JMAP submission rejection after draft creation: preserve/edit draft and show error; no false sent badge.
- Pass attachment from other message/account: denied; attacker URL cannot bypass JmapClient.resolveSameOrigin.
- Reply/forward retains original Message-ID/References and correct external recipients; sanitized incoming HTML cannot execute.

Negative control: retry ambiguous send without reconcile. Permissions: Account owner/delegated inbox; links never grant email-body access. Events: mail.draft_updated, mail.message_sent. Risks: SMTP ambiguous timeout cannot safely retry without provider-specific reconcile.

## WP-20

**Gmail and Microsoft mail adapters behind capability contract** (XL), dependencies: WP-18, WP-19.

Goal: Sandbox Gmail and Microsoft read/send/change label verify remote read-back; insufficient OAuth scope typed error; multi-account no cross-account merge.

Primary operation: `provider.connectMail`. Additional contracts: ConnectMailProvider, CompleteMailOAuth. DB: encrypted token ref + scopes; separate account/remote binding; retry/backoff cursor.

Existing files: `packages/shared/src/mail/jmap-client.ts`, `apps/electron/src/main/mail/mail-service.ts`, `apps/electron/src/renderer/pages/inbox/mail/useMail.ts`, `packages/shared/src/mail/provisioning.ts`, `apps/electron/src/main/mail/local-ipc.ts`, `apps/electron/src/shared/mail-local.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/mail/contracts.ts`, `apps/workspace-service/src/modules/mail/commands.ts`, `apps/workspace-service/src/modules/mail/repository.ts`, `tests/macro-integration/wp-20.test.ts`, `apps/workspace-service/src/modules/mail/adapters/gmail-adapter.ts`, `apps/workspace-service/src/modules/mail/adapters/microsoft-adapter.ts`, `apps/workspace-service/src/modules/connections/oauth-callback.ts`, `packages/shared/src/workspace-domain/mail/provider-capabilities.ts`, `tests/macro-integration/oauth-provider-bindings.test.ts`, `apps/workspace-service/migrations/20-domain-contract.sql`.

Acceptance:

- Sandbox Gmail and Microsoft read/send/change label verify remote read-back
- insufficient OAuth scope typed error
- multi-account no cross-account merge
- Tampered state, wrong tenant, reused callback and revoked refresh token produce typed errors without token logs.
- Gmail watch expiration renewed; Microsoft subscription validation/lifecycle renewed; rate-limit backoff bounded.
- Least-scope account can read but cannot send; UI/tool contract capability mismatch is rejected server-side.

Negative control: accept insufficient OAuth scope as connected. Permissions: Account owner/delegated inbox; links never grant email-body access. Events: provider.connection_changed, mail.sync_advanced. Risks: Vendor delta/send guarantees differ; OAuth test accounts required at execution.

## WP-21

**IMAP/SMTP adapter and scheduled-send durable jobs** (XL), dependencies: WP-18, WP-19.

Goal: UID reset reimports stable aliases without duplicates; scheduled send/cancel race executes at most one intended send; ambiguous SMTP result requires reconcile.

Primary operation: `mail.scheduleSend`. Additional contracts: ScheduleSend, CancelScheduledSend. DB: UIDVALIDITY+UID keys, durable schedule lease, provider receipt, SMTP ambiguity state.

Existing files: `packages/shared/src/mail/jmap-client.ts`, `apps/electron/src/main/mail/mail-service.ts`, `apps/electron/src/renderer/pages/inbox/mail/useMail.ts`, `apps/electron/src/shared/mail-local.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/mail/contracts.ts`, `apps/workspace-service/src/modules/mail/commands.ts`, `apps/workspace-service/src/modules/mail/repository.ts`, `tests/macro-integration/wp-21.test.ts`, `apps/workspace-service/src/modules/mail/adapters/imap-adapter.ts`, `apps/workspace-service/src/modules/mail/adapters/smtp-adapter.ts`, `apps/workspace-service/src/modules/mail/schedules.ts`, `apps/workspace-service/src/jobs/mail-scheduled-send.ts`, `apps/workspace-service/migrations/021_mail_imap_identity_schedules.sql`, `tests/macro-integration/scheduled-send-uidvalidity.test.ts`, `apps/workspace-service/migrations/21-domain-contract.sql`.

Acceptance:

- UID reset reimports stable aliases without duplicates
- scheduled send/cancel race executes at most one intended send
- ambiguous SMTP result requires reconcile
- UIDVALIDITY reset rebuilds mapping and preserves canonical references without linking old UID to new message.
- Schedule worker killed after SMTP DATA accepted but before ACK persists ambiguous outcome; do not blindly duplicate send.
- Cancel vs claim race deterministically returns already_claimed or cancelled with one terminal receipt; timezone scheduling uses persisted UTC instant.

Negative control: race cancel and send creates duplicate delivery. Permissions: Account owner/delegated inbox; links never grant email-body access. Events: mail.send_scheduled, mail.message_sent. Risks: Exactly-once external SMTP delivery cannot be asserted solely via job dedup.

## WP-22

**New inbound sender creates Contact/Company with provenance** (XL), dependencies: WP-17, WP-18, WP-02, WP-03.

Goal: New external inbound email creates Contact and non-generic Company once; repeat updates last interaction; gmail.com produces contact without fake company; Company opens authorized email.

Primary operation: `crm.ingestParticipant`. Additional contracts: IngestExternalParticipant. DB: normalized email/domain uniqueness workspace/team scoped; generic domains; source provenance; interaction event key.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-22.test.ts`, `apps/workspace-service/src/modules/crm/ingestion.ts`, `apps/workspace-service/src/modules/crm/domain-policy.ts`, `apps/workspace-service/src/jobs/crm-enrichment.ts`, `packages/shared/src/workspace-domain/crm/types.ts`, `apps/workspace-service/migrations/022_crm_contacts_companies_provenance.sql`, `tests/macro-integration/crm-inbound-provenance.test.ts`, `apps/workspace-service/migrations/22-domain-contract.sql`.

Acceptance:

- New external inbound email creates Contact and non-generic Company once
- repeat updates last interaction
- gmail.com produces contact without fake company
- Company opens authorized email
- Receive first external inbound email unknown to DB -> contact/company created in ROX; this explicitly exceeds Macro sent-only creation behavior.
- gmail.com/disposable/alias/local/internal domain creates permitted contact but no inferred company; policy is versioned.
- Concurrent 2 messages from same domain create one company; deletion/source revocation updates authorized context and search.
- Apollo unavailable yields unknown metadata, never blocks mail receipt or fabricates revenue; enrichment retried bounded.

Negative control: group gmail.com into one company. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: crm.contact_created, crm.company_created, crm.interaction_recorded. Risks: Macro creates new companies on SENT, inbound behavior is enhancement; ingestion consent versus Email Sync visibility.

## WP-23

**Dossier person/company migration and reversible identity merge** (L), dependencies: WP-22.

Goal: Dossier notes/promises/agent brief retained in Company view; same display name not merged; undo restores relationships; contact login identity unchanged.

Primary operation: `crm.mergeRecords`. Additional contracts: ImportDossier, MergeCrmEntities. DB: dossier card UUID aliases; field provenance; merge journal; duplicate quarantine.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`, `apps/electron/src/renderer/lib/extra-screens/storage.ts`, `packages/server-core/src/meetings/conation/crm.ts`, `apps/electron/src/renderer/pages/extra-screens/__tests__/dossier-model.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-23.test.ts`, `packages/shared/src/workspace-domain/crm/dossier-import.ts`, `apps/workspace-service/src/modules/crm/merge.ts`, `apps/workspace-service/src/modules/crm/aliases.ts`, `apps/workspace-service/migrations/023_crm_dossier_alias_merge_journal.sql`, `tests/macro-integration/dossier-identity-merge-rollback.test.ts`, `apps/workspace-service/migrations/23-domain-contract.sql`.

Acceptance:

- Dossier notes/promises/agent brief retained in Company view
- same display name not merged
- undo restores relationships
- contact login identity unchanged
- Two people same display name never auto merge; org text alone never grants company membership.
- Import twice produces same alias cardinality; rollback restores source snapshot and notes/promises.
- Merge across private/public contexts does not leak private email; undo after later task link returns conflict or preserves link explicitly.

Negative control: merge same display name without explicit candidate. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: crm.record_merged, entity.alias_registered. Risks: Renderer text touches are not reliable entity links.

## WP-24

**CRM board/list stages, owner, revenue and scoped admin controls** (L), dependencies: WP-22, WP-03.

Goal: Board drag/list filter use same query; concurrent move revision conflict; revenue currency precise; nonadmin cannot edit pipeline; owner mention resolves.

Primary operation: `crm.updateCompany`. Additional contracts: UpdateCompanyPipeline, QueryCrm. DB: stage IDs/rank/revision; amount+currency; owner principal; allowed admin actions.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/meetings/conation/crm.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-24.test.ts`, `apps/workspace-service/src/modules/crm/pipeline.ts`, `apps/workspace-service/src/modules/crm/queries.ts`, `packages/shared/src/workspace-domain/crm/property-schema.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/CrmBoard.tsx`, `apps/electron/src/renderer/pages/extra-screens/dossier/CrmFilters.tsx`, `apps/workspace-service/migrations/024_crm_stages_properties.sql`, `tests/macro-integration/crm-stage-revision-money.test.ts`, `apps/workspace-service/migrations/24-domain-contract.sql`.

Acceptance:

- Board drag/list filter use same query
- concurrent move revision conflict
- revenue currency precise
- nonadmin cannot edit pipeline
- owner mention resolves
- Concurrent drag/drop against same base revision returns conflict and refetch; no duplicate board state.
- Deleted stage cannot orphan records; replacement stage migration explicit.
- Non-admin cannot change team pipeline catalog; owner reassignment does not expose private source email.

Negative control: nonadmin changes stage definitions. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: crm.company_updated, crm.stage_changed. Risks: Arbitrary property JSON and pipeline enum drift.

## WP-25

**CRM Company/Contact shared discussions and mention notifications** (M), dependencies: WP-24, WP-08, WP-09, WP-07.

Goal: Teammate mention in Company discussion notifies once; text indexed; agent Company context includes authorized discussion; deleting message tombstones result.

Primary operation: `message.postCompanyDiscussion`. Additional contracts: PostEntityDiscussion. DB: reuse common discussion/message tables; legacy imported IDs aliases; no CRM comment table.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/meetings/conation/crm.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-25.test.ts`, `apps/workspace-service/src/modules/crm/discussion-context.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/CrmDiscussion.tsx`, `packages/shared/src/workspace-domain/crm/context-query.ts`, `tests/macro-integration/crm-discussion-mention-acl.test.ts`, `apps/workspace-service/migrations/25-domain-contract.sql`.

Acceptance:

- Teammate mention in Company discussion notifies once
- text indexed
- agent Company context includes authorized discussion
- deleting message tombstones result
- Company discussion teammate mention yields one durable notification after outbox replay; unauthorized target no leaked title/snippet.
- Search/agent context includes permitted CRM message; private source thread absent from shared company discussion.
- Edit/delete updates search and mention recipient deltas without repeat notification explosion.

Negative control: drop mention payload in legacy adapter. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: message.created, mention.created. Risks: Macro legacy adapter may not pass mention payload; permission inheritance must be validated.

## WP-26

**CRM visibility, hidden records and email-derived context controls** (L), dependencies: WP-22, WP-25.

Goal: Hidden Company excludes normal lists, not destructive delete; disabled email context hides bodies from team/agents; opted-out account stops target ingestion as defined.

Primary operation: `crm.setVisibility`. Additional contracts: SetCrmVisibility, GetCompanyContext. DB: hidden flags per user/team; source ingestion policy separate from presentation; audit.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-26.test.ts`, `apps/workspace-service/src/modules/crm/visibility.ts`, `apps/workspace-service/src/modules/crm/context-policy.ts`, `apps/workspace-service/migrations/026_crm_visibility_preferences.sql`, `tests/macro-integration/crm-context-visibility.test.ts`, `apps/workspace-service/migrations/26-domain-contract.sql`.

Acceptance:

- Hidden Company excludes normal lists, not destructive delete
- disabled email context hides bodies from team/agents
- opted-out account stops target ingestion as defined
- Toggle email-context off while sync receives message: ingestion/provenance continues as authorized but visible context excluded.
- Unhide company does not restore disabled email-context or revoked OAuth grant.
- Actor filtering cannot be bypassed by agent aggregated query or search index cached snippets.

Negative control: hidden record leaks email body to agent. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: crm.visibility_changed. Risks: Macro email_sync is read visibility, not stopping writes; choose explicit target consent contract.

## WP-27

**Google Calendar sync replaces unavailable production adapter** (XL), dependencies: WP-04, WP-03, WP-02.

Goal: Real sandbox event appears in existing ROX meeting/calendar context; token expiry full sync; duplicate watch dedup; disconnected provider remains unavailable.

Primary operation: `calendar.sync`. Additional contracts: SyncCalendar, ConnectCalendar. DB: provider aliases; sync token/watch renewal; recurrence master+exceptions; event revision.

Existing files: `packages/core/src/calendar/types.ts`, `packages/core/src/calendar/adapters.ts`, `packages/core/src/calendar/store.ts`, `packages/core/src/calendar/occurrences.ts`, `packages/core/src/calendar/calendar.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calendar/contracts.ts`, `apps/workspace-service/src/modules/calendar/commands.ts`, `apps/workspace-service/src/modules/calendar/repository.ts`, `tests/macro-integration/wp-27.test.ts`, `apps/workspace-service/src/modules/calendar/adapters/google-adapter.ts`, `apps/workspace-service/src/modules/calendar/sync.ts`, `apps/workspace-service/src/modules/calendar/webhooks.ts`, `apps/workspace-service/src/jobs/calendar-sync.ts`, `packages/shared/src/workspace-domain/calendar/provider-contract.ts`, `apps/workspace-service/migrations/027_calendar_accounts_sources_occurrences.sql`, `tests/macro-integration/google-calendar-sync-recovery.test.ts`, `apps/workspace-service/migrations/27-domain-contract.sql`.

Acceptance:

- Real sandbox event appears in existing ROX meeting/calendar context
- token expiry full sync
- duplicate watch dedup
- disconnected provider remains unavailable
- Real Google fixture-free readback establishes live capability; OAuth revoked makes adapter unavailable not connected green.
- syncToken410 requires complete rebuild with no resurrection; watch forged delivery rejected; renewal crash retried.
- Mailbox ICS not mistaken for authoritative Google event or new auto-calendar ingestion (Macro email ICS tables removed).

Negative control: expired token resurrects deleted event. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: calendar.event_created, calendar.event_updated. Risks: Factory currently always unavailable; credential flag must not be treated live.

## WP-28

**Create event, attendees, move and resize with provider read-back** (L), dependencies: WP-27, WP-06, WP-09.

Goal: Create+attendees+drag+resize changes provider state verified; stale etag surfaces conflict; event searchable/mentionable; DST/all-day correctness.

Primary operation: `calendar.updateEvent`. Additional contracts: UpdateCalendarEvent, RsvpCalendarEvent. DB: attendee response; conditional etag command; provider pending receipt; timezone and duration constraints.

Existing files: `packages/core/src/calendar/types.ts`, `packages/core/src/calendar/adapters.ts`, `packages/core/src/calendar/store.ts`, `packages/core/src/calendar/occurrences.ts`, `packages/core/src/calendar/merge.ts`, `packages/core/src/calendar/calendar.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calendar/contracts.ts`, `apps/workspace-service/src/modules/calendar/commands.ts`, `apps/workspace-service/src/modules/calendar/repository.ts`, `tests/macro-integration/wp-28.test.ts`, `apps/workspace-service/src/modules/calendar/write-reconciliation.ts`, `apps/electron/src/renderer/pages/calendar/CalendarWorkspace.tsx`, `apps/electron/src/renderer/pages/calendar/EventEditor.tsx`, `apps/workspace-service/migrations/028_calendar_write_receipts.sql`, `tests/macro-integration/calendar-provider-write-reconcile.test.ts`, `apps/workspace-service/migrations/28-domain-contract.sql`.

Acceptance:

- Create+attendees+drag+resize changes provider state verified
- stale etag surfaces conflict
- event searchable/mentionable
- DST/all-day correctness
- Inject Google success followed DB outage: readback reconciles one event; UI shows pending/reconciling, retry does not duplicate invitation.
- Drag across DST keeps intended wall-time semantics; resize min interval validated; cancel optimistic edit on ETag412.
- Organizer vs attendee RSVP permissions enforced; attendee list privacy and send-update provider options explicit.

Negative control: optimistic move reports success on provider 412. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: calendar.event_updated, calendar.attendee_responded. Risks: Provider optimistic UI must not report success before receipt/read-back.

## WP-29

**Calendar recurrence exceptions, multi-calendar and availability** (XL), dependencies: WP-28.

Goal: Change one occurrence does not alter series; move across calendar semantics explicit; free/busy hides titles; working-hours DST; multical overlap.

Primary operation: `calendar.updateOccurrence`. Additional contracts: ChangeCalendarOccurrence, GetAvailability. DB: RRULE/exdate/override occurrence keys; working hours timezone; authorized calendars.

Existing files: `packages/core/src/calendar/types.ts`, `packages/core/src/calendar/adapters.ts`, `packages/core/src/calendar/store.ts`, `packages/core/src/calendar/occurrences.ts`, `packages/core/src/calendar/__tests__/occurrences.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calendar/contracts.ts`, `apps/workspace-service/src/modules/calendar/commands.ts`, `apps/workspace-service/src/modules/calendar/repository.ts`, `tests/macro-integration/wp-29.test.ts`, `packages/shared/src/workspace-domain/calendar/recurrence.ts`, `apps/workspace-service/src/modules/calendar/recurrence-commands.ts`, `apps/workspace-service/src/modules/calendar/availability.ts`, `apps/electron/src/renderer/pages/calendar/CalendarPreferences.tsx`, `apps/workspace-service/migrations/029_calendar_recurrence_working_hours.sql`, `tests/macro-integration/calendar-recurrence-dst-availability.test.ts`, `apps/workspace-service/migrations/29-domain-contract.sql`.

Acceptance:

- Change one occurrence does not alter series
- move across calendar semantics explicit
- free/busy hides titles
- working-hours DST
- multical overlap
- Instance cancel survives sync; following edit either provider-supported split or typed unsupported, never silently changes entire series.
- DST gap/overlap, overnight working hours, all-day events and two calendars union tested.
- Unavailable calendar makes availability partial/unavailable, not false fully-free; read-only occurrence rejects drag.

Negative control: edit occurrence mutates entire series. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: calendar.series_updated. Risks: Macro working hours/availability not proven parity: target extension.

## WP-30

**Calendar-linked Meetings and contacts/projects context** (L), dependencies: WP-28, WP-12, WP-22.

Goal: Meeting opens calendar participants/project/company refs; recurrence generates distinct actual calls; existing Meeting IDs remain canonical call aliases.

Primary operation: `call.planFromEvent`. Additional contracts: LinkCalendarMeeting. DB: existing call kind + planned subtype; occurrence→Call relation; no second Meeting store.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `apps/electron/src/main/meetings/local-model.ts`, `packages/server-core/src/meetings/journal.ts`, `packages/server-core/src/meetings/conation/calendar-calls.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsPage.tsx`, `packages/server-core/src/meetings/conation/__tests__/calendar-calls.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-30.test.ts`, `apps/workspace-service/src/modules/meetings/context.ts`, `apps/workspace-service/src/modules/meetings/calendar-binding.ts`, `packages/shared/src/workspace-domain/meetings/context-types.ts`, `apps/workspace-service/migrations/030_meeting_calendar_context_links.sql`, `tests/macro-integration/calendar-meeting-identity.test.ts`, `apps/workspace-service/migrations/30-domain-contract.sql`.

Acceptance:

- Meeting opens calendar participants/project/company refs
- recurrence generates distinct actual calls
- existing Meeting IDs remain canonical call aliases
- Move event updates planned meeting time; completed call actual timestamps remain immutable.
- Attendee email maps contact without creating alternate identity; repeated event sync keeps one meeting.
- Deleting calendar event leaves completed recording/transcript under independent retention permissions.

Negative control: duplicate Meeting and Call for same migrated ID. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.planned, entity.linked. Risks: MEETING_KIND call compatibility; avoid duplicate planned vs actual identity.

## WP-31

**Launch LiveKit call from authorized human Channel** (XL), dependencies: WP-08, WP-03, WP-04, WP-12, WP-52.

Goal: Three users join one channel call audio/video; nonmember denied; shared call ID; end call archives metadata even without transcript; local recording mode regression.

Primary operation: `call.start`. Additional contracts: StartCall, JoinCall. DB: call room binding unique; participant principal; server auth token short-lived.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `packages/server-core/src/meetings/repository.ts`, `packages/server-core/src/meetings/__tests__/rooms.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-31.test.ts`, `apps/workspace-service/src/modules/calls/service.ts`, `apps/workspace-service/src/modules/calls/livekit-adapter.ts`, `apps/workspace-service/src/modules/calls/room-tokens.ts`, `packages/shared/src/workspace-domain/calls/types.ts`, `apps/workspace-service/migrations/031_call_rooms_participation.sql`, `apps/electron/src/renderer/pages/meetings/LiveCallPanel.tsx`, `tests/macro-integration/livekit-room-channel-acl.test.ts`, `apps/workspace-service/migrations/31-domain-contract.sql`.

Acceptance:

- Three users join one channel call audio/video
- nonmember denied
- shared call ID
- end call archives metadata even without transcript
- local recording mode regression
- Join UI not enabled with unavailable room provider; actual two-device audio/video test and provider room evidence required.
- Revoke channel access while connected -> service ejection plus token renewal denied; existing token TTL alone insufficient.
- Concurrent StartCall produces one call/room; failed provider provisioning leaves retryable typed state.

Negative control: room token uses client-supplied participant identity. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.started, call.ended. Risks: Rooms currently disabled; LiveKit self-host needs TURN/network ops.

## WP-32

**Guest access, screen sharing and participant lifecycle** (L), dependencies: WP-31.

Goal: Guest link joins permitted room only; expiry/revoke disconnect; screen-share stop cleans tracks; device reconnect single participant identity.

Primary operation: `call.inviteGuest`. Additional contracts: InviteCallGuest, HandleLivekitEvent. DB: guest token hashed expiry/revocation; participant join history; not separate login users.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `packages/server-core/src/meetings/sharing.ts`, `packages/server-core/src/meetings/__tests__/sharing-retention.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-32.test.ts`, `apps/workspace-service/src/modules/calls/guests.ts`, `apps/workspace-service/src/modules/calls/participants.ts`, `apps/workspace-service/src/modules/calls/webhooks.ts`, `apps/workspace-service/migrations/032_call_guest_tokens_media_receipts.sql`, `apps/electron/src/renderer/pages/meetings/CallParticipants.tsx`, `tests/macro-integration/call-guest-revoke-webhook.test.ts`, `apps/workspace-service/migrations/32-domain-contract.sql`.

Acceptance:

- Guest link joins permitted room only
- expiry/revoke disconnect
- screen-share stop cleans tracks
- device reconnect single participant identity
- Macro channel guests explicitly forbidden; ROX channel guest support requires named product-policy decision, not accidental reuse meeting link.
- Revoked invite cannot rejoin; active guest ejected; forged LiveKit webhook rejected without state mutation.
- Duplicate join/leave/out-of-order events preserve correct participant interval; screen-share track stops on end.

Negative control: expired guest token still connects. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.participant_joined, call.participant_left. Risks: Browser media permissions/OS capture plus guest ACL leakage.

## WP-33

**Consent-based recording and preview with durable egress receipts** (XL), dependencies: WP-31, WP-32, WP-39, WP-52.

Goal: Recording after consent stores playable media; duplicate webhook one record; killed preview worker retries; partial object unavailable; signed URL expires.

Primary operation: `call.startRecording`. Additional contracts: StartCallRecording, FinalizeCallRecording. DB: consent version; egress unique; object finalize checksum; bounded ffmpeg job; retention.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `packages/server-core/src/meetings/finalize.ts`, `packages/server-core/src/meetings/sharing.ts`, `packages/server-core/src/meetings/security-policy.ts`, `packages/server-core/src/meetings/retention.ts`, `apps/electron/src/shared/meetings-local.ts`, `packages/server-core/src/meetings/__tests__/sharing-retention.test.ts`, `packages/server-core/src/meetings/__tests__/security.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-33.test.ts`, `apps/workspace-service/src/modules/calls/recording.ts`, `apps/workspace-service/src/modules/calls/egress-reconciliation.ts`, `apps/workspace-service/src/jobs/call-recording-preview.ts`, `services/rox-media-worker/src/preview.ts`, `apps/workspace-service/migrations/033_call_recording_consent_artifacts.sql`, `tests/macro-integration/call-recording-artifact-recovery.test.ts`, `apps/workspace-service/migrations/33-domain-contract.sql`.

Acceptance:

- Recording after consent stores playable media
- duplicate webhook one record
- killed preview worker retries
- partial object unavailable
- signed URL expires
- Duplicate egress webhook and worker crash after object write produces one finalized artifact.
- Participant revoke before capture start rejects; revoke while recording triggers defined stop/redaction behavior with receipt.
- Truncated/hostile media times out/quarantines; ffmpeg preview retry never marks raw media/transcript ready.
- Object or key deleted on retention -> signed URL fails and search/summary source removed within defined SLA.

Negative control: recording ready before object finalize. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.recording_ready, recording.preview_ready. Risks: LiveKit egress object format/CDN auth; ffmpeg sandbox/codecs/license.

## WP-34

**Transcript diarization, summary evidence and search archive** (XL), dependencies: WP-33, WP-06, WP-39, WP-50.

Goal: Ended call lists participants/duration/recording/transcript/summary; searchable spans seek recording; failed STT retry no duplicate; empty transcript call still discoverable by title.

Primary operation: `call.transcribe`. Additional contracts: CorrectTranscriptSpeaker, GenerateCallSummary. DB: segment seq/revision; speaker mapping; provenance/summary source revision; job dedup.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `packages/server-core/src/meetings/finalize.ts`, `apps/electron/src/main/meetings/local-asr.ts`, `apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx`, `apps/electron/src/main/meetings/local-model.ts`, `packages/server-core/src/meetings/__tests__/finalize.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-34.test.ts`, `apps/workspace-service/src/modules/calls/transcripts.ts`, `apps/workspace-service/src/modules/calls/summaries.ts`, `apps/workspace-service/src/jobs/call-transcription.ts`, `apps/workspace-service/src/jobs/call-summary.ts`, `services/rox-media-worker/src/transcribe.ts`, `packages/shared/src/workspace-domain/meetings/evidence.ts`, `apps/workspace-service/migrations/034_transcript_revisions_summary_jobs.sql`, `tests/macro-integration/transcript-evidence-summary-jobs.test.ts`, `apps/workspace-service/migrations/34-domain-contract.sql`.

Acceptance:

- Ended call lists participants/duration/recording/transcript/summary
- searchable spans seek recording
- failed STT retry no duplicate
- empty transcript call still discoverable by title
- Archive same call ID; Macro adjacent-segment STRING_AGG/MIN(segment_id) display rollup must not delete ROX raw evidence identity.
- Fail STT/summary job mid-run -> retry same input; no duplicate summary notification.
- Zero transcript call still searchable by permitted title/participants metadata; audio remains playable if recording ready.
- Transcript correction makes old summary stale and evidence revision explicit; guest name/speaker mapping privacy persists.

Negative control: archive rollup deletes cited raw segments. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.transcript_ready, call.summary_ready. Risks: Macro Deepgram live pipeline differs from local whisper; summary hallucination/provenance.

## WP-35

**Retain local Meetings recording/import/finalize and recovery** (L), dependencies: WP-02, WP-03, WP-04, WP-05, WP-39, WP-51.

Goal: Preserve offline device audio capture/import/recovery and installed local Whisper; summaries remain pending/unavailable when agent backend unavailable; explicit consent before upload.

Primary operation: `call.importLocal`. Additional contracts: RegisterLocalMeeting, PublishLocalArtifact. DB: map LocalMeetingStore IDs to call aliases; preserve journals/Whisper evidence; shared upload optional.

Existing files: `packages/core/src/meetings/model.ts`, `packages/server-core/src/meetings/rooms.ts`, `packages/server-core/src/handlers/rpc/meetings.ts`, `apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx`, `apps/electron/src/main/meetings/local-store.ts`, `apps/electron/src/main/meetings/local-asr.ts`, `apps/electron/src/main/meetings/local-ipc.ts`, `apps/electron/src/renderer/lib/meetings/recorder.ts`, `apps/electron/src/renderer/pages/meetings/local-meetings-model.ts`, `apps/electron/src/main/meetings/local-model.ts`, `apps/electron/src/shared/meetings-local.ts`, `apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx`, `apps/electron/src/preload/bootstrap.ts`, `packages/server-core/src/meetings/capture.ts`, `packages/server-core/src/meetings/import.ts`, `packages/server-core/src/meetings/finalize.ts`, `apps/electron/src/main/meetings/__tests__/capture.test.ts`, `apps/electron/src/main/meetings/__tests__/local-store.test.ts`, `apps/electron/src/main/meetings/__tests__/overlay.test.ts`, `packages/server-core/src/meetings/__tests__/import-intent.test.ts`, `packages/server-core/src/meetings/__tests__/finalize.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/calls/contracts.ts`, `apps/workspace-service/src/modules/calls/commands.ts`, `apps/workspace-service/src/modules/calls/repository.ts`, `tests/macro-integration/wp-35.test.ts`, `packages/shared/src/workspace-domain/meetings/local-alias.ts`, `apps/electron/src/main/meetings/local-domain-adapter.ts`, `apps/electron/src/main/meetings/local-upload-consent.ts`, `apps/workspace-service/src/modules/meetings/local-import.ts`, `apps/workspace-service/migrations/035_local_meeting_alias_device_receipts.sql`, `tests/macro-integration/local-recording-offline-recovery.test.ts`, `apps/workspace-service/migrations/35-domain-contract.sql`.

Acceptance:

- restart finalization resumes
- no media upload without cloud-send consent
- Network disabled: mic start/pause/resume/stop, navigation during recording, import, playback, local Whisper if installed and persistence/relaunch pass.
- Summary unavailable agent/network yields typed unavailable/pending; offline summary is NOT an existing capability and requires separate local-model choice.
- Kill renderer/app with audio.part then restart: owner heartbeat recovery finalizes or preserves recoverable bytes; lost chunk explicit, never silently ready.
- Mic unplug, ffmpeg missing, whisper missing/model absent, bad codec and full disk show typed errors and keep evidence retryable.
- Observe network to confirm zero audio upload until consent command; revoke upload before queued retry prevents object send.

Negative control: local finalization uploads without cloud consent. Permissions: Call/channel grant + guest expiry + recording consent. Events: call.recording_ready, call.transcript_ready. Risks: Replacing local pipeline accidentally removes existing usable capability.

## WP-36

**Agent/MCP domain actions use same ACL and command receipts** (XL), dependencies: WP-04, WP-06, WP-09, WP-51.

Goal: Agent creates task from authorized message; third user resource denied despite allow-all; share/send/destroy preview policy; wrong revision stale rejected.

Primary operation: `agent.invokeDomain`. Additional contracts: read/search/create/update/delete/link/comment/mention/share registered per kind. DB: tool action audit; principal delegation grant + budget; context snapshot refs.

Existing files: `packages/shared/src/agent/session-tool-defs.ts`, `packages/core/src/rox2/surface-context.ts`, `packages/server-core/src/meetings/executor.ts`, `packages/session-tools-core/src/tool-defs.ts`, `packages/server-core/src/handlers/rpc/sessions.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/agents/contracts.ts`, `apps/workspace-service/src/modules/agents/commands.ts`, `apps/workspace-service/src/modules/agents/repository.ts`, `tests/macro-integration/wp-36.test.ts`, `apps/workspace-service/migrations/36-domain-contract.sql`.

Acceptance:

- Agent creates task from authorized message
- third user resource denied despite allow-all
- share/send/destroy preview policy
- wrong revision stale rejected

Negative control: allow-all bypasses resource ACL. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: agent.action_applied, agent.action_denied. Risks: Raw filesystem/store tool paths bypass shared authority; agent prompt injection via content.

## WP-37

**Automations consume canonical events with dedup and budgets** (L), dependencies: WP-07, WP-36.

Goal: Email→task workflow runs once after duplicate event; own writes do not loop; revoked source halts; queued external send obeys approval/budget.

Primary operation: `automation.run`. Additional contracts: RegisterTrigger / ExecuteRun / CancelRun / DryRun. DB: trigger predicate schema; event/run unique; bounded causation depth; budget/consent.

Existing files: `packages/shared/src/automations/types.ts`, `packages/shared/src/automations/meeting-followup.ts`, `packages/server-core/src/handlers/rpc/automations.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/automation/contracts.ts`, `apps/workspace-service/src/modules/automation/commands.ts`, `apps/workspace-service/src/modules/automation/repository.ts`, `tests/macro-integration/wp-37.test.ts`, `apps/workspace-service/migrations/37-domain-contract.sql`.

Acceptance:

- Email→task workflow runs once after duplicate event
- own writes do not loop
- revoked source halts
- queued external send obeys approval/budget

Negative control: self-generated event loops unbounded. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: automation.run_started, automation.run_finished. Risks: Notification/agent runaway loops and unbounded cross-surface graph context.

## WP-38

**Company account workspace aggregates every linked surface** (L), dependencies: WP-12, WP-25, WP-28, WP-34, WP-36, WP-50, WP-39, WP-16.

Goal: Company shows contacts/emails/tasks/meetings/calls/documents/discussion and agent account answer with citations; unauthorized private mail absent incl title/count.

Primary operation: `entity.getContext`. Additional contracts: GetEntityContext(company, filters, depth, budget). DB: typed link indexes; source revisions; principal+epoch cache; pagination.

Existing files: `apps/electron/src/renderer/pages/extra-screens/dossier/dossier-model.ts`, `apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx`, `packages/core/src/rox2/platform-contract.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/crm/contracts.ts`, `apps/workspace-service/src/modules/crm/commands.ts`, `apps/workspace-service/src/modules/crm/repository.ts`, `tests/macro-integration/wp-38.test.ts`, `apps/workspace-service/migrations/38-domain-contract.sql`.

Acceptance:

- Company shows contacts/emails/tasks/meetings/calls/documents/discussion and agent account answer with citations
- unauthorized private mail absent incl title/count

Negative control: return hidden node totals/cached titles. Permissions: Team/member policy + email source consent + admin pipeline roles. Events: entity.context_changed. Risks: N×N adapters and whole-graph traversal; derived context leaks.

## WP-39

**Files/attachments complete upload, ACL, preview and retention** (XL), dependencies: WP-02, WP-03, WP-04, WP-06.

Goal: Task/chat/Page attachments open same file identity; bad MIME/oversize fails; signed URL revoke short expiry; delete retained asset references handled.

Primary operation: `file.finalize`. Additional contracts: StartUpload / FinalizeUpload / Attach / SignedDownload / DeleteFile. DB: object checksum/size/mime; quarantine; attachment ref; entity policy and retention.

Existing files: `packages/server-core/src/handlers/rpc/files.ts`, `packages/shared/src/projects/storage.ts`, `packages/shared/src/pages/share-bundle.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/files/contracts.ts`, `apps/workspace-service/src/modules/files/commands.ts`, `apps/workspace-service/src/modules/files/repository.ts`, `tests/macro-integration/wp-39.test.ts`, `apps/workspace-service/migrations/39-domain-contract.sql`.

Acceptance:

- Task/chat/Page attachments open same file identity
- bad MIME/oversize fails
- signed URL revoke short expiry
- delete retained asset references handled

Negative control: attach private foreign upload by ID. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: file.uploaded, file.quarantined, file.deleted. Risks: Blob object ACL differs from parent and cross-surface grants; malware/parser risks.

## WP-40

**Favorites, recents and deep links across canonical kinds** (M), dependencies: WP-02, WP-03, WP-06.

Goal: Favorite Company/event/task/call opens existing surface after rename/restart; revoked entity does not expose title; old Macro/ROX links resolve mapped aliases.

Primary operation: `favorite.set`. Additional contracts: SetFavorite / Reorder / GetRecents / ResolveDeepLink. DB: user+entity unique; sort rank; viewed history private; aliases retained.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/core/src/rox2/project-membership.ts`, `packages/core/src/rox2/surface-context.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/graph/contracts.ts`, `apps/workspace-service/src/modules/graph/commands.ts`, `apps/workspace-service/src/modules/graph/repository.ts`, `tests/macro-integration/wp-40.test.ts`, `apps/workspace-service/migrations/40-domain-contract.sql`.

Acceptance:

- Favorite Company/event/task/call opens existing surface after rename/restart
- revoked entity does not expose title
- old Macro/ROX links resolve mapped aliases

Negative control: revoked title persists in favorite cache. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: favorite.changed, entity.opened. Risks: Favorites reorder races; stale identifiers should not resurrect private cache.

## WP-41

**Integrated E2E scenarios, seeded failures and disaster restore** (XL), dependencies: WP-10, WP-15, WP-16, WP-21, WP-26, WP-29, WP-34, WP-35, WP-37, WP-38, WP-39, WP-40, WP-50, WP-51.

Goal: All seven required scenarios pass actual ROX UI and provider sandbox; deliberate ACL bypass/drop-event/broken CRDT detected; restore replays with no duplicates.

Primary operation: `audit.validateScenario`. Additional contracts: Run conformance / RestoreSnapshot / ReplayOutbox. DB: test fixtures isolated; backups/migration receipts; watermarks verified after restore.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-41.test.ts`, `apps/workspace-service/migrations/41-domain-contract.sql`.

Acceptance:

- All seven required scenarios pass actual ROX UI and provider sandbox
- deliberate ACL bypass/drop-event/broken CRDT detected
- restore replays with no duplicates

Negative control: remove declared dependency and run against hidden fixture implementation. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: audit.validation_recorded. Risks: Passing static docs/fixtures must never be reported as runtime parity.

## WP-42

**Spreadsheet headless domain and React Page representation** (XL), dependencies: WP-10, WP-15.

Goal: Two users edit different cells; formulas recompute consistently; permission denies writes; reload/export round-trip; formula invalid errors explicit.

Primary operation: `spreadsheet.editCell`. Additional contracts: CreateSpreadsheet / EditCell / ImportWorkbook / ExportWorkbook. DB: typed spreadsheet CRDT schema+formula validation; limits; cell anchor refs.

Existing files: `packages/shared/src/pages/types.ts`, `packages/shared/src/pages/storage.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `apps/electron/src/renderer/components/pages/PageView.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/pages/contracts.ts`, `apps/workspace-service/src/modules/pages/commands.ts`, `apps/workspace-service/src/modules/pages/repository.ts`, `tests/macro-integration/wp-42.test.ts`, `apps/workspace-service/migrations/42-domain-contract.sql`.

Acceptance:

- Two users edit different cells
- formulas recompute consistently
- permission denies writes
- reload/export round-trip
- formula invalid errors explicit

Negative control: formula recompute differs after reconnect. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: document.content_materialized. Risks: Macro spreadsheet package scope/gating; no blind second framework transplant.

## WP-43

**Canvas representation with safe revisioned whole-file edits** (L), dependencies: WP-10, WP-39.

Goal: Concurrent canvas save detects conflict instead of silent overwrite; node entity links searchable; existing Pages route; no unsupported CRDT promise.

Primary operation: `canvas.save`. Additional contracts: SaveCanvas expectedRevision / LinkCanvasNode / ExportCanvas. DB: canvas JSON schema; optimistic revision; node stable IDs; attachments.

Existing files: `packages/shared/src/pages/types.ts`, `packages/shared/src/pages/storage.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `apps/electron/src/renderer/components/pages/PageView.tsx`. Proposed artifacts: `packages/shared/src/workspace-domain/pages/contracts.ts`, `apps/workspace-service/src/modules/pages/commands.ts`, `apps/workspace-service/src/modules/pages/repository.ts`, `tests/macro-integration/wp-43.test.ts`, `apps/workspace-service/migrations/43-domain-contract.sql`.

Acceptance:

- Concurrent canvas save detects conflict instead of silent overwrite
- node entity links searchable
- existing Pages route
- no unsupported CRDT promise

Negative control: whole-file save silently overwrites concurrent nodes. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: document.content_materialized. Risks: Macro canvas simpleSave is whole-file; spatial model not assumed collaborative.

## WP-44

**PDF, code, image and video contextual viewers** (XL), dependencies: WP-39, WP-15.

Goal: PDF annotation share/read authorization; code edit version conflict; video seek; attachment source preserved; unknown format safe download.

Primary operation: `file.annotate`. Additional contracts: OpenFileViewer / AnnotatePDF / SaveCodeRevision / SeekVideo. DB: viewer prefs private; text extraction; immutable binary versions; comments anchored.

Existing files: `packages/server-core/src/handlers/rpc/files.ts`, `packages/shared/src/projects/storage.ts`, `packages/shared/src/pages/share-bundle.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/files/contracts.ts`, `apps/workspace-service/src/modules/files/commands.ts`, `apps/workspace-service/src/modules/files/repository.ts`, `tests/macro-integration/wp-44.test.ts`, `apps/workspace-service/migrations/44-domain-contract.sql`.

Acceptance:

- PDF annotation share/read authorization
- code edit version conflict
- video seek
- attachment source preserved
- unknown format safe download

Negative control: preview reads unauthorized blob metadata. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: file.text_extracted, document.revision_created. Risks: Parser sandbox/preview XSS and binary conversion failures.

## WP-45

**Coding agent PR review and reusable Skill surfaces** (L), dependencies: WP-36, WP-12.

Goal: Project opens authorized PR diff and source agent session; review approval applies exact revision; Skills remain existing ROX destination.

Primary operation: `agent.bindPullRequest`. Additional contracts: BindPullRequest / ReviewChanges / ActivateSkill. DB: external GitHub account/PR aliases; agent change refs; immutable diff evidence.

Existing files: `packages/shared/src/agent/session-tool-defs.ts`, `packages/core/src/rox2/surface-context.ts`, `packages/server-core/src/meetings/executor.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/agents/contracts.ts`, `apps/workspace-service/src/modules/agents/commands.ts`, `apps/workspace-service/src/modules/agents/repository.ts`, `tests/macro-integration/wp-45.test.ts`, `apps/workspace-service/migrations/45-domain-contract.sql`.

Acceptance:

- Project opens authorized PR diff and source agent session
- review approval applies exact revision
- Skills remain existing ROX destination

Negative control: approve stale change revision. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: agent.change_proposed, review.recorded. Risks: Commercial provider terms, side effect approvals and stale branch data.

## WP-46

**Mobile/desktop reconnect and capability-specific UX contract** (L), dependencies: WP-41.

Goal: Desktop and narrow web client show same entity refs; offline/revoke UX no false success; reduced motion/key focus; media unavailable clearly.

Primary operation: `device.resume`. Additional contracts: GetDeviceCapabilities / ResumeSync / OpenDeepLink. DB: device cursors + credentials revoke; no shared secret in renderer.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient.swift`, `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolVersionPolicy.swift`, `packages/server-core/src/transport/capabilities.ts`, `packages/server-core/src/transport/client.ts`, `packages/server-core/src/transport/server.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-46.test.ts`, `apps/workspace-service/migrations/46-domain-contract.sql`.

Acceptance:

- Desktop and narrow web client show same entity refs
- offline/revoke UX no false success
- reduced motion/key focus
- media unavailable clearly

Negative control: Electron-only action advertised on iOS. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: device.session_changed. Risks: Electron APIs absent on mobile/web; transport session mismatch.

## WP-47

**Self-host deployment, telemetry and retention runbook** (XL), dependencies: WP-31, WP-33, WP-39, WP-04, WP-10, WP-18, WP-34, WP-17, WP-35, WP-52.

Goal: Isolated self-host stack runs one full Page+call+mail scenario; outages show backlog; restore and retention revoke index/assets; private text absent logs.

Primary operation: `operations.restore`. Additional contracts: GetSystemReadiness, SweepRetention. DB: DB/object store/job leases; encrypted provider refs; signed asset host.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `Dockerfile.server`, `packages/server-core/src/meetings/retention.ts`, `packages/server-core/src/meetings/observability.ts`, `ops/fleet-infra/inventory/group_vars/all/versions.yml`, `ops/fleet-infra/control-plane.test.ts`, `packages/server-core/src/meetings/__tests__/sharing-retention.test.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-47.test.ts`, `ops/macro-integration/compose.yaml`, `ops/macro-integration/env.example`, `ops/macro-integration/livekit.yaml`, `ops/macro-integration/prometheus-rules.yaml`, `ops/macro-integration/backup-restore.sh`, `apps/workspace-service/src/jobs/retention-sweep.ts`, `apps/workspace-service/src/health.ts`, `services/rox-media-worker/Dockerfile`, `apps/workspace-service/migrations/047_retention_job_leases_delete_receipts.sql`, `tests/macro-integration/selfhost-restore-retention.test.ts`, `apps/workspace-service/migrations/47-domain-contract.sql`.

Acceptance:

- Isolated self-host stack runs one full Page+call+mail scenario
- outages show backlog
- restore and retention revoke index/assets
- private text absent logs
- Cold selfhost setup authenticates two users, real page edit and call audio/video+recording archive, JMAP delivery/readback; dependencies explicitly unavailable rather than fake success.
- Restore PostgreSQL+objects then replay outbox -> one notification/job/object linkage and no stale private search snippets.
- Retention dry-run reports planned copies; execute proves object deleted and authorized search/assets revoked within SLA; legal hold blocks.
- Kill media worker/provider and observe backlog, bounded retry, deadletter and alert; readiness reflects unavailable recording/transcription separately.

Negative control: restore replay duplicates provider effects. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: retention.completed, provider.sync_failed. Risks: TURN, object egress, indexing and token secrets operational burden.

## WP-48

**Exact artifact SBOM and code-origin release gate** (L), dependencies: нет.

Goal: Lock-pinned workspace/sync/media/Electron SBOM; root/web conflicts marked; copied file denied absent scoped decision; notices and exact build flags reviewed.

Primary operation: `audit.releaseLicense`. Additional contracts: ProduceSBOM / AuditFileOrigin / ValidateReleaseNotices. DB: release component manifest only; no user DB mutation.

Existing files: `LICENSE`, `package.json`, `bun.lock`, `.github/workflows/ci.yml`, `Dockerfile.server`. Proposed artifacts: `scripts/compliance/generate-sbom.ts`, `plans/compliance/component-decisions.json`, `notices/THIRD-PARTY-NOTICES.txt`, `.github/workflows/license-gate.yml`, `tests/macro-integration/wp-48.test.ts`.

Acceptance:

- Lock-pinned workspace/sync/media/Electron SBOM
- root/web conflicts marked
- copied file denied absent scoped decision
- notices and exact build flags reviewed

Negative control: allow copied unreviewed web source. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: audit.license_reviewed. Risks: AGPL/web all-rights-reserved scope; optional models/codecs/commercial plugins.

## WP-49

**Editor binding spike: Tiptap/Loro versus React Lexical/Loro** (L), dependencies: WP-02, WP-03.

Goal: Both candidates run same rich-text/list/entity-node + concurrent/offline/undo/anchor fixtures; pick passing lower migration cost; failed Tiptap binding falls back to React Lexical document subtype.

Primary operation: `audit.editorBinding`. Additional contracts: ProbeEditorRoundTrip / ProbeSelectiveUndo / ProbeCursor. DB: isolated versioned editor/CRDT schema fixtures only; no production migration.

Existing files: `packages/shared/src/pages/types.ts`, `packages/shared/src/pages/storage.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `apps/electron/src/renderer/components/pages/PageView.tsx`, `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`, `apps/electron/src/renderer/pages/NotesPage.tsx`. Proposed artifacts: `spikes/editor-binding/tiptap-loro.ts`, `spikes/editor-binding/lexical-loro.ts`, `tests/macro-integration/wp-49.test.ts`, `plans/macro-integration/editor-binding-decision.json`.

Acceptance:

- Both candidates run same rich-text/list/entity-node + concurrent/offline/undo/anchor fixtures
- pick passing lower migration cost
- failed Tiptap binding falls back to React Lexical document subtype

Negative control: drop remote insertion on local undo. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: audit.editor_binding_verified. Risks: Loro binding existing Tiptap not demonstrated; adding Yjs and Loro together creates dual document authority.

## WP-50

**Agent transcript provenance and safe mixed-audience sharing** (XL), dependencies: WP-36, WP-03.

Goal: Agent reads private email then session share to teammate denied/redacted; revoke invalidates retrieval and exported summary; existing authorized owner transcript retained privately.

Primary operation: `session.shareAuthorized`. Additional contracts: GetSessionShareDecision / RevalidateContext / RedactDerivedArtifact. DB: source-ref/revision/ACL taint per prompt/tool/result/summary artifact; safe audience intersection.

Existing files: `packages/shared/src/agent/session-tool-defs.ts`, `packages/core/src/rox2/surface-context.ts`, `packages/server-core/src/meetings/executor.ts`, `packages/shared/src/sessions/storage.ts`, `packages/server-core/src/handlers/rpc/sessions.ts`, `packages/server-core/src/sessions/share-capability.ts`, `packages/core/src/types/message.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/agents/contracts.ts`, `apps/workspace-service/src/modules/agents/commands.ts`, `apps/workspace-service/src/modules/agents/repository.ts`, `tests/macro-integration/wp-50.test.ts`, `apps/workspace-service/migrations/50-domain-contract.sql`.

Acceptance:

- Agent reads private email then session share to teammate denied/redacted
- revoke invalidates retrieval and exported summary
- existing authorized owner transcript retained privately

Negative control: strip source provenance before viewer upload. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: agent.artifact_policy_changed. Risks: Persisted raw session/tool text outlives search/memory revoke; impossible un-read promise.

## WP-51

**Single-writer mode guard and sync revocation fence** (XL), dependencies: WP-03, WP-04, WP-05.

Goal: Direct legacy Notes/Page/Task/Project/IPC/tool writes rejected for shared IDs; partitioned sync shard rejects after bounded lease; successful revoke response waits fenced durable append/broadcast boundary.

Primary operation: `authority.applyFence`. Additional contracts: ResolveWriterMode / FenceDocument / ConfirmRevokeApplied. DB: workspace authority epoch; leased sync shard epoch; revoked grants fail append; projection routing.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `packages/server-core/src/handlers/rpc/notes.ts`, `packages/server-core/src/handlers/rpc/pages.ts`, `packages/server-core/src/handlers/rpc/personal-tasks.ts`, `packages/server-core/src/handlers/rpc/projects.ts`, `packages/shared/src/agent/session-tool-defs.ts`, `apps/electron/src/main/meetings/local-ipc.ts`. Proposed artifacts: `packages/shared/src/workspace-domain/commands/contracts.ts`, `apps/workspace-service/src/modules/commands/commands.ts`, `apps/workspace-service/src/modules/commands/repository.ts`, `tests/macro-integration/wp-51.test.ts`, `apps/workspace-service/migrations/51-domain-contract.sql`.

Acceptance:

- Direct legacy Notes/Page/Task/Project/IPC/tool writes rejected for shared IDs
- partitioned sync shard rejects after bounded lease
- successful revoke response waits fenced durable append/broadcast boundary

Negative control: legacy direct write changes shared entity. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: permission.revoke_applied, workspace.writer_mode_changed. Risks: Adding new gateway alone leaves legacy bypass; DB and CRDT storage not atomic.

## WP-52

**Bootstrap shared service and self-host provider/media sandbox** (L), dependencies: WP-01, WP-03, WP-04, WP-51.

Goal: Cold isolated deployment connects authenticated ROX clients to PostgreSQL, object storage and LiveKit; real health/capability receipts enable Page/media/provider slices.

Primary operation: `operations.verifyRuntime`. Additional contracts: ReadRuntimeCapabilities. DB: Use foundation migrations and provider credential references; no duplicate domain tables.

Existing files: `packages/core/src/rox2/platform-contract.ts`, `packages/server-core/src/handlers/rpc/command-gateway.ts`, `packages/server-core/src/transport/types.ts`, `Dockerfile.server`, `packages/server-core/src/meetings/retention.ts`, `packages/server-core/src/meetings/observability.ts`, `ops/fleet-infra/inventory/group_vars/all/versions.yml`, `ops/fleet-infra/control-plane.test.ts`, `packages/server-core/src/meetings/__tests__/sharing-retention.test.ts`. Proposed artifacts: `ops/macro-integration/compose.yaml`, `ops/macro-integration/env.example`, `ops/macro-integration/livekit.yaml`, `apps/workspace-service/src/operations/capabilities.ts`, `scripts/workspace/verify-providers.ts`, `docs/workspace/self-host-bootstrap.md`, `tests/macro-integration/wp-52.test.ts`.

Acceptance:

- Two authenticated native clients connect to isolated workspace; outsider denied
- PostgreSQL/object roundtrip and real LiveKit room provision/delete receipts verified; secrets absent logs
- SFU/egress/STT independently unavailable until real probes pass; fail-closed ROX room decision remains disabled on probe failure
- WS/TURN/object endpoints and TLS configured; controlled service stop makes capability unavailable and raises backlog alert

Negative control: return healthy provider receipt without actual room/object probe. Permissions: Resource read/write/action grants; deny forged actor/workspace; recheck linked refs. Events: provider.health_changed. Risks: Provider health does not prove end-to-end feature completeness; NAT/TURN and deployment secrets vary across environments.
