# [SURFACE-RECONCILIATION] Accumulated UI progress and missing surface coverage

Reviewed on 2026-10-03 against canonical ROX source. This document supplements [the original surface backlog](02-surface-backlog.md); its machine-readable counterpart is [surface-review.json](reconciliation/surface-review.json). The JSON enumerates all **228 original UI tasks/subtasks**, preserves their full acceptance, and records bounded source/evidence progress. No original full task DoD is declared complete by this reconciliation.

## [SURFACE-SOURCE] Source and evidence boundaries

| Source | Observed contribution | Evidence boundary |
|---|---|---|
| [PR1322](https://github.com/rox-one/rox-one/pull/1322), cloud `de805e0` | Assembled UI + September + scoped Compound; Search, shared Projects, repository snapshots, stable Note blocks and mini window | Published Chromium 99 assertions at frozen `010fa8c`; 22 route mounts and 22 settings mounts are smoke coverage; Pages persistence is a bounded executed workflow |
| [PR1293](https://github.com/rox-one/rox-one/pull/1293), September `8f43e92` | Newest Projects/Focus/native Notes/source recovery and Roadmap/OKR | Source-bound published tests plus a real macOS Note create/edit/reload/normal-restart at earlier `db8413`; full product acceptance remains pending |
| Compound `d141e96` | Scoped native/domain features plus later LicenseEvidencePanel | Latest license panel is not automatically included in cloud's earlier Compound input; no full license product acceptance assumed |
| [PR1314](https://github.com/rox-one/rox-one/pull/1314), UTB `8619f90` | UTB01 inert type/reference codec and v2 specification covering 23 hosts | Historical 54 codec tests do not implement a grid, formulas, CRM providers or23-host product flows |
| [PR1321](https://github.com/rox-one/rox-one/pull/1321), sidebar `2c7a1fb` | Styling and persisted left navigation repair | Bounded earlier native macOS verification; recheck after combining source lines |
| [PR1323](https://github.com/rox-one/rox-one/pull/1323), Projects `3cc2483` | Scoped hook fence subsequently published in September `1c67730` | Mounted ReactDOM/synthetic IPC proves lifecycle contract, not real native workspace/RPC/storage |

**Integration constraint:** current September is not a superset of cloud: its tree lacks SearchPage, SharedProjectProjection, RepositorySnapshotPanel and cloud's richer stable-block/property-dictionary Notes changes. Port newer fixes into a feature-preserving assembled candidate; selecting the latest timestamp alone loses features. Dirty worktrees remain observed WIP, preserved unchanged. Their root path/status inventory are not pinned remote source or passing runtime acceptance.

Evidence packets read: [Published executed Chromium workflow, not independently rerun here](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/docs/cloud-all-surfaces-direct-010-evidence-20261001/browser-execution.json#L1-L17); [Published producer/independent hook and mounted ReactDOM lifecycle checks](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/docs/september-program/projects-generation-20261002.json#L1-L100); [Published hook and mounted ReactDOM synthetic adapter/browser storage checks](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/docs/september-program/focus-notification-scope-20261002.json#L1-L100); [Published actual macOS production Electron visible workflow plus independent storage metadata](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/docs/september-program/native-product-acceptance-20261002.json#L1-L120); [Type/reference codec implementation with historical isolated54-test evidence; v2 product plans](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40). Published results are credited with their stated source/platform/fixture limits; they were not rerun as part of this document-only pass.

## [SURFACE-PROGRESS] Every original surface task reconciled

Children inherit this progress assessment unless a narrower override is recorded. Full requirements/DoD/workflows remain individually preserved in JSON and original Markdown.

| Original task | Progress observed beyond main | Remaining release work |
|---|---|---|
| [UI-001](02-surface-backlog.md#ui-001-workbench-shell-routes-and-window-layouts) Workbench shell, routes and window layouts | Shell/sidebar, panel focus and route mounting changed in the assembled cloud source; PR1321 also supplies a separately published sidebar/styling repair with bounded macOS UI evidence. | Unify the sidebar fix and assembled shell without erasing Compound routes; retain direct-link, geometry, keyboard, zoom and native-view acceptance. |
| [UI-002](02-surface-backlog.md#ui-002-onboarding-provider-setup-and-reauthentication) Onboarding, provider setup and reauthentication | Welcome defaults, onboarding username and transient-startup handling have branch implementation and regression files; authenticated WebUI bootstrap is added in cloud. | Run fresh installed-user onboarding and actual OAuth/provider first response on A/B/C; browser auth-negative evidence is not provider onboarding completion. |
| [UI-003](02-surface-backlog.md#ui-003-home-dashboard-and-every-registered-widget) Home dashboard and every registered widget | Home layout/data/widget source changed and QuickTaskInput was introduced. The assembled browser packet observes Home mounting; the 20-widget behavioral checklist remains separate. | Verify each UI003.3–UI003.22 widget against authoritative data/action results; exercise reordered layouts, task quick input, stale workspace and unavailable providers. |
| [UI-004](02-surface-backlog.md#ui-004-session-lists-collections-kanban-and-batch-actions) Session lists, collections, Kanban and batch actions | Shell/list presentation changed; no evidence packet closes collection/Kanban/batch lifecycle as a product. | Run collection creation/edit/delete, batch partial failure, virtualized selection, drag keyboard equivalents and durable Kanban changes on A/B/C. |
| [UI-005](02-surface-backlog.md#ui-005-chat-transcript-composer-and-rich-session-views) Chat transcript, composer and rich session views | ChatDisplay, caller-session loading and transcript handling changed; retained Markdown editor/list compatibility changes also affect chat-linked content. | Recheck streaming/reconnect/cancellation, drafts, uploads, rich tools and every transcript renderer after assembly; provider-backed send and authoritative history remain gates. |
| [UI-006](02-surface-backlog.md#ui-006-branching-rewriting-side-threads-and-session-workbench) Branching, rewriting, side threads and session workbench | Panel stack spatial focus and transition changes exist; no full branching/workbench acceptance is published by this reconciliation. | Retain branch/fork/merge and side-thread lifecycle, multiple-window scope, graph navigation and engine-backed history verification. |
| [UI-007](02-surface-backlog.md#ui-007-permission-credential-admin-approval-and-source-authentication-dialogs) Permission, credential, admin approval and source authentication dialogs | PermissionRequest typing/labels changed; scoped capability reads and backend identity controls add boundary implementation but do not establish every approval workflow. | Exercise approval/deny, credential rejection, stale/forged actor, admin-only source actions, restart and access revocation with canonical receipts. |
| [UI-008](02-surface-backlog.md#ui-008-personal-tasks-scheduling-lists-and-task-detail) Personal tasks, scheduling, lists and task detail | Personal-task sync has authoritative confirmed-store/outbox changes, task conflict UX and source-ID routing in cloud/September. The native Notes packet explicitly records unavailable task storage and rejects an unscoped legacy caller. | Do not recreate the implemented sync layer; finish enrolled task authority and native task create/edit/restart plus Task→Note accepted workflow. Local cache success is not canonical task acceptance. |
| [UI-009](02-surface-backlog.md#ui-009-task-delegation-and-agent-task-projections) Task delegation and agent task projections | Delegation-related task and agent projection code is retained and OMP runtime recovery exists elsewhere in September; no native delegated-task completion gate is closed here. | Verify provider execution, pending/accepted/completed reconciliation, retry/cancel, session linkage and idempotent task mutation under workspace switch. |
| [UI-010](02-surface-backlog.md#ui-010-notes-documents-folders-assets-and-markdown-editor) Notes documents, folders, assets and Markdown editor | Native Notes capability/write-authority/sync integration exists in cloud and newer September. Published actual macOS production Electron evidence proves one create/edit/reload/normal-restart Note and canonical/journal/ACK metadata at db8413. | Credit that precise macOS workflow; recheck after feature-preserving integration, migration, file/assets, concurrency, offline/crash, Windows and hosted actor isolation. Receipt decrypt/OS custody and complete Notes task acceptance remain open. |
| [UI-011](02-surface-backlog.md#ui-011-notes-basetable-json-canvas-outline-graph-and-mind-map) Notes Base/Table, JSON Canvas, Outline, Graph and mind map | Cloud adds table cell editing/properties, committed stable-block Outline and richer Notes host behavior; UTB01 contributes only an inert reference codec. Source inspection finds the cloud property-remove button has no handler and Folder header has no body cell. | Fix those concrete table defects; retain view/CAS/large-data/restart requirements. Do not treat UTB v2 grid/formula/23-host plans as implemented by the codec or existing Notes table. |
| [UI-012](02-surface-backlog.md#ui-012-note-ai-comments-wiki-links-and-vault-insights) Note AI, comments, wiki links and vault insights | Notes retained-source/stable-block/property dictionary work in cloud expands the context used by AI/wiki; newer September separately adds native Note authority and outbox recovery. | Preserve both branches' contracts; check all AI suggestions/comments/wiki backlinks/insights with real readback, explicit provider status and denied/stale revisions. |
| [UI-013](02-surface-backlog.md#ui-013-unified-inbox-review-actions-and-attention-state) Unified Inbox, review actions and attention state | Cloud implements inbox search, signal/noise/unread filters, filtered counts, row selection, partial-failure bulk mark-read/archive and recipient-request UX using trusted roster identity. | Verify retry and no duplicated provider actions; team recipient decisions remain queued until actual server ACK and cannot be inferred from local dispatch. |
| [UI-014](02-surface-backlog.md#ui-014-inbox-mail-accounts-folders-message-rendering-and-composition) Inbox mail accounts, folders, message rendering and composition | Mail views/hooks changed, including narrower folder/filter behavior and bulk operations invoked by Inbox. | Run authorized real-provider compose/send/flags/move/archive/attachments, thread/search pagination, reconnect, partial failure and confirmed state after restart. |
| [UI-015](02-surface-backlog.md#ui-015-feed-agents-automation-activity-news-subscriptions-and-source-editor) Feed agents, automation activity, news, subscriptions and source editor | Feed gains workspace-scoped persisted preferences, request-generation fences, source ownership and counts derived from visible filtered items. | Recheck source change, A→B→A workspace switch, delayed request success/failure and persisted filters; real external aggregation/rate-limit behavior remains unverified. |
| [UI-016](02-surface-backlog.md#ui-016-local-meetings-recording-imports-asr-and-follow-up-outputs) Local Meetings recording, imports, ASR and follow-up outputs | Meetings capture/import RPC flows add import request identity/cancel and recording-save failure handling; microphone and on-device Whisper source exists. Comments explicitly exclude live rooms and system-audio capture. | Complete on-device engine/assets, permission/device changes, imported files, cancel/save failure, restart and AI analysis. Native capture must be tested separately from browser mount or helper fixtures. |
| [UI-017](02-surface-backlog.md#ui-017-meeting-workspace-agent-readiness-and-proposal-inbox) Meeting workspace, agent readiness and proposal inbox | No reviewed branch packet establishes the secondary meetings workspace/proposal route as a released catalog surface. | Resolve route/product scope; retain proposal diff/application and event provenance acceptance, then mount the actual released route and test with owner data. |
| [UI-018](02-surface-backlog.md#ui-018-memory-manager-injection-meter-and-lesson-provenance) Memory manager, injection meter and lesson provenance | Memory source adds archived lessons/restore, preserves disabled merge-source rows and merge-history restoration instead of deleting sources. | Verify multi-step restore atomicity/recovery and workspace/global isolation. Failure-to-empty UI, late workspace loads and real persistence require product checks. |
| [UI-019](02-surface-backlog.md#ui-019-automation-editor-graph-schedules-and-execution-history) Automation editor, graph, schedules and execution history | Automation editor now edits webhook URL/method/body/headers/auth, retains secrets, validates JSON and timezone-aware schedules, and sends expectedRevision. | Webhook edit is implemented; validate real delivery/secret storage, stale-save rejection, retry/idempotency, scheduler restart and DST. Keep server-side SSRF/security and provider response gates. |
| [UI-020](02-surface-backlog.md#ui-020-projects-home-creation-detail-assets-and-settings) Projects home, creation, detail, assets and settings | Cloud adds shared-project catalog/authority surfaces while current September has a separate Roadmap page and OKR tab. useProjects committed-scope lease and newest-request fencing has source plus mounted ReactDOM synthetic-IPC evidence. | Preserve local and shared variants while porting newest hook; verify actual native workspace-switch/RPC/storage and shared-authority actors. Add dedicated UI069–UI072 feature coverage. |
| [UI-021](02-surface-backlog.md#ui-021-sources-catalog-mcp-tools-permissions-and-source-detail) Sources catalog, MCP tools, permissions and source detail | Source list/authority acquisition changed via use-rox-sources and Connections/catalog integration; Sources browser mounting is evidenced at older assembled candidate. | Verify each MCP/API/local-file source provider, OAuth reconnect, exact caller scope, stale/revoked access, import and canonical status. Mounting alone does not close source actions. |
| [UI-022](02-surface-backlog.md#ui-022-skills-catalog-omp-imports-editing-and-invocation) Skills catalog, OMP imports, editing and invocation | Skills remain represented in shell/catalog and inbox proposal integration; no per-skill execution product evidence closes the task. | Retain install/import/edit/update/remove, permission prompts, execution and model-specific behavior; test signed/denied/invalid inputs with canonical results. |
| [UI-023](02-surface-backlog.md#ui-023-connections-hub-imports-credentials-grants-and-audit) Connections hub, imports, credentials, grants and audit | Connections services adds ProjectAuthorityConnectionPanel with main-owned sign-in/encrypted JWT persistence, workspace generation fencing and capability availability checks. | Test actual configured authority sign-in/revoke/reconnect and grant imports on A/B/C; distinguish secure native custody from hosted actor session handling. |
| [UI-024](02-surface-backlog.md#ui-024-knowledge-search-saved-views-and-entity-inspector) Knowledge search, saved views and entity inspector | Scoped capability read helpers and native content resolution exist across Notes/Projects; original knowledge page task remains broader than those new callers. | Verify search/views/entity resolution across backends, denied read, stale revision, unavailable provider and wrong workspace; no all-provider acceptance from generic route smoke. |
| [UI-025](02-surface-backlog.md#ui-025-knowledge-proposals-and-diff-review) Knowledge proposals and diff review | Roadmap/native-note proposal infrastructure is newer, but no reviewed packet closes Knowledge proposal-diff/apply acceptance. | Retain preview/apply/reject, identity/revision fencing, effect receipts and unauthorized negative controls with the actual Knowledge route. |
| [UI-026](02-surface-backlog.md#ui-026-optional-knowledge-engine-and-embedded-siyuan-surface) Optional knowledge engine and embedded SiYuan surface | Knowledge settings now state external engine optional and remove obsolete SiYuan setup CTA; native-host capability still requires per-target scope. | Choose supported optional engine contract and test install/attach/unavailable/restart/URL/bounds on A/B; deliver browser-compatible C behavior and accurate capability UX. |
| [UI-027](02-surface-backlog.md#ui-027-browser-pane-profiles-navigation-and-inspector-browser) Browser pane, profiles, navigation and inspector browser | Browser inspector lifecycle source/tests and WebBrowserPanel source changed in cloud; native browser creation still depends on host capability. | Verify native view bounds/focus/disposal and real navigation/cookies/profiles on A/B; C requires explicit remote/browser behavior and a supported credential/cookie custody contract. |
| [UI-028](02-surface-backlog.md#ui-028-embedded-extension-views-and-extension-host-integration) Embedded extension views and extension host integration | Extension settings catalog projections changed; no branch result proves every native extension view lifecycle and hosted isolation. | Retain view disposal, capability/permission revocation, crash/update, cross-workspace denial and C iframe/remote isolation acceptance. |
| [UI-029](02-surface-backlog.md#ui-029-terminal-route-dock-and-genuine-interactive-shell) Terminal route, dock and genuine interactive shell | Inspected cloud diff changes InspectorTerminal theme colors only. Cloud does not change system command handlers' /bin/zsh invocation; TerminalSurfacePage still documents lack of full PTY wiring. | Windows shell selection/quoting, PTY streaming/resize/signals, sessions/reconnect and authenticated hosted execution remain implementation gaps; color fixes must not be credited as terminal completion. |
| [UI-030](02-surface-backlog.md#ui-030-cloud-run-detail-surface-and-live-run-operations) Cloud-run detail surface and live run operations | CloudRunSurfacePage is unchanged by reviewed assembled branch and still has runId-only loading with fallback timestamp and no observed live subscription/poll. | Implement or verify live run progress/output/authoritative timestamps, restart/reconnect, artifacts, ownership, quota/cancel; full provider lifecycle remains open. |
| [UI-031](02-surface-backlog.md#ui-031-generated-pages-catalog-page-runtime-and-capability-grants) Generated Pages catalog, page runtime and capability grants | Cloud packet proves production browser Pages mount/create/persistence/reload/same-profile restart/new-workspace ACK at frozen010 source. This is bounded generated-page state verification. | Complete generated page data grants, sandbox/runtime RPC, revocation, CSP, invalid code, ownership and actual hosted multi-user deployment workflows. |
| [UI-032](02-surface-backlog.md#ui-032-page-publication-session-sharing-and-publish-dialogs) Page publication, session sharing and publish dialogs | Session/page publication is still a distinct deployment/grants service boundary; no full public-share service acceptance is inferred from Pages state proof. | Keep real publish/read/revoke/expiry/permission changes and deployed endpoints, anonymous boundaries and public viewer error states as integration gates. |
| [UI-033](02-surface-backlog.md#ui-033-team-activity-invitations-and-workspace-transfers) Team activity, invitations and workspace transfers | Cloud adds trusted native roster identity requirements, team recipient inbox actions and team settings/feed updates; local pending decisions are acknowledged as pending. | Verify actual recipient/server ACK, membership/grant changes, organization identity, multi-client realtime and rollback/revocation. Local roster/feed dispatch is not a completed transfer. |
| [UI-034](02-surface-backlog.md#ui-034-dossier-contacts-companies-touches-and-generated-briefs) Dossier contacts, companies, touches and generated briefs | No specific source delta or bounded product evidence closes Dossier in reviewed accumulated branches; local author storage is retained. | Retain CRUD/import/search/tag/link/document/team behaviors and migration to canonical cross-device owner storage required by release. |
| [UI-035](02-surface-backlog.md#ui-035-radar-topics-source-signals-sweeps-and-digest-detail) Radar topics, source signals, sweeps and digest detail | Radar is represented in accumulated extra-screen work but no packet closes canonical Radar lifecycle. | Run watch rule edits, real signals/dedup/refresh/rate-limit, external provider failure, workspace isolation and durable preferences; retained local authorship is not hosted persistence. |
| [UI-036](02-surface-backlog.md#ui-036-decisions-log-extraction-and-memory-promotion) Decisions log, extraction and memory promotion | Decisions model/page source changes include expanded projection handling; generic workspace JSON storage gains validity snapshots and byte-compare writes. | Validate source links/decision outcomes/CAS conflicts/recovery and canonical persistence on A/B/C; localStorage CAS does not implement remote actor concurrency. |
| [UI-037](02-surface-backlog.md#ui-037-agent-center-stop-controls-automations-and-budget-monitor) Agent Center, stop controls, automations and budget monitor | Cloud replaces local daily budget preference with getSessionBudget/setSessionBudget authoritative limit/spent/reserved/unresolved/exhausted UI and guarded numeric edit. | Old warn-only assessment is superseded. Complete provider cost/cancel/crash reservations and integration readback; test budget exhaustion enforcement, uncertain costs, reset and authorized scope. |
| [UI-038](02-surface-backlog.md#ui-038-focus-timer-daily-priorities-calendar-and-daily-summary) Focus timer, daily priorities, calendar and daily summary | Current September fixes disabled-notification privacy, pair-key coalescing, bounded queue and workspace-specific Focus display/clear. Published hook/ReactDOM tests use synthetic IPC/browser storage. | Credit source and bounded lifecycle evidence; worker questions/waiting_focus, authenticated actor, drain/delivery ACK, timer atomicity, restart/crash and real OS notifications remain open. |
| [UI-039](02-surface-backlog.md#ui-039-settings-overview-navigator-and-registry-coverage) Settings overview, navigator and registry coverage | Cloud settings group/page mounting has source and old browser packet covers22 settings screens; desktop-settings-session helper is added. | Run behavior and durable write/readback for each setting, deep links, unavailable RPC, reload and workspace change; mounted pages are not full setting acceptance. |
| [UI-040](02-surface-backlog.md#ui-040-account-profile-avatar-xp-and-balance-settings) Account profile, avatar, XP and balance settings | Account settings adds guarded consent saving, failure toast and disabled toggle during save; local hidden plan/profile/XP behavior is not billing integration. | Keep profile/avatar/XP authority and analytics consent audit verification; if plan selection is offered, require real entitlement/provider readback. |
| [UI-041](02-surface-backlog.md#ui-041-accounts-service-identity-cloud-connection-and-logout) Accounts, service identity, cloud connection and logout | Authenticated web bootstrap/session transport is newer; no complete actual account cloud/provider logout/refresh UX acceptance is proved here. | Test session refresh/expiry/logout/revoke/transport retry and native account credential custody on A/B versus browser cookie/token policy C. |
| [UI-042](02-surface-backlog.md#ui-042-privacy-purpose-controls-export-and-remote-deletion) Privacy purpose controls, export and remote deletion | Native Notes and portable bridge enforce additional scope/custody but original privacy export/delete task remains broader. | Verify actual export and deletion of every owner store/outbox/cache/artifact, cancellation, propagation, consent and redacted receipts with each platform's data paths. |
| [UI-043](02-surface-backlog.md#ui-043-runtime-toolchain-environment-and-secret-references-settings) Runtime, toolchain, environment and secret references settings | Environment/desktop settings source changes and Bun/SQLite runtime recovery exist beyond main. | Run runtime executable/secret refs/toolchain/environment checks with real installed Windows/macOS paths and hosted server env, including absent tools and no raw secrets in UI/errors. |
| [UI-044](02-surface-backlog.md#ui-044-context-documents-templates-preferences-and-memory-entry-points) Context documents, templates, preferences and memory entry points | Roadmap AI and retained editor changes broaden context templates and instructions; no bounded packet closes every preferences/template action. | Retain context precedence, templates/import/edit and session effective context verification with owner readback; integrate both source lines. |
| [UI-045](02-surface-backlog.md#ui-045-knowledge-settings-engine-connections-migration-and-note-ai-prompts) Knowledge settings, engine connections, migration and note AI prompts | Knowledge settings removes stale engine setup CTA and documents optional external engine; PR1316 adds inspection-only Markdown migration fence. | Migration inspection is implemented only; do not activate native writes on inspection. Verify backup/scope/integrity/restart and explicit approved cutover separately. |
| [UI-046](02-surface-backlog.md#ui-046-marketplace-catalog-packages-offline-reports-and-update-lifecycle) Marketplace catalog, packages, offline reports and update lifecycle | Marketplace source has catalog/recovery presentation changes; no real install/update/uninstall provider acceptance is closed. | Verify catalog trust, signatures, downloads, permission grants, dependency failures, rollback and installed owner state on all advertised targets. |
| [UI-047](02-surface-backlog.md#ui-047-extensions-settings-catalogs-dev-host-and-compatibility-center) Extensions settings, catalogs, dev host and compatibility center | Extension settings adds catalog projections/install routing; source change does not certify each plugin backend or dev workflow. | Keep package/import/dev load/update/remove/revoke, failure recovery and cross-target capability gating; verify actual native/provider effects. |
| [UI-048](02-surface-backlog.md#ui-048-foreign-session-import-and-automatic-discovery-settings) Foreign session import and automatic discovery settings | Import source handles consent-revoked/partial auto-import status and branch runtime recovery adds reader behavior. | Run authorized file/source import, exact counts/dedup, cancellation, consent revoke, malformed/oversized input and encrypted/canonical owner readback; loading is not accepted import. |
| [UI-049](02-surface-backlog.md#ui-049-app-environment-notifications-power-proxy-and-updates-settings) App environment, notifications, power, proxy and updates settings | AppSettings adds generation fences, queued preference writes, failed-save rollback/readback and retry status; notifications/keep-awake/browser-tool are affected. | Retest actual notification/power/proxy/update behavior on installed A/B and supported C equivalent; don't close platform effects from preference tests alone. |
| [UI-050](02-surface-backlog.md#ui-050-ai-connections-provider-editor-and-workspace-model-overrides) AI connections, provider editor and workspace model overrides | OMP/provider routing recovery and model provenance in Roadmap exist outside main; complete provider config remains broader. | Exercise each supported provider authenticate/list/send/stream/error/cancel/cost/model defaults with real authorized accounts and fresh installed profiles. |
| [UI-051](02-surface-backlog.md#ui-051-appearance-shell-variants-theme-language-density-and-icon-settings) Appearance, shell variants, theme, language, density and icon settings | Cloud shell appearance/theme/rail persistence and sidebar PR repair exist; desktop appearance/settings-session helpers are added. | Integrate without restoring legacy shell defaults; verify OS theme, accent, high contrast, zoom, fonts, persisted rail and all mode/feature combinations on A/B/C. |
| [UI-052](02-surface-backlog.md#ui-052-input-spellcheck-send-key-and-voice-settings) Input, spellcheck, send key and voice settings | Voice preferences/capability UX, recording and TTS source change in branches; actual microphone and model/provider workflow still needs platform acceptance. | Verify STT engine assets/language, mic permission/device change, cancellation, TTS voices/output, retention/consent and keyboard dictation with actual native/browsers. |
| [UI-053](02-surface-backlog.md#ui-053-workspace-identity-tls-enabled-modes-directories-and-mcp-settings) Workspace identity, TLS, enabled modes, directories and MCP settings | Projects scope fencing, scoped native Notes and authenticated web bootstrap improve workspace/caller boundaries. | Test local path selection/TLS/SSH and workspace switching/revocation without stale data; assert actual project/note/task owner writes, not a metadata workspace label. |
| [UI-054](02-surface-backlog.md#ui-054-permissions-defaults-workspace-rules-openclaw-audit-and-command-gateway) Permissions defaults, workspace rules, OpenClaw audit and command gateway | Gateway/OpenClaw permissions task is retained; scoped capability read controls add implementation but no complete gateway UX evidence. | Verify connect/auth/revoke, effective safe/ask/allow modes, risk prompts and forbidden actor commands with real gateway integration. |
| [UI-055](02-surface-backlog.md#ui-055-labels-hierarchy-colors-and-saved-collection-views-settings) Labels, hierarchy, colors and saved collection views settings | View/label and shared Markdown presentation updates exist but original saved-label/view behavior is not fully accepted. | Retain create/edit/reorder/filter/query/import/delete and persistence across restart, clients and workspace; verify no query leakage. |
| [UI-056](02-surface-backlog.md#ui-056-organizations-membership-invitations-and-team-spaces-settings) Organizations, membership, invitations and team spaces settings | Organizations settings adds trusted roster identity and team authority status; shared Projects authority is separate service configuration. | Verify actual invitation/join/role/revoke/ownership and team spaces across two users/clients; local membership projections need canonical server confirmation. |
| [UI-057](02-surface-backlog.md#ui-057-messaging-platform-connections-pairing-bindings-and-access-settings) Messaging platform connections, pairing, bindings and access settings | Messaging settings/runtime source changes exist for connection/status/bindings; gateway/worker changes are handled by runtime audit. | Verify each Telegram/Discord/Lark/WeChat/WhatsApp subtask with actual authorized transport inbound/outbound, reconnect, binding scope, queue/cancel and platform availability. |
| [UI-058](02-surface-backlog.md#ui-058-server-remote-access-tls-auth-token-and-native-sidecar-settings) Server remote access, TLS, auth token and native sidecar settings | Cloud runtime/headless WebUI startup and authenticated server build have evidence; Compound latest additionally mounts LicenseEvidencePanel in Server settings. | Retain TLS/certificate/bind-address/auth/process lifecycle and installed service acceptance; add license panel UI076. Build/route mounting does not establish deployment service security. |
| [UI-059](02-surface-backlog.md#ui-059-cloud-runs-provider-sandbox-quotas-and-scheduling-settings) Cloud Runs provider, sandbox, quotas and scheduling settings | Cloud-run quota/provider budget recovery exists beyond main; this UI settings task still requires actual provider token/policy acceptance. | Validate configure/save/revoke, quotas/cost/cancel/artifacts and tenant isolation; keep unresolved/provider pending states distinct from success. |
| [UI-060](02-surface-backlog.md#ui-060-security-overview-openclaw-lifecycle-vault-health-and-risk-acceptance) Security overview, OpenClaw lifecycle, vault health and risk acceptance | Security risk/audit/vault settings remain release gates; branch capability/custody improvements do not prove all SecuritySnake domains. | Run actual audited secret lifecycle/lock/rotation/recovery, risk events, protected PG/security flows and all seven UI060.3 domains with negative controls. |
| [UI-061](02-surface-backlog.md#ui-061-shortcuts-page-command-palette-and-platform-key-mappings) Shortcuts page, command palette and platform key mappings | Shortcut page mounting is part of settings/browser packet; no per-shortcut platform conflict/native key behavior proof is closed. | Test every advertised binding, edit/conflict/reset, IME/composition and global/local contexts using actual OS keys on Win10/11/macOS and browser C. |
| [UI-062](02-surface-backlog.md#ui-062-preferences-identitypersonalocation-and-settings-embedding) Preferences identity/persona/location and settings embedding | Embedded PreferencesForm remains Context settings content; accumulated context/editor changes do not prove complete form behavior. | Retain validation/defaults/save/readback/restart and effective session-context result checks; test unavailable stores and concurrent change. |
| [UI-063](02-surface-backlog.md#ui-063-shared-markdown-document-code-diff-and-media-viewers) Shared Markdown, document, code, diff and media viewers | Shared Markdown fixes include legacy mixed task lists, retained trailing node, table export and PDF search/overlay changes; shared selection/menu behavior also changes. | Run actual media/files/PDF/spreadsheet/diff/code overlays, large input, copy/download/export and exact retained source round trips after integrating both branches. |
| [UI-064](02-surface-backlog.md#ui-064-shared-menus-dialogs-accessibility-and-responsive-primitives) Shared menus, dialogs, accessibility and responsive primitives | StyledDropdown/premium-menu axe tests, panel focus and input/menu source changes provide narrower accessibility implementation. | Retain complete keyboard/focus/reader/contrast/zoom/touch and native-host interactions across routes; an axe menu test is not full product accessibility acceptance. |
| [UI-065](02-surface-backlog.md#ui-065-localization-dates-plural-forms-and-visible-product-identity) Localization, dates, plural forms and visible product identity | September Roadmap adds registry-dependent localized labels/model provenance, including Korean/Arabic resources; actual LOCALE_REGISTRY is12. Historical all-ten wording is stale. | Retain all 12 language full workflow, Korean fallback and Arabic RTL/plurals/interpolation, user content, localized errors and branding; 70SSR checks alone do not certify every screen. |
| [UI-066](02-surface-backlog.md#ui-066-browser-profile-import-cookies-bookmarks-and-credential-consent) Browser profile import, cookies, bookmarks and credential consent | BrowserProfileImportPanel source changes and native browser lifecycle improvements exist; import/custody remains platform-specific. | Verify actual Chrome/Edge/Safari profile discovery, cookie/schema/lockedDB handling, explicit permission, keychain/decryption and revoked grants; C needs its supported remote/upload boundary. |
| [UI-067](02-surface-backlog.md#ui-067-workspace-picker-creation-folder-opening-remote-tls-and-ssh-bootstrap) Workspace picker, creation, folder opening, remote TLS and SSH bootstrap | Authenticated web/native workspace scoped bootstrap and runtime startup fixes improve available foundations. | Keep actual fresh workspace creation/open/remoteTLS/SSH bootstrap, enrollment, corruption/error recovery and first usable workflow on A/B/C. |

## [SURFACE-DEFECTS] Concrete source defects and superseded assessments

- **UI011 table controls:** cloud NotesViewHost's property-column remove button has no `onClick` at lines287–292. Header has Title/Folder/Tags at280–282; each row emits Title/Tags at327–341, shifting subsequent cells. Fix and verify actual grid geometry/interaction: [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx:277–365](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L277-L365).
- **UI037 budget:** the main-only local warning assessment is superseded by authoritative getSessionBudget/setSessionBudget and spent/reserved/unresolved/exhausted UI. Provider cost, cancellation and crash reservation acceptance remain: [apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx:202–267](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx#L202-L267).
- **UI038 Focus:** disabled preferences are checked before private-preview queueing; workspace/session pairs coalesce and workspace clear is scoped. This fixes specific source behavior; it does not supply worker/actor/OS-delivery/crash acceptance: [apps/electron/src/renderer/hooks/useNotifications.ts:227–256](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/hooks/useNotifications.ts#L227-L256).
- **UI020 Projects:** committed workspace lease/request/disposal fencing is implemented and tested with synthetic IPC. Actual native switching remains: [apps/electron/src/renderer/hooks/useProjects.ts:18–85](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/hooks/useProjects.ts#L18-L85).
- **UI010 Notes:** one actual macOS create/edit/reload/normal-restart workflow is published. Task→Note was explicitly not accepted; task storage was unavailable and a legacy unscoped caller was rejected. Preserve that rejection until scoped authority enrollment exists.
- **UI029 terminal:** inspected cloud changes are theme colors; hardcoded `/bin/zsh` command execution remains, and full PTY is still unwired. Windows and authenticated hosted execution stay open.
- **UI065 locales:** actual registry has 12 languages including Korean and Arabic; old ten-language wording is stale: [packages/shared/src/i18n/registry.ts:51–76](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/packages/shared/src/i18n/registry.ts#L51-L76).

## [SURFACE-ADDITIONS] Additional feature tasks absent from the main-only inventory

**Targets:** A = Windows 10 and Windows 11 installed desktop; B = supported macOS installed desktop; C = actual authenticated hosted web. A/B test native file/dialog/permission/keyboard behavior; C test real server transport, actor isolation, browser upload/download and explicit unavailable states for native-only capabilities. Source-present tasks require integration and release acceptance; UTB v2 tasks require product implementation beyond UTB01. Existing suite paths below are source entry points; new suites are explicitly proposed and do not claim prior execution.

### [UI-068] Unified Search across Notes, Sessions and Knowledge

**Assessment:** Implemented in assembled cloud; missing from original page inventory.

**Code references:** [apps/electron/src/renderer/pages/SearchPage.tsx:20–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/SearchPage.tsx#L20-L110).

- **Requirements:** Preserve the Search route during integration; identify independent loading/empty/unavailable states for Notes, Sessions and Knowledge, exact workspace scope and navigable excerpts. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** All three real search owners return only authorized current-workspace results; no stale response revives old query/workspace state; search/deep-link/reload flows work on all targets.
- **Full functional verification:** Seed matching and nonmatching Notes/session messages/Knowledge entities in two workspaces, query each source, open hits, reload, remove one hit, delay replies and revoke access.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-068.1] Debounce, query generations and workspace races

**Assessment:** Request generation and180ms debounce source exists.

**Code references:** [apps/electron/src/renderer/pages/SearchPage.tsx:20–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/SearchPage.tsx#L20-L110).

- **Requirements:** Verify blank query, query clear, fast typing, A→B→A workspace changes, unmount and late success/error for every independent source. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No previous query/workspace row or late error flashes; unavailable sources do not erase successful source results.
- **Full functional verification:** Delay each owner in a different order, change query/workspace, clear query during load and navigate away; inspect rows and loading state before/after replies.
- **Test method:** New mounted ReactDOM race suite plus real IPC/server route test; assert DOM history and owner request scope, then run the full workflow on A/B/C.

#### [UI-068.2] Hit opening and deleted/unauthorized entities

**Assessment:** Search result navigation implemented; release checks remain.

**Code references:** [apps/electron/src/renderer/pages/SearchPage.tsx:20–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/SearchPage.tsx#L20-L110).

- **Requirements:** Bind hit navigation to authoritative entity/workspace/revision and source kind; revalidate selected Note and provide deleted/denied state. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Each result opens its own entity and no stale selection or generic fallback exposes other workspace content.
- **Full functional verification:** Open all three hit kinds, delete/revoke selected targets between result and click, then use direct URL/back/forward/restart.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-068.3] Search relevance, scale and capability status

**Assessment:** Independent source state exists; index/provider acceptance remains.

**Code references:** [apps/electron/src/renderer/pages/SearchPage.tsx:20–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/SearchPage.tsx#L20-L110).

- **Requirements:** Define ranking, truncation, pagination/limits, language handling and unavailable-provider semantics using real search backends. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Documented relevance/scale budgets pass with large fixtures; capability gaps remain visibly distinct from empty results.
- **Full functional verification:** Search punctuation, Unicode/Arabic/Korean, long query and large vault/history; disconnect one backend and restore it.
- **Test method:** New search-owner integration and performance suite; compare exact authorized expected hits and latency/size budgets, then UI workflow on all targets.

### [UI-069] Project Roadmap one-surface workspace

**Assessment:** Roadmap implemented in latest September; absent as a distinct task in original inventory.

**Code references:** [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx:101–250](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx#L101-L250).

- **Requirements:** Preserve goal, expected result/DoD, milestones/stages, timeline, requirements, risks/questions, inputs, tasks/sessions and exports while merging shared Project variants. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every section persists through the canonical project roadmap owner with valid revision, clear save/error state and no feature lost during assembly.
- **Full functional verification:** Create a new project, populate every section, link tasks/assets/sessions, save/reload/restart, modify from second client, export and verify exact owner artifacts.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-069.1] Revision-safe autosave and project-switch isolation

**Assessment:** 400ms debounce/save queue and revision source exists.

**Code references:** [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx:101–250](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx#L101-L250).

- **Requirements:** Retain newest-save ordering, expected revision, read-before-write gating, malformed/rejected receipts and project/workspace generation fences. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No save writes another project, drops newest edit or converts conflict/failure to saved; reload/recovery preserves the user’s unresolved draft.
- **Full functional verification:** Type before initial load; overlap saves; switch A→B→A; inject stale revision, unavailable owner and invalid receipt; retry after restoring transport.
- **Test method:** Existing entry points: `bun test packages/shared/src/projects/__tests__/roadmap-save-caller.test.ts packages/shared/src/projects/__tests__/roadmap-storage-recovery.test.ts` plus new mounted native/hosted autosave race suite. Read roadmap.json/mirror and owner revision.

#### [UI-069.2] Milestones, stages and timeline

**Assessment:** Timeline/milestone components exist.

**Code references:** [apps/electron/src/renderer/pages/project/ProjectTimeline.tsx:1–100](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/project/ProjectTimeline.tsx#L1-L100).

- **Requirements:** Verify milestone CRUD/order/status/start/end/substages/progress, task links, date validation and timezone/locale display at all widths. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Timeline and milestone lists agree with canonical data; task progress does not count removed/trashed links; edits remain keyboard accessible.
- **Full functional verification:** Create overlapping and unscheduled milestones, reorder stages, change dates/status, link/complete/unlink tasks and reload after DST boundary.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-069.3] Tasks, delegation and session links in Roadmap

**Assessment:** Task store/delegation UI exists; native task authority acceptance remains open.

**Code references:** [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx:335–440](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx#L335-L440).

- **Requirements:** Use scoped confirmed task writes and durable project/milestone/session identity; retry/cancel must not duplicate delegated sessions or links. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** A real enrolled task is created/edited/completed, delegated once and linked to the correct project/milestone; canonical receipt and restart agree.
- **Full functional verification:** Create task in milestone, delegate, retry dropped response, cancel provider, reopen task/session after restart, then change workspace during operation.
- **Test method:** Existing entry point: `bun test apps/electron/src/renderer/lib/__tests__/personal-task-confirmed.integration.test.ts` plus new actual Roadmap→task→session workflow; provider and task owner readback required. Do not accept unavailable/local cache fallback.

#### [UI-069.4] Requirements, risks, questions and input links

**Assessment:** Section components exist.

**Code references:** [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx:101–250](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx#L101-L250); [apps/electron/src/renderer/pages/project/ProjectRequirements.tsx:1–100](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/project/ProjectRequirements.tsx#L1-L100).

- **Requirements:** Verify requirement kinds/acceptance criteria, ordering, risk/question edit and links to Note/source/file/asset; resolve stale/deleted/denied inputs explicitly. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Saved roadmap exactly retains all section content and input identity; provider scope is checked before reading linked input content.
- **Full functional verification:** Add each requirement/input kind, reorder/delete, revoke source and delete a linked Note, reload and inspect roadmap mirror.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-069.5] Export Roadmap to Note and retained Markdown

**Assessment:** Export source exists; complete owner/custody/idempotency acceptance pending.

**Code references:** [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx:631–652](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx#L631-L652).

- **Requirements:** Create Note through scoped native/hosted writer; export localized goal/DoD/milestones/requirements/tasks/assets without truncation or silent partial creation. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** One logical export produces one canonical Note with exact content, valid ACK and durable link; uncertain response can be recovered without duplicate Notes.
- **Full functional verification:** Export complete multilingual roadmap twice intentionally, retry one lost ACK, restart/reopen Note and compare expected Markdown/owner metadata; deny writer and verify no false success.
- **Test method:** New Roadmap export integration suite with enrolled Note writer and actual UI; compare bytes/hash and operation receipts, test lost ACK and denied scope.

### [UI-070] Project OKR cycles, objectives and key results

**Assessment:** OKR tab and calculations implemented beyond main.

**Code references:** [apps/electron/src/renderer/pages/ProjectInfoPage.tsx:50–200](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectInfoPage.tsx#L50-L200).

- **Requirements:** Support explicit cycle dates/timezone, objectives/weights, key-result types/targets/progress, validation and canonical save/readback. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** All OKR values/calculations and cycle selection survive restart; invalid input and save failure do not masquerade as committed progress.
- **Full functional verification:** Create multiple cycles/timezones, multiple weighted objectives and every KR type; update progress, save/reload/restart and compare owner document.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-070.1] Cycle calendar and timezone lifecycle

**Assessment:** Cycle form and selected cycle state exist.

**Code references:** [apps/electron/src/renderer/pages/ProjectInfoPage.tsx:50–200](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectInfoPage.tsx#L50-L200).

- **Requirements:** Validate date ordering/timezone/title, current/previous cycle selection, edit/delete and workspace/project switching with pending load/save. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No foreign or stale cycle becomes selected; invalid date/timezone rejected with translated error; canonical cycle remains recoverable.
- **Full functional verification:** Create DST/UTC-crossing cycle, rapidly switch project during deferred getProjectOkr, delete current cycle and reload.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-070.2] Objective/KR progress and weighting

**Assessment:** calculateOkrCycle projection exists.

**Code references:** [apps/electron/src/renderer/pages/ProjectInfoPage.tsx:50–200](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectInfoPage.tsx#L50-L200).

- **Requirements:** Specify finite range/weight normalization, empty/zero-target cases, manual/progress fields and supported KR semantics; prevent NaN or inconsistent totals. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Independent calculations match UI and owner values for boundary cases; reorder/edit preserves stable IDs.
- **Full functional verification:** Enter zero/negative/large/decimal weights and target values, add/remove KRs, complete partial objectives and compare independently computed result.
- **Test method:** Existing entry point: `bun test packages/shared/src/projects/__tests__/okr.test.ts` plus new mounted OKR field/property-based boundary tests and actual owner readback.

#### [UI-070.3] OKR saves, conflict and second-client recovery

**Assessment:** Save surface exists; scope/transaction acceptance not assumed.

**Code references:** [apps/electron/src/renderer/pages/ProjectInfoPage.tsx:50–200](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/ProjectInfoPage.tsx#L50-L200).

- **Requirements:** Fence late loads/saves to project/workspace; use validated revision and recover concurrent edits or explicit conflict without silent replacement. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Two clients cannot silently overwrite each other; failed/uncertain write remains visibly pending or conflicted with retry/restore path.
- **Full functional verification:** Edit same cycle from two clients, drop one response, switch workspace and restart both; inspect owner revisions and rendered progress.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

### [UI-071] Project AI drafting and repository context

**Assessment:** Implemented project AI and repository snapshot surfaces in cloud; newest Roadmap model provenance exists separately in September.

**Code references:** [apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx:1–130](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx#L1-L130); [apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx:38–120](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx#L38-L120).

- **Requirements:** Preserve explicit user-started AI brief/questions/spec proposal/improve flows and approved scoped repository context; expose requested/effective/unknown model and provider provenance. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No content is sent or overwritten without the intended user action; accepted proposal items persist canonically and repository excerpts respect policy/freshness/scope.
- **Full functional verification:** Approve repository scope, capture snapshot, provide brief, answer questions, accept selected proposal items, improve one section, cancel/retry provider, reload/restart and inspect exact final owner data.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-071.1] Brief, clarification and item-by-item proposal decisions

**Assessment:** Proposal state and decision/source component exists.

**Code references:** [apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx:1–130](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx#L1-L130).

- **Requirements:** Keep brief/questions/answers/proposal/decisions tied to workspace/project/roadmap revision; reject stale proposals and preserve undecided items. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Accept/reject operates exactly once on selected item without overwriting unrelated section changes; denied or stale proposal remains recoverable.
- **Full functional verification:** Generate each goal/DoD/milestone/requirement/risk/question item, accept a subset, manually edit section, return to proposal, retry/cancel and reopen project.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-071.2] Improve text and model/provider provenance

**Assessment:** Requested/effective/unknown model display and localized source exists.

**Code references:** [apps/electron/src/renderer/pages/project/RoadmapModelResult.tsx:1–18](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/project/RoadmapModelResult.tsx#L1-L18); [apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx:1–130](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx#L1-L130).

- **Requirements:** Bind improvement to original text/revision; display requested/effective/unknown model and provider honestly; retain cost/error/cancel states. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Rejected/cancelled/failed generation cannot overwrite user text; model provenance never claims an unobserved effective model.
- **Full functional verification:** Improve goal/DoD/requirement, change target text during reply, exercise provider fallback and missing model metadata, apply/reject and read canonical values.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-071.3] Repository preview, explicit approval and binding

**Assessment:** Native repository preview/bind source exists.

**Code references:** [apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx:38–120](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx#L38-L120).

- **Requirements:** Resolve saved project root in main; explicitly approve branch/includes/excludes/byte/file budgets; invalidate preview on configuration/root/branch change. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No capture occurs before matching approved preview; env/key/metadata exclusions and root symlink escape fail safely without raw paths/secrets in UI.
- **Full functional verification:** Preview Git repository, change branch/root/patterns between preview and bind, attempt excluded/symlinked file and exceed budgets; bind approved scope and verify saved policy.
- **Test method:** Existing entry points: `bun test packages/shared/src/code-intelligence/__tests__/adapter.test.ts packages/shared/src/code-intelligence/__tests__/contracts.test.ts` plus new actual RepositorySnapshotPanel UI→native handler workflow; use task-private repos with canary secrets and compare exclusion/policy receipts.

#### [UI-071.4] Capture, historical snapshots, freshness and excerpts

**Assessment:** Snapshot list/history/freshness/excerpt and cancellation source exists.

**Code references:** [apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx:38–120](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx#L38-L120).

- **Requirements:** Capture immutable snapshot under approved policy; show historical origin/freshness; enforce excerpt line/byte/path budget and fence cancel/late results on scope changes. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Snapshot hashes/history and excerpts agree with owner artifacts; changed repository shows stale state and no revoked/excluded content is emitted.
- **Full functional verification:** Capture, edit repository, inspect freshness/history, request valid/invalid line spans, cancel one request and switch workspace/project during response.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-071.5] AI input provenance and hosted repository capability

**Assessment:** Input pickers and native repository interface exist; hosted authority contract remains a gate.

**Code references:** [apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx:38–120](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/code-intelligence/RepositorySnapshotPanel.tsx#L38-L120); [apps/electron/src/renderer/pages/project/ProjectInputs.tsx:1–100](https://github.com/rox-one/rox-one/blob/8f43e92d2a27a98994573d081b85d0b4c51728de/apps/electron/src/renderer/pages/project/ProjectInputs.tsx#L1-L100).

- **Requirements:** Trace Note/source/asset/repository inputs and excerpt revision into AI request; C must use authorized server repository roots/upload/import or explicit unavailable capability. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Provider request contains only approved current-scope inputs; native-only path is never shown as a working browser feature; revoked inputs are excluded.
- **Full functional verification:** Send AI brief with each input kind, revoke one source/snapshot before send, inspect redacted provider request provenance and compare native versus hosted capability UX.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

### [UI-072] Shared Project authority, catalog and offline creation

**Assessment:** Implemented scoped authority surfaces in cloud; distinct from local folder Projects.

**Code references:** [apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx:26–100](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx#L26-L100); [apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx:10–75](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx#L10-L75).

- **Requirements:** Preserve local/shared project kinds, main-owned credentials, bound authority workspace, paging, trusted identity, visibility and queued/uncertain/denied intents. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Actual enrolled server owner confirms create/read/visibility/intent recovery with exact actor/workspace; no local projection or pending status claims committed access.
- **Full functional verification:** Connect two authorized users, page local/shared catalog, create private/member project online/offline, drop ACK, restart/replay and revoke access while detail is selected.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-072.1] Connections authority sign-in, custody and disconnect

**Assessment:** Generation-fenced connection UI exists; custody implementation belongs to main.

**Code references:** [apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx:10–75](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx#L10-L75).

- **Requirements:** Validate service URL/authority workspace/login; clear password on exit/result; retain encrypted native credential lifecycle and hosted session separation. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Secrets never appear in renderer logs/status/raw errors; reconnect/expired/revoked credentials yield correct denied/unavailable state and no stale content.
- **Full functional verification:** Sign in with valid/wrong/expired actor, switch workspace during reply, inspect persisted secret reference only, restart, disconnect and try forbidden reads.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-072.2] Catalog paging, local/shared identity and revocation

**Assessment:** Catalog explicitly retains local folder entries and shared projection.

**Code references:** [apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx:26–100](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx#L26-L100).

- **Requirements:** Fence request/broadcast scope and cursor; maintain distinct native and shared IDs; clear inaccessible rows/details immediately on identity/workspace revoke. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No duplicate/foreign row or incorrect local route appears; paged lists, empty/offline/denied states and detail permission labels match owner.
- **Full functional verification:** Use multiple pages, identical local/shared names, A→B→A switching, delayed reads and live revoke; open every row and inspect canonical target identity.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-072.3] Durable create intent, uncertainty and replay

**Assessment:** Create intent and offline/uncertain UI exist.

**Code references:** [apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx:116–210](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx#L116-L210).

- **Requirements:** Use stable command identity and actor/workspace binding; preserve queued/uncertain drafts; refuse replay after revoked/foreign scope and validate ACK/readback. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** One logical submit produces one owner project or a clearly pending/blocked state; crash/lost response cannot create duplicates or grant wrong audience.
- **Full functional verification:** Submit offline, reconnect, drop reply after commit, restart/replay, change authority identity/workspace and retry; compare owner count, receipt and encrypted intent state.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-072.4] Shared detail editing and capability projection

**Assessment:** Shared detail projection exists; no blanket equivalence to local Roadmap/OKR assumed.

**Code references:** [apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx:218–273](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx#L218-L273).

- **Requirements:** Define which shared detail actions are genuinely supported by owner; integrate Roadmap/OKR/repository capabilities explicitly and display denied/unavailable actions. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Each advertised action has positive authorized owner proof; unsupported or revoked operations cannot fall back to local folder mutation.
- **Full functional verification:** Open editor/viewer/denied shared project, attempt every detail action and compare local project behavior; restart after supported mutation.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

### [UI-073] Stable Note blocks, retained source and property dictionary

**Assessment:** Richer Compound Note source exists in cloud but is not in current September tree.

**Code references:** [apps/electron/src/renderer/pages/NotesPage.tsx:732–820](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L732-L820); [apps/electron/src/renderer/pages/NotesPage.tsx:1753–1800](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L1753-L1800).

- **Requirements:** Preserve retained Markdown source, sourceStore/authority epoch/revision, committed stable block tree, source-information dialog and property preview/apply alongside newer native Note writer. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** A single integrated Notes route supports both authority recovery and richer block/property contracts without losing source bytes or writing the wrong store.
- **Full functional verification:** Open imported Markdown, inspect source authority, preview stable block migration, commit, edit/locate blocks, change properties, switch workspace and reload/restart with owner readback.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-073.1] Stable marker preview/apply and authority epochs

**Assessment:** Stable-block preview/commit checks exist.

**Code references:** [apps/electron/src/renderer/pages/NotesPage.tsx:732–820](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L732-L820).

- **Requirements:** Bind preview to content hash/revision/sourceStore/authority epoch; fail safely on dirty text, missing block tree or backend unavailable; preserve existing block IDs. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Stale or foreign preview cannot commit; accepted migration returns matching canonical revision/tree and exact retained source.
- **Full functional verification:** Preview markers, edit source from second client, try stale commit, change sourceStore/epoch, repeat same preview after dropped response and compare final block IDs.
- **Test method:** Existing core docs/block authority contract tests (source review); new targeted block suite required plus new mounted Notes marker workflow with canonical readback; negative controls must show stale/foreign rejection.

#### [UI-073.2] Block-address links, Outline and source inspection

**Assessment:** Committed block tree/selection source exists.

**Code references:** [apps/electron/src/renderer/pages/NotesPage.tsx:732–820](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L732-L820); [apps/electron/src/renderer/pages/NotesPage.tsx:3150–3168](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L3150-L3168).

- **Requirements:** Use stable block address for Outline/deep links/opening source; invalid/deleted IDs and dirty unavailable tree have explicit status. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Navigation resolves the intended committed block after edit/reorder/restart; no position-only link selects a different block.
- **Full functional verification:** Create nested blocks, link/rename/reorder them, open same deep link after reload/restart, delete target and inspect missing state.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-073.3] Property dictionary preview/apply and rollback

**Assessment:** Property preview/apply and created property draft exist.

**Code references:** [apps/electron/src/renderer/pages/NotesPage.tsx:1753–1800](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L1753-L1800).

- **Requirements:** Preview typed dictionary changes against retained frontmatter and authoritative properties; handle name collisions/types/delete/stale revision without partial write. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Apply preserves unknown fields/source formatting and canonical properties; cancel/failure leaves original content; stale preview cannot overwrite new edits.
- **Full functional verification:** Add/rename/remove each supported property type, use unknown keys/comments/order, concurrently change Note, apply/cancel/retry and compare bytes/property owner.
- **Test method:** Existing core docs property contract tests (source review); new targeted dictionary suite required plus new actual inspector/property dialog integration suite with retained Markdown and owner revision assertions.

#### [UI-073.4] Authority information and unavailable/read-only modes

**Assessment:** Authority button/dialog and origin metadata are implemented.

**Code references:** [apps/electron/src/renderer/pages/NotesPage.tsx:2559–2640](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/NotesPage.tsx#L2559-L2640).

- **Requirements:** Display origin/store/capability/read-only/availability accurately; choose writer by owner contract and reject unmapped/ambiguous/foreign store. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** UI never labels unowned local text as canonical native content; unavailable stores do not authorize writes through another backend.
- **Full functional verification:** Open native, legacy Markdown, unmapped and revoked Note; inspect dialog and attempt edit/save/convert; verify exact writer invocation or denial.
- **Test method:** Existing assembled-source entry points: `bun test apps/electron/src/renderer/lib/__tests__/notes-write-authority.test.ts apps/electron/src/renderer/lib/__tests__/scoped-capability-read.test.ts` plus new actual native/hosted capability workflow; assert writer selection and no cross-store writes.

#### [UI-073.5] Retained editor round trips and Note view regressions

**Assessment:** Retained trailing/mixed-list source exists; assembled table has observed missing handler/cell.

**Code references:** [packages/ui/src/components/markdown/retained-trailing-node.ts:1–54](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/packages/ui/src/components/markdown/retained-trailing-node.ts#L1-L54); [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx:277–365](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L277-L365).

- **Requirements:** Fix property-column remove handler and Folder header/body mismatch; preserve trailing nodes/task-list syntax, blank lines, source identity and IME edit commit behavior. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Actual table columns/actions align and persist; editing/source conversion round trips do not drop text or double-save on Enter/blur.
- **Full functional verification:** Remove property column, verify Folder/Tags cell alignment, edit cells with IME/Escape/blur/Enter, switch views and reopen exact source after restart.
- **Test method:** Existing assembled-source entry points: `bun test tests/lark-suite-extension/retained-trailing-node.test.ts tests/lark-suite-extension/legacy-mixed-task-lists.test.ts apps/electron/src/renderer/pages/notes/__tests__/note-views.test.ts` plus new mounted table interaction/geometry regression; include failing controls for missing onClick and header/body mismatch.

### [UI-074] Compact mini session window

**Assessment:** MiniSessionSurface and native window routing are implemented in cloud.

**Code references:** [apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx:13–105](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx#L13-L105).

- **Requirements:** Preserve focused-session draft/attachments/status/send/stop/voice and Note creation when entering/exiting compact native window; define supported browser compact mode. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** A/B compact window retains exact current session/workspace and restores full window without losing draft or duplicated actions; C has a real supported compact UX or explicit unavailable capability.
- **Full functional verification:** Enter mini window during streaming, change focused session, type/dictate/upload draft, send/stop/create Note, expand/restart and inspect saved session/Note state.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-074.1] Draft, attachment and send lifecycle

**Assessment:** Hydrated attachments and send draft clearing exist.

**Code references:** [apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx:13–105](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx#L13-L105).

- **Requirements:** Fence focused session changes and asynchronous hydration; clear only the draft actually sent, expose send errors and preserve failed unsent input. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No draft/attachment from another session is sent or erased; repeated key/action does not duplicate provider message.
- **Full functional verification:** Delay attachment hydration, change focused session, fail send, press Enter twice, expand to full window and compare draft/history.
- **Test method:** New native mini-window composer race suite plus actual provider send/readback and full-window draft comparison.

#### [UI-074.2] Status, cancellation, voice and window geometry

**Assessment:** Status/cancel/voice/expand controls exist.

**Code references:** [apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx:13–105](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx#L13-L105).

- **Requirements:** Verify live status/subscription, cancellation ACK, microphone state, drag/resize/DPI/native menu/focus and keyboard accessibility. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Mini window remains usable at supported display scale; stop acts on the displayed run and voice respects mic/retention policy.
- **Full functional verification:** Stream provider response, open at Win100/150/200% and macOS Retina, move displays, cancel/dictate, switch focus and expand.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-074.3] Create Note from mini draft

**Assessment:** createNote/saveNote path exists; must reconcile with newer native Notes authority.

**Code references:** [apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx:13–105](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx#L13-L105).

- **Requirements:** Use enrolled scoped writer, exact draft content and valid receipt; keep mini draft on denied/uncertain creation and avoid duplicate Note on retry. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Created Note opens in correct workspace with canonical content after restart; successful expansion alone cannot imply saved Note.
- **Full functional verification:** Create with multiline draft, drop save ACK, revoke writer, switch workspace mid-create, retry/restart and compare Note count/content/receipts.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

### [UI-075] Unified Tables v2 shared product across 23 hosts

**Assessment:** UTB01 reference codec exists; v2 grid/formula/23-host product is specified, not delivered.

**Code references:** [packages/core/src/bases/table-surface.ts:1–90](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/packages/core/src/bases/table-surface.ts#L1-L90); [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Implement all PRD S01–S23 hosts, shared definition/data owner contracts, field/property/formula UI, live/snapshot modes, ACL/provider actions, serialization and performance gates. Preserve source work instead of rewriting the implemented codec. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** All mandatory product gates G00–G10 and host/operator suites pass at one bound release source; no unavailable required backend/host or historical codec result is counted as product PASS.
- **Full functional verification:** Run required Note→comment→standalone→Doc round trip and restart/second client; exercise every host below, all roles/channels and required dangerous ACL combinations; compare canonical definition/data/provider receipts.
- **Test method:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40) defines required lanes/receipts. New host/owner/native/browser/provider/performance suites are required; historical 54 reference tests cover only the inert codec.

#### [UI-075.1] Inert references and version/capability boundaries

**Assessment:** Type/reference validator implemented; PR1318 supplies stricter own-data boundary separately.

**Code references:** [packages/core/src/bases/table-surface.ts:1–90](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/packages/core/src/bases/table-surface.ts#L1-L90).

- **Requirements:** Integrate strict reference validation without activating unknown versions; forbid embedded rows/secrets/grants/executable code and require same workspace/entity revision/source query identity. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Codec preserves valid v1 reference metadata only; malformed/foreign/accessor/prototype data and unknown version remain inert, never provider actions.
- **Full functional verification:** Round-trip each host/mode metadata, mutate own data/accessors/prototypes/version/ACL/source refs and pass through every serialization boundary.
- **Test method:** Existing UTB entry points: `bun test packages/core/src/bases/__tests__/table-surface.test.ts packages/core/src/bases/__tests__/surface-capabilities.test.ts`; run PR1318 strictness tests on integrated source plus host serializer negatives.

#### [UI-075.2] Canonical definition/data owners and restart round trip

**Assessment:** Owner/host v2 integration remains specified.

**Code references:** [packages/core/src/bases/table-surface.ts:1–90](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/packages/core/src/bases/table-surface.ts#L1-L90); [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Separate definition/data/snapshot storage and authorization; implement schema/value subscriptions, revision/CAS, migration, recovery and owner-certified capability routes. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Same live table remains one canonical dataset across host copies; snapshot is immutable; restart/second client and revocation cannot manufacture or leak rows.
- **Full functional verification:** Create in Note, reference from comment/standalone/Doc, edit permitted fields from another client, restart both, revoke one audience and verify subscriptions/export denial.
- **Test method:** New owner contract/integration suite with real persistent store and two actor clients; exact rows/schema/revisions/receipts and process-loss recovery evidence required.

#### [UI-075.3] Unified Tables host: Standalone Tables

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Create/manage reusable definitions, views and live datasets; preserve URL/deep-link and export. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Create table and view, open via direct route, edit, reload/restart and inspect canonical rows. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.4] Unified Tables host: Notes collection

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project Note frontmatter/properties with identity-safe row create/edit/delete and collection filters. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Edit a frontmatter cell, create/delete Note, filter/group/sort and compare retained source plus owner revision. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.5] Unified Tables host: Note body blocks

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Insert live/snapshot table reference into retained Note block without duplicating dataset. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Embed, edit/reorder block, copy reference, save/restart and resolve same table ID/rows. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.6] Unified Tables host: Comments

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Respect comment audience and author rights for embedded table; restricted data never inherits wider thread visibility. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Embed in private/public thread, change audience, read as guest and verify forbidden field/action/export denial. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.7] Unified Tables host: Docs

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Render reusable table reference in document with durable block/source identity and permitted edit. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Paste Note table into Doc, save/reopen/second client and verify owner rows/revision. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.8] Unified Tables host: Pages

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Bind generated page table to explicit grants; sandbox cannot exceed data/field/action policy. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Publish page with editor/viewer/guest grants, exercise rows/actions and revoke while iframe live. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.9] Unified Tables host: Sessions

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Attach/reference table to scoped session context without uncontrolled AI write permission. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Open in two sessions/workspaces, run read-only and authorized write agent actions and verify actor/receipt scope. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.10] Unified Tables host: Chat and messages

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Serialize table card/reference consistently across messages, clipboard and shared transcript. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Send/copy/reopen card, revoke source, read public transcript and prove restricted values/actions absent. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.11] Unified Tables host: Tasks

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project canonical tasks/checklists/relationships/status and permitted owner mutations. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Edit status/property in grid, complete via Tasks screen, restart and verify same scoped task owner/ACK. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.12] Unified Tables host: Projects

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project project properties/Roadmap/OKR/task relations with correct local/shared authority distinction. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Edit permitted project field, link task/milestone, compare Roadmap/OKR/shared detail and second-client owner. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.13] Unified Tables host: CRM

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Implement provider-backed contacts/company/deal/activity schema, write capabilities and uncertainty/recovery. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Read/update authorized record, lose provider ACK, retry same command and verify no duplicated activity or false success. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.14] Unified Tables host: Dossier

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Expose person/entity dossier properties and relations under dossier owner ACL. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Edit permitted dossier field, add relation, revoke entity access and compare owner/read/export. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.15] Unified Tables host: Inbox and Mail

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project messages/decision queues; external message fields remain owner-limited and provider actions separately authorized. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Read/filter messages, change allowed flag/archive, attempt forbidden content edit and inspect provider confirmation. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.16] Unified Tables host: Feed

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project feed items/source metadata without granting mutation of remote origin content. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Filter/star/read allowed item, refresh source, attempt prohibited remote edit and inspect persisted preference versus source. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.17] Unified Tables host: Meetings

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project recordings/transcripts/participants/actions with recording/consent policy and scoped Note/task conversion. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Inspect recording rows, create permitted action item, revoke recording grant and deny audio/transcript export. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.18] Unified Tables host: Calendar

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project events/timezones/recurrence/provider status without treating local projection as external sync. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Create/edit supported event, cross DST, refresh authorized provider and inspect canonical external/local identity. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.19] Unified Tables host: Files

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project file/asset metadata and permitted upload/download/rename under host filesystem/server owner. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Upload/rename/download locked/excluded file, change folder scope and compare bytes/hash plus negative path traversal. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.20] Unified Tables host: Agents and Memory

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project agent runs/budgets/lessons under engine/memory owner; side effects require explicit capability. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Update supported lesson, inspect run budget, attempt forbidden cost/secret edit and compare owner/engine policy. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.21] Unified Tables host: Home

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Render configurable dashboard tables with widget scope/empty/unavailable/action semantics. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Add/reorder dashboard table, switch workspace, edit permitted row and reload/restart layout plus owner data. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.22] Unified Tables host: Conation Dashboard

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Connect advertised Conation dataset contract and identity instead of fabricated demo rows. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Authenticate two scoped actors, load real dataset, mutate authorized field and verify external owner/readback/revoke. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.23] Unified Tables host: Canvas, Graph, Outline and MindMap

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Expose consistent table reference blocks/nodes/projections in each of the four views with stable identity. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Embed/reorder/link table independently in Canvas, Graph, Outline and MindMap; switch/reopen and compare definition ID/rows. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.24] Unified Tables host: Forms and public apps

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Map submit fields through validation/ACL/workflow; guest cannot read hidden fields or execute unauthorized Button. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Submit public form, fail validation, retry lost response, tamper hidden/derived field and inspect canonical row/provider receipt. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.25] Unified Tables host: People and organizations

**Assessment:** v2 host requirement; no full host implementation/acceptance inferred from UTB01.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Project directory/membership/role properties with real identity owner and restricted admin mutations. Certify exact route, active feature policy, owner, create/reference/read/edit/action capability, schema/value subscriptions, serialization and audience. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Every advertised host action has positive canonical proof; denied/unavailable/unsupported actions have explicit negative proof. Shared live identity, safe snapshot behavior, restart and second-client access remain correct.
- **Full functional verification:** Edit allowed profile, invite/change role/revoke, read as member/guest and verify canonical membership plus field filtering. Repeat editor/viewer/service-agent/guest, ACL revocation and transport loss on A/B/C.
- **Test method:** New dedicated host adapter and actual mounted UI suite; retain owner/provider readback, source/hash/revision and negative ACL controls. No host is accepted solely by shared codec tests.

#### [UI-075.26] Shared grid editing, views and interaction

**Assessment:** v2 grid UI/UX planned; existing Notes table is narrower.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Implement shared cell/row selection, keyboard clipboard, virtualization, sorting/filter/group/hide/reorder/resize/frozen columns, bulk edit, undo and view persistence. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Actions operate on intended current authorized rows/fields with accessible feedback; partial failures/retries and undo preserve canonical state.
- **Full functional verification:** Use large mixed-type grid, IME/multiline paste, keyboard range selection, reorder/hide and bulk edit under concurrent data updates, then restart.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-075.27] Field/property types and relation schema

**Assessment:** v2 property model planned.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Implement required field types, relation/lookups/rollups, schema editing, validation, conversion/migration and hidden/readonly policy at every channel. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Schema/value mutations retain IDs and data correctly; incompatible conversions need review; forbidden field cannot leak via relation/clipboard/export.
- **Full functional verification:** Create every required type, convert invalid data, rename/delete referenced field, inspect relations/rollups from restricted actor and compare schema/rows.
- **Test method:** New field/schema migration and ACL property tests plus every supported host positive/negative UI workflow with owner revisions.

#### [UI-075.28] Formula engine, derived dependency policies and errors

**Assessment:** v2 formula engine/functions required beyond reference codec.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Implement specified formula/operator/function/type/date/error behavior, deterministic evaluation, cycle detection and dependency ACL; no formula can execute arbitrary host/provider code. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** All required functions and dependent formulas match independent expected values; restricted dependencies never reveal derived values to forbidden actor.
- **Full functional verification:** Evaluate every required operator/function, null/type/error/large-chain/cycle/DST cases; hide one dependency and test viewer/agent/export/frame channels.
- **Test method:** New formula conformance/property/performance suites against independent expected vectors; actual host derived-field UI and denied-dependency probes.

#### [UI-075.29] Buttons, automations, provider actions and recovery

**Assessment:** v2 provider-action product gates pending.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Keep table edits/derived fields separate from explicit actions; validate actor/field/provider capability, operation identity, retry/cancel/recovery and uncertain receipts. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No action executes through merely viewing, pasting or formula evaluation; committed/pending/uncertain/denied outcomes agree with actual provider/owner.
- **Full functional verification:** Press authorized Button once, lose response, retry/cancel/restart; attempt guest/agent forged scope and verify provider effects/counts.
- **Test method:** New real authorized provider action suite and process-loss negative controls; exact operation receipts/provider readback, not mocked toast success.

#### [UI-075.30] Performance budgets, accessibility and cross-target parity

**Assessment:** Published numerical budgets are targets, not measurements.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Measure specified rows/columns/formula/realtime/export/host payload budgets and memory; implement virtualization, keyboard/screen-reader/RTL/zoom/touch parity. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** All declared budgets pass on specified hardware/browser with reproducible artifacts; no inaccessible required action or platform-specific corruption remains.
- **Full functional verification:** Benchmark required fixtures and all four view/embedded layouts, slow network, high DPI/zoom,12 locales/Arabic RTL and screen readers; compare owner results.
- **Test method:** New standalone reproducible performance benchmarks plus native/Chromium/WebKit/Firefox accessibility workflow gates; record hardware/runtime/source/hash/time/memory.

#### [UI-075.31] Native owner/provider route certification and independent gates

**Assessment:** v2 requires explicit owner routes and independent review.

**Code references:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40).

- **Requirements:** Certify each host/native adapter/provider route with exact capability/actor/storage owner; integrate full DATA_SHARED and G00–G10 matrix without turning SKIPPED/NOT_RUN into PASS. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Matrix includes actual positive required operations, negative forbidden operations and independent review with bound source; every required blocker resolved.
- **Full functional verification:** Run full required multi-host/multi-client/restart/crash/provider flow, all role/channel danger combinations and reviewer replay from fresh fixture.
- **Test method:** [docs/unified-tables/VERIFICATION-GATES-V2.md:1–40](https://github.com/rox-one/rox-one/blob/8619f908bcdb7784b7b75fe0ae48f4f8902910bd/docs/unified-tables/VERIFICATION-GATES-V2.md#L1-L40) defines evidence schema; new orchestration/replay manifest must retain all attempts, failures, owner receipts and actual release binding.

### [UI-076] License evidence in Server settings

**Assessment:** Added in latest Compound after cloud input; absent original settings inventory.

**Code references:** [apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx:14–100](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx#L14-L100); [apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx:205–245](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx#L205-L245).

- **Requirements:** Integrate licensed component list/detail/history and verified audit intent/receipt UX under bound authority actor/workspace; preserve unconfigured/offline/denied/uncertain states. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Owner-confirmed components/history/audit receipts appear only for authorized current actor; denied data is retracted, and queued intent is never labeled verified.
- **Full functional verification:** Configure authority, page/select component/history, submit audit online/offline, lose ACK/restart/replay, revoke role while detail visible and compare canonical event/receipt.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-076.1] List/detail/history paging and denial retraction

**Assessment:** Paging/history and retractDenied source exists.

**Code references:** [apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx:14–100](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx#L14-L100).

- **Requirements:** Fence generation/scope on list/detail/history/focus refresh; validate entity/workspace/cursor/event aggregate revision and clear rows on forbidden/auth failure. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** No old actor/workspace component/history/receipt remains visible after denial; paging does not duplicate/drop event identity.
- **Full functional verification:** Open multiple pages/events, delay detail and switch workspace, change user/revoke permission, focus window and inspect immediate cleared state.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

#### [UI-076.2] Audit command intent, replay and verified readback

**Assessment:** Audit intent/result/readback/event validators exist.

**Code references:** [apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx:100–190](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx#L100-L190).

- **Requirements:** Bind command/intent to authority workspace/entity/revision/actor; show queued/uncertain/blocked; accept only verified receipt/readback/event sequence. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** One audit creates exactly one confirmed owner event or an honest unresolved state; forged/stale/wrong-scope reply cannot show verified.
- **Full functional verification:** Submit offline, drop response after commit, restart/replay, inject forged event/receipt and stale aggregate revision, revoke scope before retry.
- **Test method:** Existing synthetic license domain entry point: `bun test tests/macro-integration/wp-48-domain.test.ts` with its PostgreSQL/runtime prerequisites; new license-intent UI suite required plus new actual settings→authority audit workflow with real canonical event/receipt readback.

#### [UI-076.3] Settings placement, capabilities and platform custody

**Assessment:** Mounted twice for server-mode layout variants in latest Compound.

**Code references:** [apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx:14–100](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/LicenseEvidencePanel.tsx#L14-L100); [apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx:205–245](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx#L205-L245).

- **Requirements:** Verify intended server settings modes/deep links and capability absence; preserve main-owned encrypted intents/credentials on native and safe hosted actor/session contract. Target coverage: A Windows 10/11, B macOS, C hosted web under the target contract above.
- **DoD:** Each supported settings mode exposes one usable panel; unsupported mode shows accurate unavailable state without invoking missing RPC or leaking credential/event data.
- **Full functional verification:** Open all server modes with/without capability, switch workspace/actor during operation, reload/restart and compare native versus hosted status and safe persistence.
- **Test method:** Add a new Playwright/Electron behavior suite for this named workflow; exercise the actual released route with enrolled native/backend owner data on A/B and authenticated deployed transport on C. Preserve source SHA, expected/observed results, owner readback, restart proof and denied/stale negative controls.

## [SURFACE-WIP] Additional uncommitted surfaces discovered read-only

The following source files are untracked in the preserved Compound worktree. The JSON records actual file SHA256/line count/status. Pinned links below point to **committed companion contracts**, not to the uncommitted component. No route mount, backend adapter, test execution or release acceptance is assumed from these files. Local components are credited as WIP implementation. The preserved primary checkout also has two dirty CSS fixes (viewer Tailwind source glob and closing the shared style header comment) overlapping separately published sidebar/styling repair; this is recorded without another runtime-completion claim. Uncommitted keyboard controlFocus fixes preserve native-control Tab/Shift+Tab; compact full-width library/Projects changes add visible content/scroll/wrapping. These are included in original UI001/UI020/UI061/UI064 progress.


### [UI-077] Drive library, authorized content index and import review

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/drive/DriveLibrary.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/drive/DriveLibrary.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/core/src/docs/content-descriptor.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/core/src/docs/content-descriptor.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Integrate DriveLibrary/Rail/Table/ViewSettings/ImportReview with a real actor/workspace authorized-library owner. page-artifacts fallback supports all scope only; it is not common ACL/preferences authority. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** All/Recent/Owned/Shared/Favorites, content kinds, create/open/delete/upload and preferences work only through certified owner capabilities; no fabricated body/grant/scanner data.
- **Full functional verification:** Seed actual artifacts/documents/files with differing grants, browse each scope, create/open/upload/delete permitted kinds, restart and revoke one row while selected.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-077.1] Identity, filters, facets, paging and stale cursors

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/drive/DriveLibrary.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/drive/DriveLibrary.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/core/src/docs/content-descriptor.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/core/src/docs/content-descriptor.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Use registry contentEntityKey/Rox2EntityRef, projectionVersion and snapshot revision/actor/policy binding; verify search/type/owner/location/project/sort and cursor invalidation. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Rows deduplicate by owner identity; conflicting same-version projection/foreign workspace/stale cursor rejected; filters/facets/counts reflect authorized snapshot.
- **Full functional verification:** Use duplicate projections, identical names, stale revision/cursor and A→B actor/workspace changes; query each filter and inspect exact owner row set.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-077.2] Favorites and persisted view settings

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/drive/LibraryViewSettings.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/drive/LibraryViewSettings.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/core/src/docs/content-descriptor.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/core/src/docs/content-descriptor.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Bind favorites and view fields/sort/type/width to shared actor/workspace/device preferences owner; validate favorite receipt and discard stale optimistic overlay. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Favorites commit only matching actor/ref/value/preferenceRevision; failed/late commit restores correct snapshot; view survives restart without foreign preferences.
- **Full functional verification:** Favorite/unfavorite, lose ACK/retry, switch actor/snapshot mid-request, reorder columns/change table/grid view and reopen on second client.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-077.3] Table/grid metadata actions and responsive access

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/drive/DriveTable.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/drive/DriveTable.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/core/src/docs/content-descriptor.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/core/src/docs/content-descriptor.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Mount both layout modes, create artifact/document/open/delete supported representations with proper capability and stable selection; preserve metadata-only limitation. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Every visible action resolves intended owner/ref and unsupported kinds are disabled with reason; no overflow/inaccessible action at compact/high DPI.
- **Full functional verification:** Create both content kinds, open each representation, delete permitted artifact, deny file mutation and test keyboard/touch/zoom/narrow library with real owner readback.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-077.4] Multipart import, checksum/scanner/quarantine and resume

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/drive/LibraryImportReview.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/drive/LibraryImportReview.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/core/src/docs/content-descriptor.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/core/src/docs/content-descriptor.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Provide common durable File metadata/upload owner; monotonic upload revision/bytes/parts, verified checksum, real scanner result/native permission and immutable quarantined state. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Ready/open is possible only when bytes/checksum/scan/permission and all parts agree; reload restores owner upload session; error/retry cannot erase unresolved failed parts.
- **Full functional verification:** Import clean/corrupt/malware/denied files, fail one part, retry/resume/restart, forge progress/identity/checksum and verify quarantine/open denial.
- **Test method:** Untracked tests/rox-suite/drive-library.spec.ts and library-index.test.ts must be reviewed/committed; add real multipart/scanner/native file owner integration and actual UI workflow.

### [UI-078] Messenger conversation shell and tools

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/messenger/MessengerSurface.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/messenger/MessengerSurface.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/workspace-domain/identity/contracts.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/workspace-domain/identity/contracts.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Integrate scoped Channel conversation list/read/timeline/composer and tool drawers with authenticated shared command/query owner; preserve distinction from agent SessionStore. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Actual owner-backed channels/messages and create flow work with correct actor/workspace/ref; view preferences do not grant membership or fabricate read receipts.
- **Full functional verification:** Browse/create authorized conversation, send/read messages/thread, open all drawers, navigate compact/back/direct link, reload/restart and revoke channel.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-078.1] Conversation list/search/filter and cancellation

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/messenger/ConversationList.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/messenger/ConversationList.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/workspace-domain/identity/contracts.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/workspace-domain/identity/contracts.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Verify channel ref/type/workspace, search length/debounce/AbortSignal plus late-response fence, paging and list error/denied/empty state; owner invalidates every page/facet on revoke. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** No stale query/actor/workspace preview appears; denied selected channel disappears immediately from list and timeline.
- **Full functional verification:** Search rapidly, cancel ignored transport, page/revoke selected row, switch workspace/actor and restart saved filter/query/scroll.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-078.2] Timeline/composer/thread creation and durable preferences

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/messenger/MessengerSurface.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/messenger/MessengerSurface.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/workspace-domain/identity/contracts.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/workspace-domain/identity/contracts.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Supply real authorized renderTimeline/renderComposer/create host flows and persist selected ref/thread/query/filter/scroll/list width through preferences owner. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Message send/receipt/thread effects have canonical shared owner confirmation; selected state survives supported restart and cannot recreate revoked channels.
- **Full functional verification:** Send thread message, drop/retry ACK, change selected channel during operation, back/reload/deep-link and inspect owner/history/preferences.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-078.3] Search/tasks/pinned/settings drawers and responsive keys

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/messenger/ConversationTools.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/messenger/ConversationTools.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/workspace-domain/identity/contracts.ts:1–90](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/workspace-domain/identity/contracts.ts#L1-L90). This reference does not publish or certify the WIP component.

- **Requirements:** Implement each drawer under current channel capability; close/retract on revoke/channel switch; preserve focus/Escape, slash/N/AltLeft/IME and compact panes. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Each allowed tool works against owner data; denied tool never renders protected content; focus returns correctly and no shortcut fires inside editor/IME.
- **Full functional verification:** Exercise four drawers independently, revoke while open, switch channel, test toolbar/Escape and narrow/broad layouts with native/browser keys.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

### [UI-079] Meetings landing actions and history/detail presentation

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/meetings/MeetingsLanding.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/meetings/MeetingsLanding.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [apps/electron/src/renderer/pages/MeetingsPage.tsx:1–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/MeetingsPage.tsx#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Integrate landing over existing local meeting adapter; online/join/schedule/screen remain explicitly unavailable until real capability exists. Local summaries must not imply provider minutes/ASR completion. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Record/import/local-plan/minutes actions and history/detail work through existing owner with truthful availability; unsupported live/calendar actions remain visibly denied.
- **Full functional verification:** Open landing on each target, inspect eight tiles/help, record/import/plan/filter minutes, open recording/detail/back and compare owner statuses.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-079.1] Action tiles, help and capability denials

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/meetings/MeetingActionTile.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/meetings/MeetingActionTile.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [apps/electron/src/renderer/pages/MeetingsPage.tsx:1–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/MeetingsPage.tsx#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Verify online/join/schedule/screen/minutes/record/import/local-plan individually; help never invokes command; unavailable/busy reason is visible and accessible. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** No unsupported tile invokes backend; all supported tiles execute correct owner action once and present result/error honestly.
- **Full functional verification:** Click/help/keyboard every tile with available/unavailable/busy recorder/provider states; inspect exact backend command count and screen-reader announcement.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-079.2] Responsive history/detail and focus restoration

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/meetings/MeetingsLanding.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/meetings/MeetingsLanding.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [apps/electron/src/renderer/pages/MeetingsPage.tsx:1–110](https://github.com/rox-one/rox-one/blob/de805e0dc7103b49d4c7f0a092d88c8b4222367a/apps/electron/src/renderer/pages/MeetingsPage.tsx#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Preserve existing history query/buckets/row IDs and recording state; switch detail layout at supported widths; restore focus to source row/history after close. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** No hidden/clipped active recording/error/details action; close restores connected prior element or history; unsupported minute filters do not fabricate rows.
- **Full functional verification:** Start/pause/stop recording, open detail, resize narrow/wide, delete prior row and close; inspect focus/order/history and canonical state.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

### [UI-080] Organization Admin Hub local scope and shared foundation

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/orgs/types.ts:1–75](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/orgs/types.ts#L1-L75). This reference does not publish or certify the WIP component.

- **Requirements:** Integrate four views overview/members/capabilities/audit into Organizations. Current WIP DTO explicitly describes local single-device authority; shared admin requires accepted workspace foundation and actor/capability binding. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Local durable role action remains clearly local; actual shared claims only follow authenticated foundation/role/audit/readback proof. Unsupported metrics/capabilities/audit are truthful.
- **Full functional verification:** Open four views as local/admin/member/denied actor, preview/apply role, refresh/focus/reload, revoke and compare local versus shared authoritative result.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-080.1] Overview, metrics freshness and tab navigation

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/orgs/types.ts:1–75](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/orgs/types.ts#L1-L75). This reference does not publish or certify the WIP component.

- **Requirements:** Verify organization summary/asOf, local-only notice, explicit unavailable metrics, help, tab roving focus/Arrow/Home/End and scope retraction. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Summary never survives wrong org/denial; no invented metric value; each tab keyboard/help is usable at all target widths.
- **Full functional verification:** Load overview, defer reply then switch org, refresh/focus/revoke and traverse all tabs with keyboard/screen reader.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-080.2] Members role preview/apply, stale revision and last owner

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/orgs/types.ts:1–75](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/orgs/types.ts#L1-L75). This reference does not publish or certify the WIP component.

- **Requirements:** Require canChangeRoles/membershipRevision, exact preview/input user/org/role, explicit apply and durable readback; retain draft on conflict without silent rebase and forbid last owner demotion. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Role saved only when result/local durable readback matches actor/scope/entity/role; stale/denied/last-owner errors cannot change membership or show saved.
- **Full functional verification:** Preview each supported role, concurrent change, last-owner demotion, forged result/readback failure, org switch during submit and restart; compare membership owner.
- **Test method:** Untracked tests/rox-suite/admin-hub.spec.ts is a WIP entry; add real local-store and authenticated shared-admin actor/receipt integration, native/browser workflow and negative last-owner/revision controls.

#### [UI-080.3] Capabilities and audit views with shared actor foundation

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/pages/settings/OrganizationAdminHub.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/orgs/types.ts:1–75](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/orgs/types.ts#L1-L75). This reference does not publish or certify the WIP component.

- **Requirements:** Supply accepted realtime/policyEpoch, authorized capability inventory and immutable role/admin event history; keep foundation_unavailable while only local DTO exists. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Shared capabilities/audit view reads real policy/events with correct actor/org and revocation; no local granted flag is treated as authority.
- **Full functional verification:** Observe real role event on second client, revoke role while capability/audit visible, reconnect/restart and verify policyEpoch/event owner plus denied read.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

### [UI-081] Automation canvas node palette and inspector

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/automations/NodePalette.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/automations/NodePalette.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/automations/graph.ts:1–110](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/automations/graph.ts#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Integrate local authoring history, palette insertion/edge edits, inspector Apply/conflict and graph validation with revision-safe automation owner. WIP explicitly supports legacy execution only. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Supported scheduler/event/prompt/webhook and metadata node edits round-trip correctly; unavailable future runtime kinds cannot become executable through UI or receipts.
- **Full functional verification:** Create graph via palette, split edges, edit fields, undo/redo/save/reload, attempt unsupported node kinds and compare compiled owner graph/runtime effects.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

#### [UI-081.1] All palette kinds, edges, revision and undo/redo

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/automations/NodePalette.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/automations/NodePalette.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/automations/graph.ts:1–110](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/automations/graph.ts#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Verify scheduler/event/prompt/webhook/annotation/group/decision and unavailable dateTimeHelper/condition/entityCommand/connector/approvalWait individually; validate edge kind, identity and stale revision. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Supported insert/move/replace/remove/connect/disconnect retains legacy matcher/actions/IDs; unsupported/incompatible/stale/denied edit emits correct diagnostic without mutation.
- **Full functional verification:** Exercise every kind, protected node/edge deletion, flow split, undo/redo and stale/writable false controls; compare exact graph revision and compiler output.
- **Test method:** Untracked tests/rox-suite/automations/canvas.spec.ts is WIP; existing packages/shared/src/automations/graph.test.ts plus new mounted palette operation regression and actual save/runtime readback.

#### [UI-081.2] Buffered inspector fields, conflict and retained secrets

**Assessment:** Uncommitted source present; integration and full acceptance pending.

**Observed WIP source:** [apps/electron/src/renderer/components/automations/NodeInspector.tsx](/Users/t/Projects/rox-one-compound-implementation/apps/electron/src/renderer/components/automations/NodeInspector.tsx); hash/status recorded in surface-review.json.

**Code references:** Committed companion contract: [packages/shared/src/automations/graph.ts:1–110](https://github.com/rox-one/rox-one/blob/d141e962185fd808f177a2d01760b211f47f0832/packages/shared/src/automations/graph.ts#L1-L110). This reference does not publish or certify the WIP component.

- **Requirements:** Verify label/text/expression/prompt/url/cron/timezone/matcher/name/enabled per applicable node; buffer partial invalid input until Apply, preserve conditions/auth/body/permissions/IDs, refuse same-ID changed-node overwrite. Target coverage: A Windows 10/11, B macOS, C hosted web with native/browser capabilities declared explicitly.
- **DoD:** Cancel/invalid/conflict edit does not replace graph or leak secrets; valid Apply changes only allowed fields; metadata node deletion is deliberate and recoverable.
- **Full functional verification:** Edit each node kind, enter partial URL, change underlying same-ID node, reload fields, Apply/cancel/delete and compare full retained owner graph including secret references.
- **Test method:** New integrated Playwright/Electron behavior suite on actual released route with authorized owner adapters, A/B native and C deployed browser; assert canonical readback, restart/revoke/late-response negative controls. Existing untracked tests are WIP, not passing evidence.

## [SURFACE-RECHECK] Required integration handoff

The original UI tasks retain their acceptance in full. New tasks above add missing feature granularity; none removes existing release work. Before marking any item complete, record the integrated candidate SHA/lockfile, exact target/runtime, fixture/actor/enrollment, exercised route/action, independent owner/provider readback, restart/process-loss result and negative controls. Use the separate integration/test backlog for joint gates.

This document-only pass read committed source, PR/evidence packets and root path inventory; it changed no runtime/product code or live workspace data. Its verification checks task coverage, pinned path/line existence and four acceptance fields. It does not certify an installed Windows/macOS release or a public production hosted deployment.
