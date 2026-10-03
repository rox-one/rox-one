# ROX Product Learning release report

Updated 2026-10-03T15:36:51.620468+00:00. The integrated production catalogue contains **25 tours, 56 atomic steps, and 54 referenced targets**. Learning remains **off by default**. This report records implemented scope and actual receipts; application/platform acceptance and final delivery remain partial.

Inventory source: `c8d83576cd56f90c5b6478aff25c2702de47b707` on `codex/product-learning-20261003`. Validated code snapshot is c8d83576. Delivery/head SHA, PR URL, remote CI results, merged-main confirmation and post-merge smoke remain **PENDING root publication**; the local command receipts are complete. Receipts below name their own source SHAs; an earlier passing receipt does not assert that the final merged candidate passed.

Repository synchronization: baseline main `c9b7330357fb55a5e88a223783029d2768849828` advanced 46 commits to `3fff3d3869e30cb0a95b8c314b4fc67efdf2009b` (branch merge `809ddd3d`), then 24 commits to `2ccafa7211d6da4b10250c5a33b63e3c7eee5a4a` (merge `8dc5ddf22cb0030e62b8b87ab9d2912815ca4565`), then 14 commits to `2b18a2562d773c3d6e5103b2e020243d8e3a2d75` (merge `b6a0c4115a94650db6fc205e0e4545eafc3e879b`). The fourth clean synchronization merged main `2f03faa5dcc075d4acbd364dd7bdb3ba14993596`, another 7 commits, as `a49ef4812e456939bbe1bfe715d5a3d0c71b2856`. The fifth clean synchronization merged main `ae19683e69f079893cd09065487cfa7653d01154`, another 10 commits, as `86296d93c77c708400a2a14af5bf635d0e912e76`. Baseline-to-current-main covers **101 commits and 197 changed files**. The merge retains Notes comment-draft recovery, panel/workspace isolation, Meetings request guards, task-import row validation, credential-locator boundary regressions, Connection lifecycle/GitHub device controls and all 12 locales. Connections owner resolution and independent review preserved generation/workspace guards and original learning observation stamps. The fourth merge added SurfaceTabs title retries and keyboard navigation; the fifth adds settings-menu keyboard ownership/row descriptions and service-panel focus with scoped guidance dismissal. Unaffected full-suite checks retain their exact 7e0f6061 receipts. A49ef481 affected App E2E and renderer/build completed successfully before the fifth merge. Final frozen source `c8d83576cd56f90c5b6478aff25c2702de47b707` includes the fifth merge and A9 documentation update. Fresh settings/service-focus affected checks and final App/build evidence retain this exact SHA. Remote CI and branch protections remain delivery requirements.

Full release inventory: [changed-files.txt](./changed-files.txt), 180 repository-relative paths: 177 tracked candidate changes against synchronized main ae19683e plus the three release artifacts. The separate baseline-to-main comparison above contains 197 paths; each count retains its own comparison scope. The immutable aggregate [validation.json](./validation.json) records 17 actual command receipts, their executed SHAs, baseline, synchronized main and evidence limits.

Contract base: `f00ffcacc6a94a88b6e99b2f708224050842be7f`; native operation capture-time amendment `2075703d`; canonical native event identity amendment `1385fb3b`. Local IndexedDB learning schema is version 1. OBT identifiers remain separate from the existing RX registry.

## Catalogue and semantic versions

OBT-08 `source-use` and OBT-17 `notes` are version 2; all other tours are version 1. `sources.result` and `notes.create` are version 2; all other steps are version 1. Source use requires a new accepted user turn before its same-attempt tool result. Notes creation explicitly hands focus to the real native Notes dialog; merely opening the dialog never supplies `note.created`. Semantic versions prevent historical progress from silently becoming current evidence.

Catalogue: [apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts](../../apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts). Validation: [apps/electron/src/renderer/features/product-tour/catalogue/validate.ts](../../apps/electron/src/renderer/features/product-tour/catalogue/validate.ts).

| Tour | Slug | Version | Owner | Steps | Required capabilities |
| --- | --- | --- | --- | --- | --- |
| `OBT-01` | `first-result` | 1 | A4 | 6 | `shell.ready`, `sessions.available` |
| `OBT-02` | `workspace` | 1 | A0 | 1 | `shell.ready` |
| `OBT-03` | `models` | 1 | A7 | 2 | `sessions.available` |
| `OBT-04` | `working-directory` | 1 | A4 | 1 | `sessions.available`, `filesystem.selector` |
| `OBT-05` | `attachments` | 1 | A4 | 2 | `sessions.available`, `attachments.available` |
| `OBT-06` | `dictation` | 1 | A4 | 2 | `voice.available` |
| `OBT-07` | `builtin-sources` | 1 | A7 | 2 | `sources.list` |
| `OBT-08` | `source-use` | 2 | A7 | 3 | `sessions.available`, `sources.ready` |
| `OBT-09` | `skills` | 1 | A7 | 2 | `skills.available`, `sessions.available` |
| `OBT-10` | `approval` | 1 | A4 | 2 | `permissions.pending` |
| `OBT-11` | `parallel-work` | 1 | A4 | 2 | `sessions.available` |
| `OBT-12` | `agent-center` | 1 | A4 | 2 | `agent-center.available` |
| `OBT-13` | `session-workflow` | 1 | A4 | 3 | `sessions.available` |
| `OBT-14` | `projects` | 1 | A5 | 2 | `projects.available` |
| `OBT-15` | `personal-tasks` | 1 | A5 | 2 | `personal-tasks.available` |
| `OBT-16` | `pages` | 1 | A6 | 2 | `pages.available`, `pages.entity-present` |
| `OBT-17` | `notes` | 2 | A6 | 2 | `notes.available` |
| `OBT-18` | `memory` | 1 | A6 | 3 | `memory.available` |
| `OBT-19` | `search` | 1 | A6 | 2 | `search.available` |
| `OBT-20` | `inbox` | 1 | A10 | 2 | `inbox.available` |
| `OBT-21` | `feed` | 1 | A10 | 2 | `feed.available` |
| `OBT-22` | `meetings` | 1 | A11 | 2 | `meetings.available` |
| `OBT-23` | `automations` | 1 | A11 | 3 | `automations.available`, `automation.entity-present` |
| `OBT-24` | `connection-fabric` | 1 | A7 | 2 | `connection-fabric.available` |
| `OBT-25` | `learning-control` | 1 | A0 | 2 | `shell.ready` |

