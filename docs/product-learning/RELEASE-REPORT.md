# ROX Product Learning release report

Updated 2026-10-03T17:14:52.699762+00:00. The integrated production catalogue contains **25 tours, 56 atomic steps, and 54 referenced targets**. Learning remains **off by default**. This report records implemented scope and actual receipts; application/platform acceptance and final delivery remain partial.

Inventory/frozen code source: `f4c090ca9f09a05a38d653326f247eedc62cef46` on `codex/product-learning-20261003`; latest synchronized main `d4846751fe993f076d9fce329bdc7e1f6f342899`. [PR #1437](https://github.com/rox-one/rox-one/pull/1437) is published. Root owns the single batched documentation publication, new remote CI/CodeQL run, merge and post-merge confirmation. Local gate receipts below retain their exact executed SHAs; fresh full App E2E is complete. Broader live/native manual cases remain NOT_RUN/PARTIAL.

Repository synchronization: baseline main `c9b7330357fb55a5e88a223783029d2768849828` advanced 46 commits to `3fff3d3869e30cb0a95b8c314b4fc67efdf2009b` (branch merge `809ddd3d`), then 24 commits to `2ccafa7211d6da4b10250c5a33b63e3c7eee5a4a` (merge `8dc5ddf22cb0030e62b8b87ab9d2912815ca4565`), then 14 commits to `2b18a2562d773c3d6e5103b2e020243d8e3a2d75` (merge `b6a0c4115a94650db6fc205e0e4545eafc3e879b`). The fourth clean synchronization merged main `2f03faa5dcc075d4acbd364dd7bdb3ba14993596`, another 7 commits, as `a49ef4812e456939bbe1bfe715d5a3d0c71b2856`. The fifth clean synchronization merged main `ae19683e69f079893cd09065487cfa7653d01154`, another 10 commits, as `86296d93c77c708400a2a14af5bf635d0e912e76`. This fifth-sync comparison covered **101 commits and 197 changed files**. The sixth synchronization merged main `fd6e2f2cebafeb5bbf464aef45604ce4e7fcaca1` (+10 commits) as `dd9faa706b1a46b7190333c8a76233c055f40058`; Product Learning foundation conflicts retained captured operation continuity, defensive evidence level/origin checks and diagnostics own-data accessor privacy guards. The seventh synchronization merged main `d4846751fe993f076d9fce329bdc7e1f6f342899` (+21 commits, 60 changed files from fd6) as `174a873eef443dcd62b8842979a2f88b21692aa5`. Baseline-to-latest-main now covers **132 commits and 246 changed files**. Incoming voice clipboard/trailing-space delivery and responsive Notes tools/modal/focus/width behavior remain intact. The merge retains Notes comment-draft recovery, panel/workspace isolation, Meetings request guards, task-import row validation, credential-locator boundary regressions, Connection lifecycle/GitHub device controls and all 12 locales. Connections owner resolution and independent review preserved generation/workspace guards and original learning observation stamps. The fourth merge added SurfaceTabs title retries and keyboard navigation; the fifth adds settings-menu keyboard ownership/row descriptions and service-panel focus with scoped guidance dismissal. Unaffected full-suite checks retain their exact 7e0f6061 receipts. A49ef481 affected App E2E and renderer/build completed successfully before the fifth merge. The earlier pre-publication code snapshot `c8d83576cd56f90c5b6478aff25c2702de47b707` retains its actual settings/service-focus and App/build receipts. New production source includes the seventh main merge and all review repairs; final frozen source is `f4c090ca9f09a05a38d653326f247eedc62cef46`. Remote CI and branch protections remain delivery requirements.

Full release inventory: [changed-files.txt](./changed-files.txt), **184 repository-relative paths**: 181 production/test paths against synchronized main d4846751 plus three release artifacts. The baseline-to-main comparison above contains 246 paths and retains its own comparison scope. Aggregate [validation.json](./validation.json) captures 18 actual receipt records and explicit pending local/delivery fields; each executed SHA is preserved. The prior committed 17-receipt c8 snapshot is preserved externally at `/workspace/product-tour-ci/validation-pre-publication-c8d83576.json`.

Contract base: `f00ffcacc6a94a88b6e99b2f708224050842be7f`; native operation capture-time amendment `2075703d`; canonical native event identity amendment `1385fb3b`. Local IndexedDB learning schema is version 1. OBT identifiers remain separate from the existing RX registry.

## Catalogue and semantic versions

OBT-06 `dictation`, OBT-08 `source-use` and OBT-17 `notes` are version 2; all other tours are version 1. `voice.review`, `sources.result` and `notes.create` are version 2; all other steps are version 1. Dictation retains the actual same-attempt insertion and then requires explicit review acknowledgement; ordinary typing, empty transcripts and clipboard-only delivery supply no composer insertion evidence. Source use requires a new accepted user turn before its same-attempt tool result. Notes creation hands focus to the real native dialog; merely opening it never supplies `note.created`. Semantic versions prevent old progress silently becoming current evidence.

Catalogue: [apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts](../../apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts). Validation: [apps/electron/src/renderer/features/product-tour/catalogue/validate.ts](../../apps/electron/src/renderer/features/product-tour/catalogue/validate.ts).

| Tour | Slug | Version | Owner | Steps | Required capabilities |
| --- | --- | --- | --- | --- | --- |
| `OBT-01` | `first-result` | 1 | A4 | 6 | `shell.ready`, `sessions.available` |
| `OBT-02` | `workspace` | 1 | A0 | 1 | `shell.ready` |
| `OBT-03` | `models` | 1 | A7 | 2 | `sessions.available` |
| `OBT-04` | `working-directory` | 1 | A4 | 1 | `sessions.available`, `filesystem.selector` |
| `OBT-05` | `attachments` | 1 | A4 | 2 | `sessions.available`, `attachments.available` |
| `OBT-06` | `dictation` | 2 | A4 | 2 | `voice.available` |
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
| `OBT-06` | `voice.review` v2 | `composer.input` | `keep` / `bound-panel` | dictation.inserted / observed | `same-attempt` | required | no | `block` | `T-VOICE-REVIEW` |
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

The baseline lint errors were fixed rather than waived. The fresh recorded Electron lint receipt has exit 0 with **0 errors / 298 warnings**, at `c8d83576cd56f90c5b6478aff25c2702de47b707`. Existing warnings remain visible. Translations cover the actual 12 locales: ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant; native UI and catalogue display use productTour i18n keys.

## Recorded gate command receipts

These are actual records from `/workspace/product-tour-gates/*.json`, frozen into the release aggregate. Fresh feature gate: **328 feature + 8 actual native-input browser + 5 layer + 4 process tests = 345 tests, 14,888 assertions, exit 0 in 77.25s at f4c090ca**. Fresh all-workspace types: **exit 0 in 120.68s at f4c090ca**. Earlier unaffected suites and renderer build keep their executed SHAs. Final frozen App E2E: **exit 0, 13 passed / 0 failed / 0 skipped**.

| Command | Exit / observed result | Receipt source SHA | Local JSON receipt / log |
| --- | --- | --- | --- |
| `bun run test:product-tour` | 0 — 345 total: 328+8+5+4; 0 failures, 77.25s | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/feature.json), [log](/workspace/product-tour-gates/feature.log) |
| `bun run typecheck:electron` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/electron-types.json), [log](/workspace/product-tour-gates/electron-types.log) |
| `bun run typecheck:all` | 0 — 120.68s | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/all-types.json), [log](/workspace/product-tour-gates/all-types.log) |
| `bun run webui:typecheck` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/webui-types.json), [log](/workspace/product-tour-gates/webui-types.log) |
| `bun run webui:build` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/webui-build.json), [log](/workspace/product-tour-gates/webui-build.log) |
| `bun run lint:electron` | 0 — 0 errors / 298 warnings | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/lint.json), [log](/workspace/product-tour-gates/lint.log) |
| `bun run lint:i18n:parity` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/locales-parity.json), [log](/workspace/product-tour-gates/locales-parity.log) |
| `bun run lint:i18n:sorted` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/locales-sorted.json), [log](/workspace/product-tour-gates/locales-sorted.log) |
| `bun run lint:i18n:coverage` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/locales-coverage.json), [log](/workspace/product-tour-gates/locales-coverage.log) |
| `bun run rx:validate` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/rx.json), [log](/workspace/product-tour-gates/rx.log) |
| `git diff --check` | 0 | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/diff.json), [log](/workspace/product-tour-gates/diff.log) |
| `CHROMIUM_EXECUTABLE=/usr/bin/chromium bun test packages/core/src/tasks/personal/import-validation.test.ts apps/electron/src/renderer/pages/__tests__/task-import-validation.test.ts apps/electron/src/renderer/features/product-tour/adapters/work/tasks-projects apps/electron/src/renderer/pages/__tests__/connection-inspect-own-fields.test.ts apps/electron/src/renderer/pages/__tests__/connections-lifecycle.browser.test.ts apps/electron/src/renderer/pages/__tests__/connections-list.test.ts apps/electron/src/renderer/pages/__tests__/connections-page.test.ts apps/electron/src/renderer/platform/__tests__/inspector-host-connections.test.ts packages/core/src/platform/identity/credential-types.test.ts packages/core/src/platform/identity/attach-credential-ref.test.ts` | 0 — 238 passed / 0 failed / 0 skipped | `7e0f6061e86a90c3a86949d35841c31d97895371` | [JSON](/workspace/product-tour-gates/upstream-critical.json), [log](/workspace/product-tour-final-upstream-critical.log) |
| `CHROMIUM_EXECUTABLE=/usr/lib/chromium/chromium bun test apps/electron/src/renderer/platform/__tests__/knowledge-tab-titles.test.ts apps/electron/src/renderer/platform/__tests__/surface-tab-navigation.test.ts apps/electron/src/renderer/platform/__tests__/surface-tabs.browser.test.ts` | 0 — 13 passed / 0 failed / 0 skipped | `a49ef4812e456939bbe1bfe715d5a3d0c71b2856` | [JSON](/workspace/product-tour-gates/surface-tabs.json), [log](/workspace/product-tour-final-surface-tabs-binary.log) |
| `CHROMIUM_EXECUTABLE=/usr/lib/chromium/chromium bun test apps/electron/src/renderer/components/settings/__tests__/settings-menu-navigation.test.ts apps/electron/src/renderer/components/settings/__tests__/settings-menu.browser.test.ts apps/electron/src/renderer/components/app-shell/__tests__/service-panel-navigation.test.ts apps/electron/src/renderer/components/app-shell/__tests__/sidebar-guidance.test.ts` | 0 — 18 passed / 0 failed / 0 skipped | `c8d83576cd56f90c5b6478aff25c2702de47b707` | [JSON](/workspace/product-tour-gates/settings-service.json), [log](/workspace/product-tour-final-settings-service.log) |
| `bun run test:product-tour:e2e` | 0 — 13/0/0, 95.61613s; final frozen source | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/e2e.json), [log](/workspace/product-tour-a9-final-f4c090ca-e2e.log) |
| `bun scripts/electron-build-renderer.ts` | 0 / 0 — renderer 70.349773s; six fixture markers absent | `616f3af10b7db097d9816b0fe96e9bda20ed807a` | [JSON](/workspace/product-tour-gates/build.json), [log](/workspace/product-tour-a9-final-616f3af1-renderer.log) |
| `bun run test:product-tour:native` | 2 — Linux NOT_RUN; OS/manual scope remains separate | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/native.json), [log](/workspace/product-tour-gates/native.log) |
| A9 projection of actual `bun run test:product-tour:native` receipt (no duplicate execution) | 2 — Linux NOT_RUN; OS/manual scope remains separate | `f4c090ca9f09a05a38d653326f247eedc62cef46` | [JSON](/workspace/product-tour-gates/native-a9.json), [log](/workspace/product-tour-gates/native.log); earlier dd9 receipt retained externally |
| New remote CI/CodeQL, delivery merge and post-merge smoke | **PENDING root** | Final documentation head pending | [PR #1437](https://github.com/rox-one/rox-one/pull/1437) |

Local receipts are workspace evidence; they are not silently promoted to committed CI artifacts. Browser/domain CI and macOS/Windows native-smoke workflows are implemented in [.github/workflows/product-tour-native.yml](../../.github/workflows/product-tour-native.yml). Native smoke leaves the broader manual cases NOT_RUN. No remote CI success is claimed here.

The serial-rerun receipt preserves the first-run failure and retained trace; a later pass does not erase that history.

## Application and platform evidence limits

Independent acceptance: [tests/e2e/product-tour/acceptance-report.md](../../tests/e2e/product-tour/acceptance-report.md). Its final matrix has 62 unique cases: 59 required cases plus three main-delta cases, retaining partial/NOT_RUN states beyond the executed local subset. The earlier 71776c38 E2E receipt exited 1 with 10 passed / 3 failed: guided Notes, workspace scope, and ordinary-navigation pause. Failures are preserved in `/workspace/product-tour-a9-final-71776c38-e2e.log`; later source corrections do not by themselves prove a successful fresh rerun. The later 607f3ec5 full E2E command exited 0 with 13 passed, but the newly required stable-mask assertion at bf82a328 then failed after a 15-second poll with 112.4375px offset. The a0ff359a focused actual App Notes flow passes the ≤2px assertion. The complete a0ff359a E2E exited 0 with 13 passed. Latest completed App E2E receipt: exit 0 at f4c090ca9f09a05a38d653326f247eedc62cef46, 13 passed / 0 failed / 0 skipped, 95.61613s. The earlier cold-start failure and its trace remain retained.

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

Completed renderer source `616f3af10b7db097d9816b0fe96e9bda20ed807a`, tracked worktree dirty false: renderer exit **0** in **70.349773s**, comparison exit **0**. [Receipt](/workspace/product-tour-gates/build.json), [renderer log](/workspace/product-tour-a9-final-616f3af1-renderer.log), [bundle log](/workspace/product-tour-a9-final-616f3af1-bundle.log). Baseline and candidate were built separately; per-file Bun gzip level 9, source maps excluded. This delta includes synchronized upstream main changes. Subsequent f4 changes are test-only; the build receipt retains its executed 616f3af1 SHA.

| Resource | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| JS files | 386 | 389 | +3 |
| JS raw bytes | 26,537,285 | 27,175,555 | +638,270 |
| JS gzip bytes | 6,555,262 | 6,720,806 | +165,544 (+2.53%) |
| CSS raw bytes | 395,895 | 393,382 | -2,513 |
| CSS gzip bytes | 60,636 | 60,496 | -140 |

Baseline artifact SHA-256: `aca02b2ad7f8ac9ef8e54fa2c7734087d74e58d7f1a535ade54c6cfa153a956f`; candidate: `bedd614f055b051368d3e24d80183b4dfdc8d331ee7a8854821cf95667239444`. Six fixture markers scanned, **0** present. Native/manual platform acceptance is not established by this renderer build.

# Integrated PR review repairs and evidence

This integrated appendix retains the reviewed-source findings, owner resolutions and actual narrower evidence. Final delivery fields below remain root-owned.

Review source: `58081a0fc5dce6c6772a43f6f2cb41c21601b174`. The complete [Codex review comment](https://github.com/rox-one/rox-one/pull/1437#issuecomment-5970834326) contains the eleven findings below. [Review activity summary](https://github.com/rox-one/rox-one/pull/1437#issuecomment-5970665654). Final clean root source frozen for serial gates: **`f4c090ca9f09a05a38d653326f247eedc62cef46`**. Root merged incoming main `d4846751fe993f076d9fce329bdc7e1f6f342899` as `174a873eef443dcd62b8842979a2f88b21692aa5` and integrated A2/A7 owner fixes as `acd9a4cf`/`fb9984d0`. Foundation/runtime ownership fixes are integrated as `616f3af10b7db097d9816b0fe96e9bda20ed807a`. Additional test-only commits are `48810d27f7ac3772ca5c7ca0041bd77308f7719b` (bounded isolated process exits), `81d4920610210386a8930e06829e2516264fa31c` (actual fresh Welcome assertion), and `f4c090ca9f09a05a38d653326f247eedc62cef46` (strongly typed fixture interfaces). Fresh serial local gates and full App E2E at frozen f4c090ca are completed and tabulated above. New remote CI/CodeQL and main/post-merge confirmation remain **pending**.

The release inventory remains 25 tours, 56 atomic steps and 54 referenced targets. A7's integrated dictation correction changes semantic versions/completion policy, not the step count. The comprehensive inventory, key files, historical gates, default-off flag, rollout and rollback remain in [the committed release report](../../docs/product-learning/RELEASE-REPORT.md).

## Review findings and evidence

| Finding and reviewed location | Confirmed behavior | Resolution and current evidence |
| --- | --- | --- |
| Permission target duplication — `InputContainer.tsx:274` | The assertion is **not reproduced by source inspection**. The reviewed/current admin branch registers wrapper request/actions targets and renders `AdminApprovalRequest`, which has no inner target refs. Ordinary permission requests render `PermissionRequest` with its own inner refs, while the admin-only wrapper ref is absent. Measuring copies inherit a null `TourScopeContext`, disabling registrations. | **Unconfirmed/false-positive review assertion**, not a fixed duplicate bug and not stale code: `git diff 58081a0f..current -- InputContainer.tsx` is empty. A2 worker `16bc46efff3f585bd19a281bfab369c19fb0d99d` now supplies real production Chromium tests: ordinary/admin × desktop/compact each has exactly one registered, ready target per ID, and explicit native Deny/Cancel remains user-driven. Integrated root `acd9a4cf`; final aggregate receipts remain root-owned. [Current InputContainer](../../apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx#L274), [ordinary inner request](../../apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest.tsx#L32). |
| Reset without lease — `persistence/progress.ts:189–192` | Confirmed at reviewed source: reset deleted scoped progress/attempts without validating ownership. | **Fixed in root `616f3af1`.** `resetScope` rejects a missing guard; checks profile scope, persisted owner/fence and current/local expiry; then deletes only that scoped progress/attempt partition in the same transaction containing `leases`. Lease-loss stays an explicit refusal; fallback must verify live ownership before clearing memory. Provider reset reacquires serialized ownership and tracks the write before release. [Current reset](../../apps/electron/src/renderer/features/product-tour/persistence/progress.ts#L192). |
| Incomplete workflow paths — `.github/workflows/product-tour-native.yml:7–10` | Original paths omitted several renderer integration callsites. | **Committed root fix `03b5a23b`** broadens both pull-request and main-push filters to `apps/electron/src/renderer/**`, covering Notes, Tasks, Search, Memory, Pages and Automations integrations. This establishes path coverage, not a successful future workflow run. [Workflow](../../.github/workflows/product-tour-native.yml#L7). |
| Hard-coded task delegation errors — `adapters/work/tasks-projects/native-commit.ts:13` | Native reconciliation failures were displayed as raw English error messages in localized UI. | **Committed worker `7ca…`, integrated root `561760f8`.** The native helper now emits stable `PersonalTaskLinkError` codes; Tasks UI maps to translation keys and applies `t()` when presenting `delegateError`. Receipt/readback/ACL behavior remains explicit. Root/owner final command receipts are not supplied here. [Native codes](../../apps/electron/src/renderer/features/product-tour/adapters/work/tasks-projects/native-commit.ts#L5), [localized UI](../../apps/electron/src/renderer/pages/TasksPage.tsx#L289). |
| Paused/blocked dismissal loses persistence — `ProductTourProvider.tsx:430` | Confirmed at reviewed source: pausing released ownership and direct DISMISS lost its STORE effect. | **Fixed in root `616f3af1`.** `dismiss()` reacquires ownership if needed, validates lifetime/launch sequence/profile/workspace/panel/run identity, then queues fenced dismissal before cleanup/release. Current-scope progress updates from the repository receipt; foreign/lost ownership is reported. [Current dismiss](../../apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx#L434). |
| Dictation evidence lost before review — `catalogue/product-tour-catalogue.ts:598–603` | `VoiceDictationControl` emits `dictation.inserted` after native transcription insertion while `voice.start` may still be active. `voice.review` previously required after-activation evidence, so the one real transcription was discarded before review. | **Confirmed; A7 worker `427ab08a75d34f12a7fd478267e0c8853ca3b8fe` independently reviewed and validated. Integrated root `fb9984d0`; fresh frozen-source local aggregate checks are completed above; native/manual scope remains separate.** Candidate changes OBT-06 and `voice.review` to version 2, admits the captured dictation as `same-attempt` evidence and requires explicit acknowledgement after evidence. Denied permission, empty transcription and ordinary typing do not count. [Voice insertion](../../apps/electron/src/renderer/components/app-shell/input/VoiceDictationControl.tsx#L129), [catalogue](../../apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts#L598). |
| Source visibility evidence lost between adjacent steps — `catalogue/product-tour-catalogue.ts:689–694` | `SourceInfoPage` emits one `source.details-visible` mount observation. It completes `sources.status`; the reducer previously excluded the future `allow-current-state` explanation and the mounted page does not re-emit only because the tour step changed. | **Confirmed; A7 worker `427ab08a75d34f12a7fd478267e0c8853ca3b8fe` independently reviewed and validated. Integrated root `fb9984d0`; fresh frozen-source local aggregate checks are completed above; native/manual scope remains separate.** Candidate preserves fresh, same-binding **observed UI-origin** evidence for future `allow-current-state` explanation steps, while keeping acknowledgement separate. It leaves native/verified future completion on existing same-attempt operation continuity. [Native detail view observation](../../apps/electron/src/renderer/pages/SourceInfoPage.tsx#L330), [reducer](../../apps/electron/src/renderer/features/product-tour/core/index.ts#L178). |
| Model picker advances before layer commit — `CompactModelSelector.tsx:186` | Opening emits `model-picker.opened` synchronously before React commits the drawer layer, allowing immediate progression before the native picker closes. Desktop picker has the same ordering. | **Confirmed; A2 worker `16bc46efff3f585bd19a281bfab369c19fb0d99d` supplies the fix.** Original desktop/compact model handlers produced two red tests with native layer count 0. Final production component/core browser checks pass 8/0 (36 assertions), with 61 related unit cases and Electron typecheck/diff exit 0. Integrated root `acd9a4cf`; final aggregate receipts remain separate. [Compact handler](../../apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx#L186), [desktop handler](../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx#L2470). |
| Selected meeting stripped from binding — `ProductTourProvider.tsx:345` | Confirmed at reviewed source: OBT-22 lost the selected meeting ID required by native artifact observation. | **Fixed in root `616f3af1`.** Starting OBT-22 in the meetings navigator preserves its selected entity and uses a consistent prerequisite route. Production provider regression proves selected existing artifact evidence is accepted as observed, without promoting it to verified. [Current binding](../../apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx#L367). |
| Error boundary persists across attempts — `ProductTourProvider.tsx:424` | Confirmed at reviewed source: an unkeyed failed boundary suppressed later attempts. | **Fixed in root `616f3af1`.** The boundary is keyed by enabled state/current run token. Provider regression contains a rendering failure, then renders a fresh attempt. [Current provider](../../apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx). |
| Freshness responsive classes removed — `PageView.tsx:299` | Confirmed by source comparison: main had `hidden @[28rem]/panel:inline-flex`; the target wrapper used unconditional `inline-flex`. A6's browser receipt establishes changed visibility, rather than claiming a measured overflow. | **Worker `60fe646bf566934e273c8a3884634e153cb3f2f4`, integrated root `d43152d2`.** Only the existing registered wrapper's responsive classes change; target ref, workspace/entity scope, native digest/lease checks and host-only observation remain intact. Meaningful browser and existing tests are detailed below. [Page wrapper](../../apps/electron/src/renderer/components/pages/PageView.tsx#L299). |

## Independent voice/source review

A6 read the real `VoiceDictationControl` insertion and `SourceInfoPage` mount-effect callsites, catalogue policies, provider capture logic and reducer candidate/advance logic. Both reported lost-evidence sequences are present in the inspected root source. No blocker was found in A7's inspected candidate continuity/fencing change:

- Full binding identity, attempt/run token, finite timestamp, event replay and defensive evidence-level/origin checks remain in place.
- Future current-state retention is limited to policy evidence `observed`, signal level `observed`, and origin `ui-observation`. It cannot promote UI observations to verified native evidence or stamp an unrelated native operation token.
- Voice completion retains its captured operation token under `same-attempt`, so the same transcription can be reviewed after the first acknowledgement. Review acknowledgement follows evidence; denied/empty transcription supplies no completion.
- A7's reducer regression checks old timestamps, old operation start, foreign panel, old run token, rejected future verified native evidence, lack of implicit acknowledgement, and preservation of the original native operation token. Owner reports **170 focused tests, exit 0**, plus **four Chromium cases, exit 0**, mounting actual production SourceInfoPage/VoiceDictationControl: insertion before/after start acknowledgement, empty transcript no evidence, and one source load followed by explicit details acknowledgement. Media/IPC responses are controlled; this does not establish OS microphone or network ASR acceptance. Incoming clipboard/trailing-space behavior is covered by owner followup `2545cfa71a18f0a50e90590831491073291b7451`, integrated as root `32862a6d355cf40fcad6627679ff8cfe683c3886`: **7 Chromium cases / 0 failures**, exit 0. Clipboard delivery with/without trailing space copies through the native API but supplies no composer insertion/review completion; draft trailing-space insertion emits once and still needs review acknowledgement. [Owner log](/tmp/a7-native-continuity-clipboard.log). The semantic owner feature suite also completed **313+5 tests / 0 failures**, exit 0 at worker `427ab08a`; [owner feature log](/tmp/a7-continuity-feature-427ab.log). Final frozen-source aggregate receipts remain pending.

## A6 Page validation

Only [PageView.tsx](/workspace/rox-workers/A6-page/apps/electron/src/renderer/components/pages/PageView.tsx:299) changed in the isolated worker based on `79b27639d403cc5ebfe9d31953458d2aa030ea78`. No mirror unit test was added for a one-line reversible CSS restoration.

| Command/check | Actual result | Evidence |
| --- | --- | --- |
| `bun /workspace/a6-page-responsive-probe.tsx before`, against the original wrapper | Exit **1**, expected responsive assertion failed: freshness stayed visible/measurable in narrow panels | [Before receipt](/workspace/product-tour-a6-page-before.json) |
| `bun /workspace/a6-page-responsive-probe.tsx after`, against the fixed wrapper | Exit **0**; hidden and production geometry null at 320/419px, visible/measurable at 420/448/560px. Loaded production CSS root font makes the existing 28rem breakpoint **420px** | [After receipt](/workspace/product-tour-a6-page-after.json), [probe source](/workspace/a6-page-responsive-probe.tsx) |
| `bun test apps/electron/src/renderer/features/product-tour/adapters/knowledge apps/electron/src/renderer/features/product-tour/ui/__tests__/target-registry.test.ts apps/electron/src/renderer/features/product-tour/ui/__tests__/geometry-observer.test.ts` | Exit **0**, 25 passed / 0 failed, 80 assertions | [Test log](/workspace/product-tour-a6-page-tests.log) |
| `bun x eslint src/renderer/components/pages/PageView.tsx` from `apps/electron` | Exit **0** | [Lint log](/workspace/product-tour-a6-page-lint.log) |
| `git diff --check` | Exit **0** | Observed before worker commit |

The isolated Chromium probe renders production PageView via React SSR, uses the built production renderer stylesheet plus the real Tailwind compiler's restored responsive utility, and executes production `measureTargetGeometry`. Shell/header dependencies are isolated; it does not claim full App, native page storage, iframe content or live Page acceptance. The sampled English label did not overflow before or after; the demonstrated regression is responsive visibility and the resulting target eligibility.

## Additional CI/review corrections

[CodeQL comment 1040](https://github.com/rox-one/rox-one/pull/1437#discussion_r4173791339) and [1041](https://github.com/rox-one/rox-one/pull/1437#discussion_r4173791345) flagged mutable `oven-sh/setup-bun@v2` refs at reviewed workflow lines 58/109. Root commit `f1ac776a` pins both invocations to the verified `0c5077e51419868618aeaa5fe8019c62421857d6` action commit. A new CodeQL result must verify the resulting head; the source fix alone is not represented as remote resolution.

[Unused hook import in CompactPermissionModeSelector](https://github.com/rox-one/rox-one/pull/1437#discussion_r4173824196) and [PermissionRequest](https://github.com/rox-one/rox-one/pull/1437#discussion_r4173824202) are separate from the duplicate-target assertion. A2 includes those cleanup changes in worker `16bc46efff3f585bd19a281bfab369c19fb0d99d`; [component receipt log](/workspace/product-tour-a2-native-input-committed.log). Integrated root `acd9a4cf`; final aggregate confirmation remains separate.

The earlier dd9faa70 remote browser job had **303 passing feature tests and one failure**: the panel-changing child exceeded its 45-second deadline. This is retained as an actual CI failure, even though the same production head had local feature 304+5 and App E2E 13/0/0 receipts. Root integrated A11 fixture correction `79b27639`, awaiting actual transcript requests before scope changes rather than racing fixture setup. Root also integrated native Playwright supervision changes `41b8597b` and release-gate supervision tests `ffac7e50`; final remote job receipts remain delivery-owner evidence. No remote all-PASS status is asserted here.

At the earlier owner report, Windows built the real desktop successfully and its fresh native smoke was in progress; macOS/validate were queued. That historical snapshot is not substituted for current job status. Raw/connector logs and job receipt ownership remain with A9/root. Vercel's external account-blocked status was already present on synchronized main fd6; its [baseline receipt](/workspace/product-tour-ci/baseline-vercel.json) remains separate from introduced Product/standard CI checks.

## Delivery owner completion

Append the final integrated source and exact fresh affected checks, actual Product-native and standard CI receipts, any unresolved check with its reason, PR merge receipt, final main SHA and post-merge smoke. Native OS/menu/microphone manual cases and broader live first-response cases remain **NOT_RUN/PARTIAL** unless separate actual evidence is supplied. Code/source fixes, unit/component browser checks and fresh-setup OS smoke have different scopes; none substitutes for the others.

## Latest incoming main Notes compatibility check

Root delegated only `apps/electron/src/renderer/pages/NotesPage.tsx` during its merge of incoming main `d4846751` into `ffac7e50`. A6 resolved the sole Notes conflict, which was import-only, retaining both the learning imports and new `NotesRailTools`/`NotesResponsiveRail`/`useNotesPanelWidth` import. Root completed the merge as `174a873eef443dcd62b8842979a2f88b21692aa5`; no A6 stage/commit command was used in root.

Incoming measured document-row layout, rail tools, retained hidden-panel width, responsive sheets, scoped return-focus guards and comment drafts remain intact. Existing learning creation/editor target refs, captured save/create observations, native receipt matching, core-only Notes read-unavailability with explicit assets accessory state, and A→B→A read fencing remain present. Read-only compatibility inspection confirms the new sheet uses the existing `Dialog` wrapper and `useTourNativeLayer`, so modal layer blocking/Escape/focus behavior remains shared with the learning runtime.

Actual affected checks:

- Notes read/comment-draft/controller/write-authority/knowledge/responsive unit suites: exit **0**, **45 passed / 0 failed**, 160 assertions; [log](/workspace/product-tour-a6-notes-mainmerge-tests.log).
- Genuine isolated native authority/journal/preload runtime suite: exit **0**, **16 passed / 0 failed**, 148 assertions; [log](/workspace/product-tour-a6-notes-mainmerge-native.log).
- NotesPage targeted ESLint: exit **0**, 0 errors / 16 existing warnings; [log](/workspace/product-tour-a6-notes-mainmerge-lint.log). File `git diff --check` exit **0**.
- Original incoming responsive Chromium suite: exit **1**, **5 passed / 1 failed**; immediate state-driven unmount assertion saw 6 listeners while expecting baseline 1 before React committed unmount; [original log](/workspace/product-tour-a6-notes-mainmerge-browser.log).
- External copy of that same suite, waiting for actual sash DOM unmount and listener-baseline restoration before equality: exit **0**, **6 passed / 0 failed**, 20 assertions; [settled log](/workspace/product-tour-a6-notes-mainmerge-browser-settled.log), [external check](/workspace/a6-notes-responsive-check.test.ts). This establishes cleanup after commit and identifies the original test timing race. A6 did not edit the upstream test or production workspace chrome. Root subsequently committed the same DOM-unmount/listener waits in `5521fff6`, retaining the original failure history.

These are affected-file/component/native runtime receipts from the incoming merge worktree, not final main merge, fresh full App E2E or OS/native CI receipts.

### Fresh integrated Notes receipt and latest main delta

The incoming main synchronization adds **21 commits and changes 60 files** from `fd6e2f2cebafeb5bbf464aef45604ce4e7fcaca1` to `d4846751fe993f076d9fce329bdc7e1f6f342899`; measured with `git rev-list --count fd6e2f2c..d4846751` and `git diff --name-only fd6e2f2c..d4846751`. Root merge `174a873e` retains incoming voice history/clipboard delivery and the responsive Notes workspace tools.

Current source `5521fff6dceaee33bfa77c57ff8080049bf82d76` preserves incoming voice `trailingSpace` delivery text. Clipboard delivery executes the native `copyVoiceText` branch and emits **no** `dictation.inserted`; only the draft insertion branch calls `onInputChange` and then emits that signal. This is a read-only source check at [VoiceDictationControl.tsx:120](../../apps/electron/src/renderer/components/app-shell/input/VoiceDictationControl.tsx#L120). A7 supplied the genuine component clipboard/no-insertion followup in worker `2545cfa7`, integrated root `32862a6d`: 7 passed / 0 failed, exit 0, [log](/tmp/a7-native-continuity-clipboard.log). This is controlled native-API/media component evidence, not OS clipboard/microphone or live ASR acceptance.

Fresh existing production Notes responsive browser suite at exact source `5521fff6dceaee33bfa77c57ff8080049bf82d76`:

| Command | Actual result | Receipt |
| --- | --- | --- |
| `ROX_BROWSER_PATH=/usr/lib/chromium/chromium bun test apps/electron/src/renderer/pages/notes/__tests__/notes-responsive-tools.browser.test.ts` | Exit **0**, **6 passed / 0 failed**, 20 assertions, 3.21s | [Exact-source log](/workspace/product-tour-a6-notes-5521fff6-browser.log) |

The six cases execute the actual Notes rail controls/sheets/sash in Chromium: narrow sheet edit/Escape/focus return with document draft retained, hidden/inert/workspace/note owner revocation, and keyboard/pointer/cancel/unmount cleanup. Existing `Dialog` modal layer behavior remains active. `5521fff6` waits for the real unmount and listener cleanup before checking equality; it does not change production cleanup behavior or increase a timeout budget. The initial 5/1 result is an incoming test assertion timing history in the feature merge worktree. It is **not** evidence that a separately executed pre-feature baseline production run failed.

This fresh six-case result is completed local component evidence. Final full App/native OS/standard CI/main/post-merge results remain with root/A9 and are not inferred from it.

## Final frozen-source review and gate status

All eleven review findings now have a concrete resolution: ten confirmed bugs have integrated fixes; the permission-duplicate assertion is disproved by actual mutually exclusive production render branches and A2 registry tests, rather than described as a repaired duplicate bug. The two unused import comments are also cleaned up. Workflow filter coverage and both immutable Bun action pins are integrated; CodeQL alerts 1040/1041 still need a fresh scan to establish remote resolution.

A6 independently read the integrated foundation runtime/reset code at `616f3af1` and final `f4c090ca` without starting another test/build process while root runs serial gates. No blocking issue was found. The deletion ownership check and deletion share a durable transaction; reset/dismiss acquisitions serialize behind prior write/release barriers; lifetime and launch sequence reject old continuations; profile/workspace/panel checks prevent another scope's UI update; dismissal also retains the exact run token. Reset write completion is tracked before ownership release, and stale-scope completion cannot clear the new scope. Provider error boundary and selected meeting preservation are integrated.

Existing owner foundation receipt: **25 passed / 0 failed**, 67 assertions, exit 0 across progress and actual provider browser tests; [log](/workspace/foundation-owned-green-final.log). Coverage includes no-guard/foreign-owner reset refusal, persisted fence/expiry refusal, memory-only reset, cross-scope partition preservation, paused/blocked dismissal persistence after fresh repository read, foreign/lost dismissal ownership, reset cancellation on workspace change, a fresh boundary after failure and selected meeting observation. This receipt has its owner scope; it does not replace root's final frozen-source gates.

### Introduced fixture typing failure retained and repaired

The `616f3af1` **`bun run typecheck:all` exited 2** in 113.22s with three introduced fixture typing errors. These are not presented as baseline errors: a spread signal lost its discriminated origin type, the closed source-page fixture cast an incomplete shell object to AppShellContextType, and source navigation omitted required `details`. [Historical command JSON](/workspace/product-tour-ci/types-616f3af1-introduced-fixture-errors/all-types.json), [preserved historical error log](/workspace/product-tour-ci/types-616f3af1-introduced-fixture-errors/all-types.log).

The owner repair was integrated as final `f4c090ca`: the signal uses `satisfies TourSignal`, keeping literal native-origin discrimination; the shell object is strongly typed and supplies all required callbacks via a function that throws on any unexpected shell action; the workspace supplies required metadata; source navigation supplies typed details. A6 read those exact changes and found no weakening of native/media fixture boundaries or completion evidence. Owner Electron typecheck exited **0**, and continuity unit/component browser tests completed **11 passed / 0 failed**, 49 assertions, exit 0; [type log](/tmp/a7-fixture-electron-types.log), [11-case log](/tmp/a7-fixture-continuity-tests.log). The owner checks retain their narrower scope. Fresh root all-workspace typecheck at f4c090ca now also completed successfully, exit 0 in 120.68s, as tabulated above.

### Actual renderer/bundle receipt at 616f3af1

The production renderer build at exact `616f3af10b7db097d9816b0fe96e9bda20ed807a` exited **0** in **70.349773s**; bundle comparison exited **0**, with six fixture markers scanned and **zero present**. [Build JSON](/workspace/product-tour-gates/build.json), [renderer log](/workspace/product-tour-a9-final-616f3af1-renderer.log), [bundle log](/workspace/product-tour-a9-final-616f3af1-bundle.log). Candidate artifact SHA-256: `bedd614f055b051368d3e24d80183b4dfdc8d331ee7a8854821cf95667239444`.

| Artifact | Actual candidate | Delta versus separately built c9b73303 baseline |
| --- | --- | --- |
| JS raw bytes | 27,175,555 | +638,270 |
| JS gzip bytes | 6,720,806 | +165,544 (**2.53%**) |
| CSS raw bytes | 393,382 | −2,513 |
| CSS gzip bytes | 60,496 | −140 |

The comparison uses the actual separately built baseline `c9b7330357fb55a5e88a223783029d2768849828`, per-file Bun gzip level 9, source maps excluded. It includes all synchronized upstream main changes. The executed build source remains `616f3af1`; the later frozen `f4c090ca` changes are explicitly test-only and do not cause this earlier build receipt to acquire a different source SHA.

Fresh f4 feature/all-workspace type and other completed receipts are tabulated above. Final App E2E is complete locally. New remote Product/native/standard CI/CodeQL, PR merge, final main SHA and post-merge smoke remain pending delivery-owner receipts. Existing Linux native runner refusal and manual OS/menu/microphone/live-first-response restrictions remain NOT_RUN/PARTIAL unless actual new evidence is supplied.

## Rollout and rollback

1. Keep Learning default off. The central logical key is `feature-product-tour-v1`; actual current localStorage key is `craft-feature-product-tour-v1` because the utility preserves its legacy prefix. Operators enable Learning explicitly through Settings → Learning. Do not rename the key or force a series on upgrade.
2. Keep invitations and diagnostics off until the user opts in. Use an isolated profile to validate the retained manual/platform gates. Enabling Learning presents guidance; it does not create objects, send prompts, select execution permissions, start a microphone, or run an automation.
3. Disable Learning for immediate presentation rollback. The provider pauses/hides the attempt, cancels Learning timers and observers/listeners, and releases its window lease. Native agents, active work, approvals, Notes, Memory and other user data retain their existing lifecycle.
4. If code rollback is needed, revert the relevant Learning commits with current-main reconciliation and repeat impacted gates. Preserve independently merged native recovery fixes, OMP runtime integration, user-selected model and permission behavior, and the existing allow-all default. No Learning rollback resets setup, native grants, user documents, conversations, Memory, or Quest achievements.
5. Preserve local progress/schema on disable or code rollback. Scoped reset is a separate user-confirmed action for current profile/workspace Learning only. Disabling diagnostics clears its local journal. Neither operation changes native domain authority.
6. Resume creates a fresh run token and checks live prerequisites, target context, capabilities, and lease. Replay separates historical progress from current attempt evidence. Neither operation automatically resumes a native task or grants permission.

## Delivery fields still to close

- Published [PR #1437](https://github.com/rox-one/rox-one/pull/1437); frozen code source `f4c090ca9f09a05a38d653326f247eedc62cef46`, latest synchronized main `d4846751fe993f076d9fce329bdc7e1f6f342899`. Documentation publication will create a new PR head. New remote CI/CodeQL/check URLs, merged-main confirmation and post-merge smoke remain **PENDING root**.
- Local feature gate 345 tests, all-workspace types and other completed frozen-source receipts retain their exact JSON evidence. Final App E2E is complete at the frozen source. Renderer/comparison **0/0** is recorded at executed production SHA `616f3af1`, 70.349773s.
- The earlier dd9 remote browser failure (303 pass/1 timeout), mutable Bun action alerts 1040/1041, and newly introduced 616 fixture typing failure are retained with concrete fixes; new remote checks have not yet proved resolution. Existing Vercel account-blocked failure was present on fd6 main, [baseline receipt](/workspace/product-tour-ci/baseline-vercel.json); it is separate from introduced Product/native/standard checks.
- Full live first-result and broader application acceptance remain **NOT_RUN/PARTIAL**. macOS/Windows/menu/dialog/microphone manual cases remain **NOT_RUN**. Linux native canonical command exits **2** at frozen f4; no OS test pass is inferred.
- Root owns final publication/main confirmation; A9 owns the independent acceptance matrix and evidence. Historical pre-publication c8 validation archive: `/workspace/product-tour-ci/validation-pre-publication-c8d83576.json`.