## Exact 56-step policy, target, and test inventory

The first-result route has six ordered steps. Acknowledged, observed, and verified evidence are distinct. Every row uses its authored bound-panel or shell scope and blocks missing targets with Retry/Pause. Unavailable branches follow authored block/not-applicable policies and never become verified outcomes. The table is declarative inventory, not a claim that every native application outcome passed.

| Tour | Step/version | Target | Route / scope | Completion | Prior-state rule | Result acknowledgement | Native handoff | Unavailable policy | Test ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OBT-01` | `first.session` v1 | `session.entry` | `keep` / `bound-panel` | session.ready / observed | `allow-current-state` | required | no | `block` | `T-FIRST-SESSION` |
| `OBT-01` | `first.permissions` v1 | `composer.permissions` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-FIRST-PERMISSIONS` |
| `OBT-01` | `first.compose` v1 | `composer.input` | `keep` / `bound-panel` | draft.nonempty / observed | `after-activation` | no | no | `block` | `T-FIRST-COMPOSE` |
| `OBT-01` | `first.send` v1 | `composer.send` | `keep` / `bound-panel` | user-turn.accepted / verified | `after-activation` | no | no | `block` | `T-FIRST-SEND` |
| `OBT-01` | `first.execution` v1 | `session.execution` | `keep` / `bound-panel` | execution.state-visible / observed | `allow-current-state` | required | no | `block` | `T-FIRST-EXECUTION` |
| `OBT-01` | `first.result` v1 | `session.final-result` | `keep` / `bound-panel` | user-turn.final-delivered / verified | `same-attempt` | required | no | `block` | `T-FIRST-RESULT` |
| `OBT-02` | `workspace.scope` v1 | `workspace.switcher` | `keep` / `shell` | acknowledged | `after-activation` | no | no | `block` | `T-WORKSPACE-SCOPE` |
| `OBT-03` | `models.picker` v1 | `composer.model` | `keep` / `bound-panel` | model-picker.opened / observed | `after-activation` | no | yes | `block` | `T-MODELS-PICKER` |
| `OBT-03` | `models.settings` v1 | `settings.ai` | `settings-ai` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-MODELS-SETTINGS` |
| `OBT-04` | `cwd.inspect` v1 | `composer.directory` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-CWD-INSPECT` |
| `OBT-05` | `attachments.add` v1 | `composer.attach` | `keep` / `bound-panel` | attachment.ready / observed | `after-activation` | no | yes | `block` | `T-ATTACHMENTS-ADD` |
| `OBT-05` | `attachments.review` v1 | `composer.attachments` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-ATTACHMENTS-REVIEW` |
| `OBT-06` | `voice.start` v1 | `composer.voice` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | yes | `block` | `T-VOICE-START` |
| `OBT-06` | `voice.review` v1 | `composer.input` | `keep` / `bound-panel` | dictation.inserted / observed | `after-activation` | no | no | `block` | `T-VOICE-REVIEW` |
| `OBT-07` | `sources.status` v1 | `sources.list` | `sources` / `bound-panel` | source.details-visible / observed | `after-activation` | no | no | `block` | `T-SOURCES-STATUS` |
| `OBT-07` | `sources.details` v1 | `source.status` | `selected-source` / `bound-panel` | source.details-visible / observed | `allow-current-state` | required | no | `block` | `T-SOURCES-DETAILS` |
| `OBT-08` | `sources.select` v1 | `composer.sources` | `keep` / `bound-panel` | session.sources-committed / observed | `after-activation` | no | yes | `block` | `T-SOURCES-SELECT` |
| `OBT-08` | `sources.ask` v1 | `composer.input` | `current-session` / `bound-panel` | user-turn.accepted / verified | `after-activation` | no | no | `block` | `T-SOURCES-ASK` |
| `OBT-08` | `sources.result` v2 | `session.tool-result` | `keep` / `bound-panel` | source.tool-succeeded / verified | `same-attempt` | required | no | `block` | `T-SOURCES-RESULT` |
| `OBT-09` | `skills.explain` v1 | `skills.list` | `skills` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-SKILLS-EXPLAIN` |
| `OBT-09` | `skills.select` v1 | `composer.skills` | `current-session` / `bound-panel` | skill.selected / observed | `after-activation` | no | yes | `block` | `T-SKILLS-SELECT` |
| `OBT-10` | `approval.inspect` v1 | `permission.request` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-APPROVAL-INSPECT` |
| `OBT-10` | `approval.resolve` v1 | `permission.actions` | `keep` / `bound-panel` | permission.resolved-by-user / verified | `after-activation` | no | yes | `block` | `T-APPROVAL-RESOLVE` |
| `OBT-11` | `parallel.new` v1 | `session.new` | `keep` / `bound-panel` | session.created / observed | `after-activation` | no | no | `block` | `T-PARALLEL-NEW` |
| `OBT-11` | `parallel.return` v1 | `session.list` | `keep` / `bound-panel` | session.reopened / observed | `after-activation` | no | no | `block` | `T-PARALLEL-RETURN` |
| `OBT-12` | `agents.overview` v1 | `agents.summary` | `agents` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-AGENTS-OVERVIEW` |
| `OBT-12` | `agents.budget` v1 | `agents.budget` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-AGENTS-BUDGET` |
| `OBT-13` | `workflow.status` v1 | `session.status` | `keep` / `bound-panel` | session.status-committed / observed | `after-activation` | no | yes | `block` | `T-WORKFLOW-STATUS` |
| `OBT-13` | `workflow.label` v1 | `session.labels` | `keep` / `bound-panel` | session.labels-committed / observed | `after-activation` | no | yes | `not-applicable` | `T-WORKFLOW-LABEL` |
| `OBT-13` | `workflow.board` v1 | `sessions.view-switcher` | `keep` / `bound-panel` | sessions.view-visible / observed | `allow-current-state` | required | no | `block` | `T-WORKFLOW-BOARD` |
| `OBT-14` | `project.open` v1 | `projects.list` | `projects` / `bound-panel` | project.visible / observed | `allow-current-state` | required | no | `block` | `T-PROJECT-OPEN` |
| `OBT-14` | `project.link` v1 | `session.project` | `current-session` / `bound-panel` | session.project-committed / observed | `after-activation` | no | yes | `block` | `T-PROJECT-LINK` |
| `OBT-15` | `tasks.create` v1 | `tasks.quick-entry` | `tasks` / `bound-panel` | personal-task.persisted / verified | `after-activation` | no | no | `block` | `T-TASKS-CREATE` |
| `OBT-15` | `tasks.delegate` v1 | `tasks.delegate` | `keep` / `bound-panel` | personal-task.delegated / verified | `after-activation` | no | no | `not-applicable` | `T-TASKS-DELEGATE` |
| `OBT-16` | `pages.open` v1 | `pages.host` | `selected-page` / `bound-panel` | page.rendered / observed | `allow-current-state` | required | no | `block` | `T-PAGES-OPEN` |
| `OBT-16` | `pages.state` v1 | `pages.freshness` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-PAGES-STATE` |
| `OBT-17` | `notes.create` v2 | `notes.create` | `notes` / `bound-panel` | note.created / verified | `after-activation` | no | yes | `block` | `T-NOTES-CREATE` |
| `OBT-17` | `notes.save` v1 | `notes.editor` | `keep` / `bound-panel` | note.persisted / verified | `after-activation` | no | no | `block` | `T-NOTES-SAVE` |
| `OBT-18` | `memory.inspect` v1 | `memory.list` | `memory` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-MEMORY-INSPECT` |
| `OBT-18` | `memory.scope` v1 | `memory.scope` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-MEMORY-SCOPE` |
| `OBT-18` | `memory.save` v1 | `memory.editor` | `keep` / `bound-panel` | memory.persisted / verified | `after-activation` | no | yes | `not-applicable` | `T-MEMORY-SAVE` |
| `OBT-19` | `search.query` v1 | `search.input` | `search` / `bound-panel` | search.finished / observed | `after-activation` | no | no | `block` | `T-SEARCH-QUERY` |
| `OBT-19` | `search.open` v1 | `search.results` | `keep` / `bound-panel` | search.result-opened / verified | `after-activation` | no | no | `block` | `T-SEARCH-OPEN` |
| `OBT-20` | `inbox.queue` v1 | `inbox.list` | `inbox` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-INBOX-QUEUE` |
| `OBT-20` | `inbox.triage` v1 | `inbox.actions` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-INBOX-TRIAGE` |
| `OBT-21` | `feed.sources` v1 | `feed.sources` | `feed` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-FEED-SOURCES` |
| `OBT-21` | `feed.read` v1 | `feed.reader` | `keep` / `bound-panel` | feed.item-opened / observed | `after-activation` | no | no | `block` | `T-FEED-READ` |
| `OBT-22` | `meetings.list` v1 | `meetings.list` | `meetings` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-MEETINGS-LIST` |
| `OBT-22` | `meetings.result` v1 | `meetings.artifacts` | `keep` / `bound-panel` | meeting.artifact-opened / observed | `after-activation` | no | no | `not-applicable` | `T-MEETINGS-RESULT` |
| `OBT-23` | `automation.trigger` v1 | `automation.trigger` | `selected-automation` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-AUTOMATION-TRIGGER` |
| `OBT-23` | `automation.action` v1 | `automation.action` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-AUTOMATION-ACTION` |
| `OBT-23` | `automation.control` v1 | `automation.controls` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-AUTOMATION-CONTROL` |
| `OBT-24` | `connections.services` v1 | `connections.services` | `connections` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-CONNECTIONS-SERVICES` |
| `OBT-24` | `connections.audit` v1 | `connections.audit` | `keep` / `bound-panel` | connections.audit-visible / observed | `after-activation` | no | yes | `block` | `T-CONNECTIONS-AUDIT` |
| `OBT-25` | `learning.library` v1 | `learning.library` | `learning` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-LEARNING-LIBRARY` |
| `OBT-25` | `learning.controls` v1 | `learning.preferences` | `keep` / `bound-panel` | acknowledged | `after-activation` | no | no | `block` | `T-LEARNING-CONTROLS` |

Distinct target IDs:

`agents.budget`, `agents.summary`, `automation.action`, `automation.controls`, `automation.trigger`, `composer.attach`, `composer.attachments`, `composer.directory`, `composer.input`, `composer.model`, `composer.permissions`, `composer.send`, `composer.skills`, `composer.sources`, `composer.voice`, `connections.audit`, `connections.services`, `feed.reader`, `feed.sources`, `inbox.actions`, `inbox.list`, `learning.library`, `learning.preferences`, `meetings.artifacts`, `meetings.list`, `memory.editor`, `memory.list`, `memory.scope`, `notes.create`, `notes.editor`, `pages.freshness`, `pages.host`, `permission.actions`, `permission.request`, `projects.list`, `search.input`, `search.results`, `session.entry`, `session.execution`, `session.final-result`, `session.labels`, `session.list`, `session.new`, `session.project`, `session.status`, `session.tool-result`, `sessions.view-switcher`, `settings.ai`, `skills.list`, `source.status`, `sources.list`, `tasks.delegate`, `tasks.quick-entry`, `workspace.switcher`.

Ownership map: [docs/product-tour/target-map.json](../../docs/product-tour/target-map.json). Independent acceptance and step matrices: [tests/e2e/product-tour/acceptance-matrix.json](../../tests/e2e/product-tour/acceptance-matrix.json) and [tests/e2e/product-tour/step-matrix.json](../../tests/e2e/product-tour/step-matrix.json). The matrices retain independent A9 ownership; this report does not replace missing native acceptance with catalogue or reducer assertions.

## Integrated implementation and authority boundaries

- The native Learning settings route exposes all catalogue entries, prerequisites, Resume/Replay, optional invitations, local diagnostics, and workspace-scoped reset. It shows acknowledged and verified counts separately. No acknowledgement is a replacement for a native operation receipt.
- A single ProductTourProvider runs the pure reducer below the existing navigation and shell readiness providers. MainContentPanel has an explicit TourPanelScope; neighboring panel targets retain their own context, while shell/sidebar controls follow focused-panel ownership.
- Target registration belongs to actual mounted host elements and carries workspace/panel/session/entity scope without a run token. Capture creates an attempt-bound observation before the real operation; emit retains its original binding, operation token, start time and native event identity. Stale events cannot be relabelled with a new attempt.
- Navigation uses an allowlisted resolver for existing ViewRoute values. Missing session/page/automation prerequisites open the existing list with auto-selection suppressed and wait for explicit user choice. The engine has no domain mutation API.
- Popup/spotlight uses the production registry, geometry observer and Radix components. Higher-priority native dialogs keep focus authority; handoff retains evidence until dialog close. Outside interaction, focus loss, hidden document, scope changes, missing/ambiguous targets and lease loss pause or block the walkthrough.
- Profile and progress are local IndexedDB records. Progress mutations are atomic and semantic-version aware; active-window lease uses a monotonically increasing fence, 15-second TTL and 5-second renewal. Lease loss cancels the learning presentation. Memory-only fallback is visible and does not silently promise cross-window coordination.
- Default learning preferences are invitations off and diagnostics off. The optional local diagnostics journal is allowlisted, capped at 500 events and seven days, and clears when diagnostics are disabled. It does not store message/document text, credentials, paths, URLs, native entity/workspace/session IDs or operation IDs.
- Existing setup, welcome creation, user-selected effective model and permission defaults retain their native authority. Tour launch never sends a request, approves a permission, changes allow-all, starts microphone capture, imports secrets/OAuth, runs an automation, or publishes a Page. Working-directory selection is not labelled a sandbox.
- Memory onboarding presentationAllowed is an independent display gate. Deferring or suppressing the dialog does not mark Memory onboarded and does not produce memory.persisted. Quest Show how maps only first_note → OBT-17, first_task → OBT-15, first_workflow → OBT-23; manual Quest completion remains separate from verified learning evidence.

Native evidence by integrated owner lane:

| Lane | Implemented observation authority | Evidence limits |
| --- | --- | --- |
| Chat/execution A4 | Native accepted turns, exact new final message, user permission resolution, attachments/dictation, reopened/created sessions, workflow/project commits; canonical source/tool provenance joins source use | External model replies may be deterministic fixtures; pure/event-processor evidence does not prove a complete App send path |
| Personal tasks/projects A5 | Native task persistence/read-back, delegation acknowledgement, and task/session/project association | Unsaved optimistic rows or failed native writes cannot count as persistence |
| Knowledge A6 | Notes create read-back and exact main-owned receipt ACK; Memory add/edit plus scope/owner read-back; native Search query and current-hit freshness read; Page current digest lease and mounted host observation | Denied asset inventory is an explicit accessory state, without broadening native ACL. PageFrame iframe DOM is not inspected. Stale query/workspace generations cannot open a stale destination |
| Sources/skills/models/Fabric A7 | Readiness from current native state, explicit selected skills/sources, source/tool provenance, effective model picker state and native Fabric audit observations | Installing/denied/unavailable APIs stay unavailable; mounted lists alone do not prove selected/used sources or skills |
| Inbox/Feed A10 | Mounted Inbox list/actions targets and current source readiness; Feed sources and user-selected matching external publication rendered in the current native reader | Done/Snooze is renderer queue triage and never a permission approval or persistence receipt. Failed/stale sources stay unavailable; agent activity is excluded from publication-reading evidence. Native integration commit c02c3b0d is present; broader native App domain coverage remains partial |
| Meetings/Automations A11 | Mounted native meeting list/artifact target with workspace, selected ID and updatedAt match; Automation trigger/action/controls targets scoped to the loaded native automation revision | Read-only adapter has no recorder or automation mutation port. Missing loaded artifacts/entities stay pending, denied APIs unavailable. Native integration commit 0982cd46 and entity-binding correction f00be34c are present; broader native App domain coverage remains partial |

## Important files

- Contract: [apps/electron/src/renderer/features/product-tour/contracts/index.ts](../../apps/electron/src/renderer/features/product-tour/contracts/index.ts).
- Reducer/evidence: [apps/electron/src/renderer/features/product-tour/core/index.ts](../../apps/electron/src/renderer/features/product-tour/core/index.ts).
- Provider and launch/lease policy: [apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx](../../apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx).
- Capture and target hooks: [apps/electron/src/renderer/features/product-tour/runtime/hooks.tsx](../../apps/electron/src/renderer/features/product-tour/runtime/hooks.tsx).
- Native observation bridge: [apps/electron/src/renderer/features/product-tour/runtime/bridge.ts](../../apps/electron/src/renderer/features/product-tour/runtime/bridge.ts).
- Read-only route resolution: [apps/electron/src/renderer/features/product-tour/runtime/routes.ts](../../apps/electron/src/renderer/features/product-tour/runtime/routes.ts).
- Native App composition: [apps/electron/src/renderer/App.tsx](../../apps/electron/src/renderer/App.tsx).
- Per-panel scope: [apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx](../../apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx).
- Learning settings: [apps/electron/src/renderer/pages/settings/LearningSettingsPage.tsx](../../apps/electron/src/renderer/pages/settings/LearningSettingsPage.tsx).
- Central flag key: [apps/electron/src/renderer/lib/local-storage.ts](../../apps/electron/src/renderer/lib/local-storage.ts).
- Target registry: [apps/electron/src/renderer/features/product-tour/ui/target-registry.ts](../../apps/electron/src/renderer/features/product-tour/ui/target-registry.ts).
- Spotlight and geometry: [apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx](../../apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx).
- Persistence/database: [apps/electron/src/renderer/features/product-tour/persistence/database.ts](../../apps/electron/src/renderer/features/product-tour/persistence/database.ts).
- Progress mutations: [apps/electron/src/renderer/features/product-tour/persistence/progress.ts](../../apps/electron/src/renderer/features/product-tour/persistence/progress.ts).
- Window lease: [apps/electron/src/renderer/features/product-tour/persistence/lease.ts](../../apps/electron/src/renderer/features/product-tour/persistence/lease.ts).
- Local diagnostics: [apps/electron/src/renderer/features/product-tour/analytics/diagnostics.ts](../../apps/electron/src/renderer/features/product-tour/analytics/diagnostics.ts).
- Privacy allowlist: [apps/electron/src/renderer/features/product-tour/analytics/events.ts](../../apps/electron/src/renderer/features/product-tour/analytics/events.ts).
- Chat native adapter: [apps/electron/src/renderer/features/product-tour/adapters/chat/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/chat/index.ts).
- Tasks/project native adapter: [apps/electron/src/renderer/features/product-tour/adapters/work/tasks-projects/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/work/tasks-projects/index.ts).
- Inbox/Feed native adapter: [apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/index.ts).
- Meetings/Automations native adapter: [apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/index.ts).
- Knowledge native adapter: [apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts).
- Notes UI/read/write scope: [apps/electron/src/renderer/pages/NotesPage.tsx](../../apps/electron/src/renderer/pages/NotesPage.tsx).
- Notes lifecycle controller: [apps/electron/src/renderer/lib/native-notes-sync.ts](../../apps/electron/src/renderer/lib/native-notes-sync.ts).
- Memory UI: [apps/electron/src/renderer/components/memory/MemoryScreen.tsx](../../apps/electron/src/renderer/components/memory/MemoryScreen.tsx).
- Page host and digest lease: [apps/electron/src/renderer/components/pages/PageView.tsx](../../apps/electron/src/renderer/components/pages/PageView.tsx).
- Surface tab navigation: [SurfaceTabs.tsx](../../apps/electron/src/renderer/platform/SurfaceTabs.tsx), [surface-tab-navigation.ts](../../apps/electron/src/renderer/platform/surface-tab-navigation.ts) and [knowledge-tab-titles.ts](../../apps/electron/src/renderer/platform/knowledge-tab-titles.ts).
- Current query/result route: [apps/electron/src/renderer/pages/SearchPage.tsx](../../apps/electron/src/renderer/pages/SearchPage.tsx).
- Connection lifecycle UI: [ConnectionLifecyclePanel.tsx](../../apps/electron/src/renderer/pages/ConnectionLifecyclePanel.tsx).
- Task import row validation: [import-validation.ts](../../packages/core/src/tasks/personal/import-validation.ts).
- Credential-locator boundary documentation: [credential-locator-own-data-validation.md](../../docs/credential-locator-own-data-validation.md).
- Connections native adapter: [apps/electron/src/renderer/features/product-tour/adapters/connections/index.ts](../../apps/electron/src/renderer/features/product-tour/adapters/connections/index.ts).
- Memory legacy display coordination: [apps/electron/src/renderer/components/app-shell/OnboardingDialog.tsx](../../apps/electron/src/renderer/components/app-shell/OnboardingDialog.tsx).
- Compatible Quest entrypoints: [apps/electron/src/renderer/components/app-shell/QuestProgressCard.tsx](../../apps/electron/src/renderer/components/app-shell/QuestProgressCard.tsx).
- App/native acceptance configuration: [tests/e2e/product-tour/playwright.config.ts](../../tests/e2e/product-tour/playwright.config.ts).
- Native manual gate runner: [scripts/product-tour/run-native.ts](../../scripts/product-tour/run-native.ts).
- Real build comparison: [scripts/product-tour/bundle-report.ts](../../scripts/product-tour/bundle-report.ts).

New catalogue copy is translated across the actual 12 locale files: `ar`, `de`, `en`, `es`, `fr`, `hu`, `ja`, `ko`, `pl`, `ru`, `zh-Hans`, `zh-Hant`. Catalogue metadata is authoring text; displayed Learning/step text uses productTour i18n keys.

## Native fixes included during integration

- Notes core read authority now depends on Notes reads. Denied host asset inventory is shown as an explicit accessory-unavailable state and disables attachment/gallery affordances without disabling authorized native Notes creation/list/save. No ACL bypass or successful asset fixture was introduced.
- Notes sync settles obsolete open/close work for StrictMode. Followup `1bd96d49` shares close custody by the preload nativeReplica API across replacement controllers, and ordinary handle close cannot invalidate another panel's opening or live receipt. Authority-context changes still invalidate custody; the last closed context cannot trust a delayed receipt until stable replay. Genuine WebSocket/native authority/journal/encrypted-outbox regression covers two controllers and a delayed committed save. A6 ran 31 lifecycle/native/legacy tests across four files, exit 0, `/tmp/a6-shared-lifecycle-tests.log`; targeted ESLint exited 0, `/tmp/a6-shared-lifecycle-lint.log`. These worker receipts preceded the integrated final gate.
- Main comment-draft recovery keeps unsent quote/body keyed by workspace and note. Captured callbacks cannot retarget a draft after navigation. The merge resolution retained those helpers alongside the learning targets, scoped observations, and native save receipts. Seventeen comment-draft/knowledge tests passed during conflict resolution, exit 0, `/tmp/a6-mainmerge-notes-tests.log`; the subsequent main merge completed; final candidate validation is recorded separately below.
- Root runtime waits for local profile readiness, exposes unavailable lease coordination honestly, preserves capture-time bindings, and rechecks panel/workspace/entity context. Native dialog handoff holds completion until native focus authority is released. Actual guided Notes tests drove the version-2 handoff and geometry/routing corrections; a direct Notes domain pass does not close a failing guided outcome.
- The stronger real App Notes geometry check exposed a stable **112.4375 CSS-pixel** stale-mask offset at bf82a328 despite an earlier 13-test E2E pass. A2 correction `a0ff359a` observes DOM layout movement and transitions, including sibling insertion without size changes. The focused actual App guided Notes flow now passes its stable mask/target assertion **≤2 CSS pixels**, one test passed in 41.2 seconds, `/workspace/product-tour-a9-geometry-a0ff359a.log`. The prior failing receipt remains evidence; the subsequent complete a0ff359a E2E also passed all 13 tests; frozen-candidate evidence is recorded separately.

- Historical a0ff359a feature failure: exit **1**, 294 passed / 1 failed after esbuild deadlock in the native Meetings/Automation browser harness. This failure remains recorded even though its gate/log paths are reused by the fresh command. A11 fix `2a30b935` isolates real browser cases in Bun child processes; test isolation neither broadens native authority nor substitutes synthetic components. The frozen-candidate full suite has its own receipt below.
- Native evidence-label correction `7e0f6061` limits automated native smoke claims to real Electron fresh setup and absence of an automatic tour. It does not claim OS focus, dialogs, Start/Pause/Resume, Git Bash, drawer or microphone-denial acceptance.

- Fifth-merge integration review: scoped sidebar guidance uses its own workspace key; Memory display coordination and the Learning flag retain their prior authority. Native settings popovers keep focus ownership over the Learning overlay. A2 independently reviewed the integrated settings/service snapshot without source edits and reported no blocking issue; the recorded settings/service command below passed 18 cases.

## Baseline and dependency corrections

Baseline receipts are local files under `/workspace/onboarding-baseline-gates`. Initial worktree dependency bootstrap produced an unavailable-tsc exit 127. Initial all-package typecheck exit 2 came from cross-worktree physical dependency resolution: WsRpcClient private-member types resolved from two trees. That dependency-graph artifact was corrected; baseline `typecheck:all` then exited 0 (root session 96000, corroborated by `typecheck-all-corrected.log` completing the entire package sequence without diagnostics). It is not a source regression.

| Baseline check | Actual result | Evidence / interpretation |
| --- | --- | --- |
| Initial all-package typecheck | exit 2 | `typecheck-all.json` / `.log`; dependency graph artifact before correction |
| Corrected all-package typecheck | exit 0, root-observed session 96000 | `typecheck-all-corrected.log`; full sequence completes |
| Electron lint | exit 1, 26 errors / 277 warnings | `lint-electron.json` / `.log`; independently present baseline blockers, subsequently fixed |
| `webui:typecheck` | exit 0 | Baseline JSON/log receipt |
| `lint:i18n:parity` | exit 0 | Baseline JSON/log receipt |
| `lint:i18n:sorted` | exit 0 | Baseline JSON/log receipt |
| `lint:i18n:coverage` | exit 0 | Baseline JSON/log receipt |
| `rx:validate` | exit 0 | Baseline JSON/log receipt |
| Production renderer build at c9b73303 | exit 0 | `/workspace/rox-workers/A9-baseline-renderer-build.log`; actual artifact retained |

SurfaceTabs browser environment correction: the upstream harness checks its owned Chrome PID against the executable path. The initial /usr/bin/chromium shell-wrapper invocation failed that identity guard before browser assertions. Re-running the unchanged code with actual /usr/lib/chromium/chromium ELF passed 13 cases, 0 failed and 0 skipped; see surface-tabs.json and its recorded command below.

The baseline lint errors were fixed rather than waived. The fresh recorded Electron lint receipt has exit 0 with **0 errors / 294 warnings**, at `c8d83576cd56f90c5b6478aff25c2702de47b707`. Existing warnings remain visible. Translations cover the actual 12 locales: ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant; native UI and catalogue display use productTour i18n keys.

## Recorded gate command receipts

These are actual completed commands from `/workspace/product-tour-gates/*.json`, with exact source SHAs and local logs. Standard records report `dirty_diff_sha256: null`; E2E/build/native receipts explicitly state tracked-worktree status and scope. Unaffected feature/domain/storage/locale/upstream checks retain their executed 7e0f6061 receipts; affected Electron/WebUI/settings/service/build/App checks have their own final source receipts. E2E: **exit 0 at c8d83576cd56f90c5b6478aff25c2702de47b707, 13 passed / 0 failed — final frozen candidate complete**. Renderer/build: **renderer/comparison exits 0/0 at c8d83576cd56f90c5b6478aff25c2702de47b707 — final frozen candidate complete**. Remote CI, delivery merge, manual/platform acceptance and post-merge smoke are not inferred from local commands.

| Command | Exit / observed result | Receipt source SHA | Local JSON receipt / log |
| --- | --- | --- | --- |
| `bun run test:product-tour` | 0 — 302 passed + 5 passed; 0 failures | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/feature.json), [log](/workspace/product-tour-gates/feature.log) |
| `bun run typecheck:electron` | 0 | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/electron-types.json), [log](/workspace/product-tour-gates/electron-types.log) |
| `bun run typecheck:all` | 0 | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/all-types.json), [log](/workspace/product-tour-gates/all-types.log) |
| `bun run webui:typecheck` | 0 | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/webui-types.json), [log](/workspace/product-tour-gates/webui-types.log) |
| `bun run webui:build` | 0 | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/webui-build.json), [log](/workspace/product-tour-gates/webui-build.log) |
| `bun run lint:electron` | 0 — 0 errors / 294 warnings | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/lint.json), [log](/workspace/product-tour-gates/lint.log) |
| `bun run lint:i18n:parity` | 0 | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/locales-parity.json), [log](/workspace/product-tour-gates/locales-parity.log) |
| `bun run lint:i18n:sorted` | 0 | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/locales-sorted.json), [log](/workspace/product-tour-gates/locales-sorted.log) |
| `bun run lint:i18n:coverage` | 0 | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/locales-coverage.json), [log](/workspace/product-tour-gates/locales-coverage.log) |
| `bun run rx:validate` | 0 | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/rx.json), [log](/workspace/product-tour-gates/rx.log) |
| `git diff --check` | 0 | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/diff.json), [log](/workspace/product-tour-gates/diff.log) |
| `CHROMIUM_EXECUTABLE=/usr/bin/chromium bun test packages/core/src/tasks/personal/import-validation.test.ts apps/electron/src/renderer/pages/__tests__/task-import-validation.test.ts apps/electron/src/renderer/features/product-tour/adapters/work/tasks-projects apps/electron/src/renderer/pages/__tests__/connection-inspect-own-fields.test.ts apps/electron/src/renderer/pages/__tests__/connections-lifecycle.browser.test.ts apps/electron/src/renderer/pages/__tests__/connections-list.test.ts apps/electron/src/renderer/pages/__tests__/connections-page.test.ts apps/electron/src/renderer/platform/__tests__/inspector-host-connections.test.ts packages/core/src/platform/identity/credential-types.test.ts packages/core/src/platform/identity/attach-credential-ref.test.ts` | 0 — 238 passed / 0 failed / 0 skipped | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/upstream-critical.json), [log](/workspace/product-tour-final-upstream-critical.log) |
| `CHROMIUM_EXECUTABLE=/usr/lib/chromium/chromium bun test apps/electron/src/renderer/platform/__tests__/knowledge-tab-titles.test.ts apps/electron/src/renderer/platform/__tests__/surface-tab-navigation.test.ts apps/electron/src/renderer/platform/__tests__/surface-tabs.browser.test.ts` | 0 — 13 passed / 0 failed / 0 skipped | `a49ef4812e456939bbe1bfe715d5a3d0c71b2856` | [JSON](/workspace/product-tour-gates/surface-tabs.json), [log](/workspace/product-tour-final-surface-tabs-binary.log) |
| `CHROMIUM_EXECUTABLE=/usr/lib/chromium/chromium bun test apps/electron/src/renderer/components/settings/__tests__/settings-menu-navigation.test.ts apps/electron/src/renderer/components/settings/__tests__/settings-menu.browser.test.ts apps/electron/src/renderer/components/app-shell/__tests__/service-panel-navigation.test.ts apps/electron/src/renderer/components/app-shell/__tests__/sidebar-guidance.test.ts` | 0 — 18 passed / 0 failed / 0 skipped | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/settings-service.json), [log](/workspace/product-tour-final-settings-service.log) |
| `bun run test:product-tour:e2e` | 0 — 13 passed / 0 failed / 0 skipped in 105.726214s; actual App mask ≤2px | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/e2e.json), [log](/workspace/product-tour-a9-final-c8d83576-e2e.log) |
| `bun scripts/electron-build-renderer.ts` + bundle report | 0 / 0 — actual production artifacts; six forbidden fixture markers scanned, zero present | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/build.json), [renderer log](/workspace/product-tour-a9-final-c8d83576-renderer.log), [bundle log](/workspace/product-tour-a9-final-c8d83576-bundle.log) |
| `bun scripts/product-tour/run-native.ts` | 2 — Linux NOT_RUN; manual/platform acceptance release blocking | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/native-a9.json), [log](/workspace/product-tour-a9-native-c8d83576.log) |
| Remote CI, PR checks, delivery merge and post-merge smoke | PENDING root | PENDING | Final URLs, SHA and exits must be appended |

Local receipts are workspace evidence; they are not silently promoted to committed CI artifacts. Browser/domain CI and macOS/Windows native-smoke workflows are implemented in [.github/workflows/product-tour-native.yml](../../.github/workflows/product-tour-native.yml). Native smoke leaves the broader manual cases NOT_RUN. No remote CI success is claimed here.

The serial-rerun receipt preserves the first-run failure and retained trace; a later pass does not erase that history.

## Application and platform evidence limits

Independent acceptance: [tests/e2e/product-tour/acceptance-report.md](../../tests/e2e/product-tour/acceptance-report.md). Its final matrix has 62 unique cases: 59 required cases plus three main-delta cases, retaining partial/NOT_RUN states beyond the executed local subset. The earlier 71776c38 E2E receipt exited 1 with 10 passed / 3 failed: guided Notes, workspace scope, and ordinary-navigation pause. Failures are preserved in `/workspace/product-tour-a9-final-71776c38-e2e.log`; later source corrections do not by themselves prove a successful fresh rerun. The later 607f3ec5 full E2E command exited 0 with 13 passed, but the newly required stable-mask assertion at bf82a328 then failed after a 15-second poll with 112.4375px offset. The a0ff359a focused actual App Notes flow passes the ≤2px assertion. The complete a0ff359a E2E exited 0 with 13 passed. Latest completed E2E: exit 0 at c8d83576cd56f90c5b6478aff25c2702de47b707, 13 passed / 0 failed — final frozen candidate complete. The earlier cold-start failure and its trace remain retained.

Historical first frozen E2E run: exit **1**, **12 passed / 1 failed**. APP-01/APP-06 exceeded the unchanged 60-second cold App startup budget during concurrent Vite/renderer/feature/type/WebUI workloads. The other 12 cases passed. Preserve [first-run log](/workspace/product-tour-a9-final-7e0f6061-e2e.log), [first raw JSON](/workspace/product-tour-a9-first-7e0f6061-e2e.json), and [startup trace](/workspace/product-tour-a9-first-7e0f6061-flag-off-timeout.zip). A9 reran the identical command and source serially after other workloads completed; no timeout increase or retry was added.

| Outcome | Recorded evidence | Remaining limit |
| --- | --- | --- |
| APP-01 / APP-06 flag absent | Actual App in isolated native-authorized profile; no forced overlay or mutation, no Learning DB open; frozen serial rerun passed | Packaged OS behavior and all native variants remain separate |
| APP-05 restricted WebUI | Actual restricted route; host sessions unavailable and direct getSessions denied | Other restricted routes/outcomes remain open |
| DOMAIN-12 canonical Notes | Actual UI create/edit, production bridge/queue/RPC, native journal/file read-back, reload and Search passed | No successful asset fixture substituted; frozen full serial rerun also passed; packaged OS scope remains separate |
| T-NOTES-CREATE / T-NOTES-SAVE and actual App mask geometry | Focused guided App flow passed at a0ff359a, after ordinary native dialog/user edits and exact canonical creation/save; stable mask ≤2px assertion passed | Full frozen serial E2E passed; packaged native dialog/focus remains separate |
| T-LEARNING-LIBRARY / CONTROLS | Focused real App command recorded both acknowledged steps after voluntary Start/Next | Full frozen serial E2E passed this case; OS acceptance remains separate |
| Component targets/geometry/layers | Six real-browser production component checks recorded | Component tests do not close multi-panel/application/OS dialog cases |
| Full live first own response, fast response, draft and permission App flows | NOT_RUN as complete live App acceptance | Reducer/event-processor tests and synthetic/native message fixtures establish narrower behavior |
| Other domain App operations and competing windows/lease/restart | PARTIAL / open | Native adapter persistence tests do not prove every complete application route |
| NATIVE-01 macOS Start/Pause/Resume/menu/native dialogs | NOT_RUN | Requires recorded actual platform/operator evidence |
| NATIVE-02 Windows Start/Pause/Resume/Git Bash/drawer/native dialogs | NOT_RUN | Requires recorded actual platform/operator evidence |
| NATIVE-03 actual OS microphone denial | NOT_RUN | Needs explicit operator/system-dialog evidence; no automatic capture |

The App harness mounts production App/navigation/domain pages and actual WebSocket transport, native authority/journal/Notes handlers, main replica custody, and preload bridge. Owned profile enrollment, shell reads, credential-store injection and in-process IPC are the harness boundary. It does not establish packaged Electron IPC sender identity, OS credential custody or system-dialog focus, live OAuth/model responses, or unavailable host inventory. No fixture may upgrade an unavailable API to successful native authority.

## Actual production artifact comparison

Latest completed build/comparison source `c8d83576cd56f90c5b6478aff25c2702de47b707`, tracked worktree dirty false, renderer exit 0 in 83s and bundle comparison exit 0. [Receipt](/workspace/product-tour-gates/build.json), [renderer log](/workspace/product-tour-a9-final-c8d83576-renderer.log), [bundle log](/workspace/product-tour-a9-final-c8d83576-bundle.log). Actual separately built baseline and candidate artifacts use the same Bun gzip level 9, per JS/CSS file, excluding source maps. This baseline-to-candidate delta includes synchronized main changes.

| Artifact metric | Baseline c9b73303 | Latest completed candidate | Delta |
| --- | ---: | ---: | ---: |
| JS files | 386 | 389 | +3 |
| JS raw bytes | 26,537,285 | 27,138,848 | +601,563 |
| JS gzip bytes | 6,555,262 | 6,710,069 | +154,807 (+2.36%) |
| CSS raw bytes | 395,895 | 392,764 | -3,131 |
| CSS gzip bytes | 60,636 | 60,414 | -222 |

Baseline artifact SHA-256: `aca02b2ad7f8ac9ef8e54fa2c7734087d74e58d7f1a535ade54c6cfa153a956f`; candidate: `eab4c0db06554d355315d8bfb0890a4e2373539bdd231ecca9291485fbac5c2f`. Six forbidden markers scanned, **0** present. Earlier Python-gzip numbers are not mixed into this comparison. Final artifact validation: renderer/comparison exits 0/0 at c8d83576cd56f90c5b6478aff25c2702de47b707 — final frozen candidate complete.

## Rollout and rollback

1. Keep Learning default off. The central logical key is `feature-product-tour-v1`; actual current localStorage key is `craft-feature-product-tour-v1` because the utility preserves its legacy prefix. Operators enable Learning explicitly through Settings → Learning. Do not rename the key or force a series on upgrade.
2. Keep invitations and diagnostics off until the user opts in. Use an isolated profile to validate the retained manual/platform gates. Enabling Learning presents guidance; it does not create objects, send prompts, select execution permissions, start a microphone, or run an automation.
3. Disable Learning for immediate presentation rollback. The provider pauses/hides the attempt, cancels Learning timers and observers/listeners, and releases its window lease. Native agents, active work, approvals, Notes, Memory and other user data retain their existing lifecycle.
4. If code rollback is needed, revert the relevant Learning commits with current-main reconciliation and repeat impacted gates. Preserve independently merged native recovery fixes, OMP runtime integration, user-selected model and permission behavior, and the existing allow-all default. No Learning rollback resets setup, native grants, user documents, conversations, Memory, or Quest achievements.
5. Preserve local progress/schema on disable or code rollback. Scoped reset is a separate user-confirmed action for current profile/workspace Learning only. Disabling diagnostics clears its local journal. Neither operation changes native domain authority.
6. Resume creates a fresh run token and checks live prerequisites, target context, capabilities, and lease. Replay separates historical progress from current attempt evidence. Neither operation automatically resumes a native task or grants permission.

## Delivery fields still to close

- Delivery/head and merged-main SHA, PR URL, remote CI/check URLs and post-merge smoke: **PENDING root publication**.
- Final frozen source `c8d83576cd56f90c5b6478aff25c2702de47b707`: E2E exit 0 at c8d83576cd56f90c5b6478aff25c2702de47b707, 13 passed / 0 failed — final frozen candidate complete; renderer/comparison exits 0/0 at c8d83576cd56f90c5b6478aff25c2702de47b707 — final frozen candidate complete. Other receipt SHAs remain explicitly recorded; remote CI, delivery merge and post-merge smoke are **PENDING root**.
- Complete live first-result and broader application acceptance: **NOT_RUN / PARTIAL** as recorded, not inferred from unit or component checks.
- macOS, Windows, and microphone manual acceptance: **NOT_RUN**; native runner reports release blocking, exit 2 on this Linux host.
- This report is intentionally evidence-limited. Root owns publication metadata and main confirmation; A9 retains its independent acceptance documents.
