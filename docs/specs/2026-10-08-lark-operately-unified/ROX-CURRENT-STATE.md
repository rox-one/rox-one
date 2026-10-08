# Rox current-state audit (input to the unified Lark + Operately PRD)

> **v2 note (08.10.2026):** the audit's findings are unchanged. Since the audit, the unified spec v2 decided that all Rox files live in `~/rox` (ADR-U13; TECH-SPEC §10). The audit observed both `~/.rox` and `~/rox` in use (`resolveConfigDir()` prefers `~/rox` only if it exists).

- **Repo:** `rox-one/rox-one`, local read-only clone `/workspace/rox-one-ref` (never pushed, working tree clean)
- **Commit audited:** `aedff592b926dc1a2b6004f66ee3a864b6b8285e` (main, 2026-10-08 01:33:52 MSK, "fix(platform): widen InspectorActionRail panel routes; fixture typecheck")
  - The audit started at `87fbeb5` (01:21 MSK). It was re-pulled before writing.
  - The 4 commits in between change only the shell default and SE contract docs. The main one is `b95c711` "restore unified shell master default OFF".
- **Prepared:** 2026-10-08 ~01:40 MSK by Grok Bot, step 1 of the unified-spec phase. This document is not the unified spec.
- **Status legend**
  - **SHIPPED:** wired into the default app, with real persistence.
  - **PARTIAL:** real code, but with gaps, fixtures or limited scope.
  - **FLAG-OFF:** code exists, but a flag defaults it to off.
  - **STUB:** UI or types only, with no live backend.
  - **PLANNED:** exists only in docs, specs or issues.
- All paths are relative to the repo root.

---

## 0. TL;DR for the merge step

1. **Rox is a local-first, single-user desktop app.**
   - It is an Electron + Bun monorepo that forked craft-agents-oss.
   - It runs a local WS-RPC server: `packages/server-core`.
   - Nearly every domain store is files or SQLite under the config dir (`~/.rox` or `~/rox`) and `{configDir}/workspaces/{id}/`.
   - The only multi-user server, `apps/workspace-service`, is Postgres and contains only principal/workspace/member/project/license tables. It has no messages, docs, tasks or calendar.
2. **Tasks.** There are 4 task-like things today:
   - (a) **Personal tasks:** Things-3 clone, SHIPPED, `packages/core/src/tasks/personal`. This is the one Lark Tasks must extend.
   - (b) **Conductor DAG `tasks:*`:** workflow runner over sessions, canonical name `WorkflowSpec/WorkflowRun`.
   - (c) **Session kanban fields** on `SessionHeader`: `kanbanColumn/priority/dueDate`.
   - (d) **Agent-Teams task DAG** (`.agent-teams/`).
   - ADR-0001 forbids extending `Session` for user tasks and names the canonical future aggregate `WorkItem`.
   - The Phase-2 Lark TECH-SPEC proposed a parallel `tasks/shared` + `20-task.sql`. That **contradicts Mark's "one task list" requirement and must be reworked.**
3. **Notes.**
   - Notes are a **Markdown vault**: `{workspace}/notes/**/*.md` with YAML frontmatter.
   - Editing uses the **TipTap** editor, with WikiLink, HashTag, `rox:comment` markers, Mermaid, LaTeX and columns.
   - A rebuildable SQLite index (`.craft/vault-index.sqlite`) holds FTS5, wikilinks/backlinks, blocks, tasks, entities, session_refs and calendar_refs.
   - There is an optional native journal with CAS revisions.
   - Note views: document/table/base/canvas/outline/graph.
   - This is the base for "notes == Lark Docs". The Phase-2 spec's separate Postgres `doc` + Yjs store would be a **second content authority**, which ADR-0001 and the lark-suite-reference forbid ("never two writers").
4. **Already exists and must be reused, not re-specced:**
   - Project **OKR** (`okr.json`: cycles/objectives/KRs with weights and measurements).
   - Project **roadmap** with milestones that link personal-task ids.
   - **Decisions** log.
   - **Dossier**: people and companies.
   - **Pages**: agent-built dashboards.
   - Local **Meetings** with Whisper transcription.
   - **Stalwart/JMAP Mail** pilot.
   - **Feed / Inbox** aggregators.
   - **Team** model: comments, mentions, assignments, handoffs, approvals, activity, outbox.
   - **Rox2 entity refs** (`kind:id`, 21 kinds, 8 relation kinds).
   - Lark/Telegram/Discord/WhatsApp/WeChat **messaging gateway**, which binds external chats to AI sessions.
5. **Missing entirely:**
   - human-to-human Messenger/IM;
   - shared Docs/Wiki spaces/Drive;
   - a Calendar UI and live calendar adapters (only fixture/unavailable adapters exist);
   - Base persistence (only the TableSurface codec exists);
   - Forms; Workplace launcher; Contacts directory (only orgs.json members);
   - multi-user sync (the team outbox reports `org-server-required`);
   - realtime collaboration, ACL, server-side search.
6. **Hard constraints** (§9):
   - no second runtime/orchestrator/workbench;
   - no Cordis host; no Timeline/inspector DAG for agent-teams;
   - no generic "Entity DB", no full bidirectional metadata sync;
   - no own or forked block editor (SiYuan rule);
   - domain state must not live in Jotai/localStorage;
   - every mutation is versioned, command-driven and receipt-backed;
   - User task ≠ Session; CalendarEvent ≠ Meeting; ActivityEvent ≠ Notification;
   - unified-shell master is **default OFF**; Conation flags are all default false;
   - i18n in 12 locales with ru as default;
   - existing `rox-suite` GitHub issues #1091–#1120 and Unified Tables epic #1295 already cover parts of the Lark scope.

---

## 1. Architecture and runtime map

| Layer | Where | Notes |
|---|---|---|
| Desktop shell | `apps/electron` (Electron 39.2.7, React, Vite, Tailwind, Radix, jotai) | Main: `src/main/*` (deep links, mail bridge, notifications, meetings capture, SSH tunnel). Renderer: `src/renderer/*`. |
| Web UI | `apps/webui/src/App.tsx` | Thin wrapper: creates a web API adapter, sets `window.electronAPI`, lazy-loads the Electron renderer `App`. Same surfaces, gated by `WEBUI_REQUIRES_CONATION_FLAG` (`pages/rox2-webui-surface.ts`). |
| Local backend | `packages/server-core` (+ `packages/server` for the VPS host) | `WsRpcServer` (`src/transport/server.ts`): WebSocket RPC with handshake, heartbeat, push routing, event buffer. Bound to 127.0.0.1 with no auth locally, and to 0.0.0.0 with auth remotely. Handlers in `src/handlers/rpc/*.ts` (~100 files). Channels in `packages/shared/src/protocol/channels.ts`. |
| Domain libraries | `packages/core` (renderer-safe), `packages/shared` (node and storage) | Tasks, docs, bases, calendar, meetings, mindmap, knowledge, rox2 contract, platform registries; projects, sessions, mail, team, collaboration, orgs, pages, feed, automations, i18n. |
| Native sidecar | `native/` (Rust crates `craft-exec`, `craft-index`, `craft-journal`, `craft-protocol`, `craft-rund`; app `craft-native`) | `CRAFT_FEATURE_NATIVE_SIDECAR` (default off), plus `..._JOURNAL_PRIMARY` and `..._INDEX_PRIMARY`. Journal = SQLite CAS journal (`packages/server-core/src/authority/native-journal.ts`). |
| Multi-user authority | `apps/workspace-service` (Postgres; `http.ts` regex router `/v1/workspaces/:ws/(commands/...\|projects\|events\|identity\|licenses)`) | Modules: identity, collaboration (invitations, session-publication-registry), licenses. Migrations `01-domain-contract.sql`, `01-local-auth-bootstrap.sql`, `48-license-audit.sql` (checksum-bound, `src/database/migrations.ts`). |
| Agent runtime | OMP (`packages/shared/src/agent/omp-agent.ts`) | Single agent runtime (AGENTS.md). Sessions = AI chats. Conductor DAG = `packages/server-core/src/tasks/TaskRunner.ts`. |
| Cloud | `apps/cloud-gateway` (CF Worker + DO), `apps/modal-gateway`, `packages/cloud-runner` (Daytona default since 2026-10-07) | Cloud Runs. |
| Other apps | `apps/cli`, `apps/viewer` (shared transcript viewer), `apps/ios` (`CraftAgentKit`/`CraftAgentsApp`) | |
| Messaging bridges | `packages/messaging-gateway` (+ `messaging-discord-worker`, `messaging-whatsapp-worker`) | Adapters: lark, telegram, discord, whatsapp, wechat. |

**Config and data roots**
- `resolveConfigDir()` lives in `packages/shared/src/config/env.ts`. It uses `ROX_CONFIG_DIR`, falling back to the deprecated `CRAFT_CONFIG_DIR`. Otherwise it prefers `~/rox` if that exists, else `~/.rox` (`ROX_CONFIG_DIR_NAME='.rox'` in `identity/manifest.ts`), with one-time import from `~/.craft-agent`.
- Policy doc: `docs/plans/2026-10-07-rox-visible-config-migration.md`.
- Workspaces live under `{configDir}/workspaces/{id}/`, containing sessions, notes, projects, pages, labels, statuses, sources, skills and `.craft/*.sqlite` indices.

---

## 2. Surfaces, pages and routes

### 2.1 Navigation sources of truth

- **Routes:** `apps/electron/src/shared/routes.ts` (306 lines, typed builders) and `apps/electron/src/shared/route-parser.ts` (1,789 lines, `COMPOUND_ROUTE_PREFIXES`).
- **`NavigatorType`:** sessions, sources, skills, notes, search, automations, projects, pages, settings, browser, memory, tasks, meetings, feed, inbox, connections, home.
  - Parsed navigators add knowledge, cloud-run, extension, diff, terminal and screen.
- **Mode rail (titlebar pill / left rail):** `apps/electron/src/renderer/platform/modes-seed.ts`. In order:

  | Mode | Order | Route | Flag |
  |---|---|---|---|
  | home | 10 | — | — |
  | chat | 20 | allSessions | — |
  | meetings | 30 | — | `workbench.mode.meetings.v1` |
  | tasks | 40 | — | `workbench.mode.tasks.v1` |
  | notes | 50 | — | — |
  | feed | 60 | — | `workbench.mode.feed.v1` |
  | inbox | 70 | — | `workbench.mode.inbox.v1` |

  All four mode flags default ON (`packages/core/src/platform/workbench/flags.ts`).
- **Extra screens ("Ещё" rail group):** `pages/extra-screens/registry.ts`. Dossier, radar, decisions, agents and focus, each behind `workbench.mode.<id>.v1` (default ON, `extra-screen-flags.ts`).
- **Native rail surfaces:** `pages/rox2-native-surfaces.ts`. `NATIVE_RAIL_SURFACE_IDS` = projects, pages, memory, tasks, sources, skills, automations, connections. The file comment says "Drive/Mail/CRM are not claimed live here".
- **Screen map for UI review:** `docs/design/rox-screen-map-ru.md` (2026-10-07).
  - Left mode rail.
  - Centre panel-stack.
  - Right action rail (+session, task, event, note, browser; pin, terminal, hide).
  - Inspector: session files/git/context, browser.
  - Bottom terminal dock.
- **Deep links:** `rox://` (primary) and `craftagents://` (legacy), registered in `apps/electron/electron-builder.yml`.
  - Parser: `apps/electron/src/main/deep-link.ts`.
  - Compound routes: `rox://{tasks|notes|meetings|projects|...}/...`.
  - Actions: `rox://action/{new-chat|delete-session|flag-session|...}`.
  - Workspace targeting: `rox://workspace/{id}/...`.

### 2.2 Surface inventory

| # | Surface (RU label) | Route(s) | Files | What it does | Status |
|---|---|---|---|---|---|
| 1 | Home / Главная | `home` | `platform/HomeFrontPage.tsx`, `platform/home/*`, `home-model.ts`, `mini-dashboard.ts` | Hub / empty-project front page, quick task input, mini dashboard | SHIPPED |
| 2 | Chat / Сессии (AI sessions) | `allSessions`, `flagged`, `archived`, `state/{id}`, `label/{id}`, `view/{id}`, `.../session/{id}` | `pages/ChatPage.tsx`, `chat-rox2-surface.ts` | Agent conversations (OMP), statuses, labels, flags, branching, side threads, sharing via viewer | SHIPPED (core product) |
| 3 | Session board / table / heatmap | `board`, `table`, `heatmap` | `packages/shared/src/sessions/collection*.ts`, `packages/shared/src/kanban/` | Kanban of sessions (`kanbanColumn`, `rank`, per-project columns), table, activity heatmap | SHIPPED |
| 4 | Tasks / Задачи | `tasks`, `tasks/task/{id}` | `pages/TasksPage.tsx`, `pages/tasks/*` | Things-3-style personal task manager (§3.1) | SHIPPED (personal, single-user) |
| 5 | Notes / Заметки | `notes`, `notes/note/{id}` | `pages/NotesPage.tsx`, `pages/notes/*` (NotesViewHost, NoteInspector, NotesAIMenu, VaultInsightsPanel, VaultIndexHealthPanel, wiki-autocomplete, comment-highlights, note-views) | Markdown vault + TipTap editor + views (§3.2) | SHIPPED (local); collaboration not built |
| 6 | Meetings / Встречи | `meetings` (+ detail) | `pages/MeetingsPage.tsx`, `pages/meetings/*` (MeetingsSidebar, ConationPanels) | Local meetings: mic capture/import, on-device Whisper, analysis via an explicitly started agent session, proposals → tasks/notes. "Live rooms and system-audio capture are absent." | PARTIAL (local only, no VC) |
| 7 | Inbox / Входящие | `inbox` | `pages/InboxPage.tsx`, `pages/inbox/{inbox-model.ts, InboxSidebar.tsx, mail/*}` | "Everything waiting on me": permissions, credentials, plans, memory and skill proposals, new messenger senders, unread agent replies, errors, mail, team recipient requests. Views: all / decisions / messages / snoozed / done | SHIPPED (aggregator) |
| 7a | Mail (inside Inbox: Входящие → Почта) | inbox mail view | `pages/inbox/mail/*`, `apps/electron/src/main/mail/{mail-service,mail-model,local-ipc}.ts`, `packages/shared/src/mail/*` | JMAP client to a local Stalwart pilot (§3.9) | PARTIAL (local dev pilot, loopback only, outbound disabled) |
| 8 | Feed / Лента | `feed` | `pages/FeedPage.tsx`, `pages/feed/*`, `packages/shared/src/feed/*`, `handlers/rpc/feed.ts` | Tabs: agent actions, team, news (RSS/Atom/page diff), subscriptions (X timeline with user token). Annotate (color/tags/star/read); send to Tasks/Notes | SHIPPED |
| 9 | Projects / Проекты | `projects`, `projects/{slug}` (+ roadmap) | `pages/ProjectInfoPage.tsx`, `pages/ProjectRoadmapPage.tsx`, `pages/project/{ProjectTimeline,ProjectRequirements,ProjectInputs,ProjectAiPanel,roadmap-ui}.tsx`, `components/projects/*` | Workspace projects: sessions, working dir, assets, MEMORY.md, custom kanban columns, **OKR**, **roadmap** (goal, DoD, milestones → personal-task ids, requirements, risks, questions), AI roadmap (clarify/spec/improve), shared-project projection to workspace-service | SHIPPED (local); server projection PARTIAL |
| 10 | Pages / Страницы | `pages`, `pages/page/{slug}` | `packages/core/src/types/page.ts`, `packages/shared/src/pages/*`, `handlers/rpc/pages.ts` | Agent-authored mini dashboards: sandboxed iframe HTML + refresh scripts + `snapshot.json` + mediated action bridge; Share (`CRAFT_FEATURE_PAGES_SHARING`, opt-out) | SHIPPED |
| 11 | Memory / Память | `memory` | `packages/server-core/src/memory/*` (MemoryService, LessonStore, MemoryProposalStore, fts-index, episodic, decay) | Agent memory, lessons, proposals, FTS | SHIPPED |
| 12 | Sources / Источники | `sources/{api\|mcp\|local}/...` | `pages/SourceInfoPage.tsx`, `packages/shared/src/sources`, `server-core/src/sources/source-index.ts` | MCP/API/local sources; per-workspace FTS index | SHIPPED |
| 13 | Skills / Навыки | `skills` | `pages/SkillInfoPage.tsx`, `SkillsCatalogPage.tsx` | 330-skill catalog, OMP skill sync | SHIPPED |
| 14 | Automations / Автоматизации | `automations/{scheduled\|event\|agentic}` | `packages/shared/src/automations/*`, `handlers/rpc/automations*.ts` | Cron/event/agentic automations, graph editor, retry scheduler, occurrence ledger, webhooks | SHIPPED (no durable step executor; RS-AUT-01..05 planned) |
| 15 | Connections / Подключения | `connections` | `pages/ConnectionsPage.tsx`, `connections-*.ts`, `IntegrationsCatalogPage.tsx` | OAuth/provider connections (Google, Microsoft, Slack, GitHub, ...), integrations catalog | SHIPPED |
| 16 | Knowledge (SiYuan) | `knowledge/{kind}/{id}`, `knowledgeView` | `pages/KnowledgeSurfacePage.tsx`, `KnowledgeEntityPage.tsx`, `packages/core/src/knowledge/providers/siyuan/*`, `server-core/src/knowledge/*` | External-local SiYuan (mode A) via `knowledge:*` RPC; deep links; mutation proposals; work envelopes | PARTIAL (managed kernel P7 blocked; G2 licensing OPEN; `docs/product/2026-08-13-notes-siyuan-still-blocked.md`) |
| 17 | Search / Поиск | `search` | `pages/SearchPage.tsx`, `platform/Omnibox*.tsx` | Notes search (vault FTS5) + session content search (`sessions:searchContent`); Omnibox ⌘K | SHIPPED (local) |
| 18 | Browser | `browser`, inspector browser pane | `pages/BrowserPanelPage.tsx`, `components/session-inspector/InspectorBrowserPane.tsx` | Embedded browser surface, cookie import | SHIPPED |
| 19 | Terminal | `terminal` | `pages/TerminalSurfacePage.tsx`, `platform/terminal-xterm.tsx` | xterm panel; Ghostty spike blocked (`docs/plans/ghostty-terminal-spike.md`) | PARTIAL |
| 20 | Cloud runs | `cloud-run/{id}` | `pages/CloudRunSurfacePage.tsx`, settings CloudRuns | Daytona-backed runs | PARTIAL |
| 21 | Extension surfaces | `extension/{id}` | `pages/ExtensionSurfacePage.tsx` | Broker-capability extensions | PARTIAL |
| 22 | Diff / proposals | `diff/{id}` | route builder `proposal` | ChangeProposal review | PARTIAL |
| 23 | Screen | `screen/...` | `packages/shared/src/design-manifest` | Design-manifest screens | PARTIAL |
| 24 | Settings | `settings/{subpage}` | `pages/settings/*` | Runtime, AI, Cloud runs, Appearance (kanban status, tool icons, workbench toggles), Zen shell, Security, Marketplace, Messaging, ... | SHIPPED |
| 25 | Dossier / Досье | extra screen | `pages/extra-screens/dossier/*` | People/companies cards; touches from sessions, meetings, tasks, notes; agent "before the call" brief | SHIPPED (renderer localStorage) |
| 26 | Radar / Радар | extra screen | `pages/extra-screens/radar/*` | Topics/competitors; daily read-only agent sweep; digest → task / reply draft | SHIPPED (renderer localStorage) |
| 27 | Decisions / Решения | extra screen | `pages/extra-screens/decisions/*` | Decision log (what/why/who/when/source); extraction from session/meeting; accepted → workspace memory lessons (rejected options → MUST NOT rules) | SHIPPED (renderer localStorage + memory lessons) |
| 28 | Agent center / Центр агентов | extra screen | `pages/extra-screens/agents/*` | All agents and background runs: waiting, running, stuck, cloud, automations, budget; stop/pause | SHIPPED |
| 29 | Focus / Фокус | extra screen | `pages/extra-screens/focus/*` | Day on one screen: calendar + meetings, top-3 tasks, inbox, deep-work timer; "Итоги дня" into the daily note | SHIPPED (calendar part relies on fixture/unavailable adapters) |
| 30 | Shortcuts | — | `pages/ShortcutsPage.tsx` | | SHIPPED |
| 31 | Conation surfaces (Soup / Notes bridge / Drive / Canvas / Board / Mail / Cal / DSS / Session-apply) | `platform/conation/*`, `pages/meetings/ConationPanels.tsx` | `packages/core/src/conation/*` | Read-only clients to the external Conation data plane (Soup GraphQL, DSS) | FLAG-OFF (all `workbench.conation.*` default false) |
| 32 | Webui | same routes | `apps/webui` | Browser host of the same renderer | PARTIAL |
| 33 | iOS | — | `apps/ios` | Companion app | PARTIAL / out of scope here |
| — | **Messenger (human IM)** | none | — | Only `packages/messaging-gateway` bridges external chats to AI sessions; no human channels/DM UI | **PLANNED** (RS-MSG-01/02 #1106/#1107) |
| — | **Contacts** | none | `packages/shared/src/orgs` (orgs.json members), Dossier | No directory surface | **PLANNED** (RS-MSG-03 #1108) |
| — | **Calendar** | none (no route) | `packages/core/src/calendar/*`, `components/calendar/CalendarStatusStrip` | Types, merge, occurrences, store; adapters = `FixtureCalendarAdapter` / `UnavailableCalendarAdapter` only | **STUB** (RS-MTG-03 #1103 planned) |
| — | **Docs / Wiki / Drive** | none | — | — | **PLANNED** (RS-DRV-01 #1109, RS-DOC-01 #1110, RS-WIKI-01 #1111, RS-NOTE-01 #1112) |
| — | **Base** | none (inside notes: view kind `base`/`table`) | `packages/core/src/bases/*` (TableSurface v1 codec), `pages/notes/note-views.ts` | Reference-only `rox-table` contract; client-side note views with 4 fixed formulas | **STUB** (Unified Tables epic #1295, draft PR #1314; RS-BASE-01 #1094) |
| — | **Forms** | none | — | — | **PLANNED** (RS-FORM-01 #1095) |
| — | **OKR (org-level)** | none | Project-scoped OKR exists inside Projects | Org/personal OKR alignment absent | PARTIAL via Projects |
| — | **Workplace** | none | Pages, IntegrationsCatalog, Home | No app launcher | **PLANNED** (by analogy; RS-ADM-01 admin hub #1114) |
| — | Sheets, Slides, Help Desk, Approvals, Signing | none | — | — | **PLANNED** (#1092, #1093, #1115–#1120) |

### 2.3 Shell / navigation state (five-slot unified shell)

- **Spec:** `docs/specs/2026-08-07-unified-shell/00–10`.
  - RAIL 48 / NAVIGATOR 220–260 / COLLECTION 280–380 / MAIN ≥640 / INSPECTOR 320–420, plus a status bar.
  - SurfaceRegistry: `packages/core/src/platform/surfaces/{types,descriptor,registry,host}.ts`.
  - PanelHost slots: activity, navigator-primary/secondary, inspector, bottom, status.
- **Verdict:** `docs/unified-shell-verdict.md` (2026-08-13) says **KEEP_EXPERIMENTAL**.
- **Master flag:** `featureUnifiedShellAtom` in `apps/electron/src/renderer/atoms/unified-shell.ts:111`, localStorage `craft-feature-unified-shell`.
  - It is **default `false`** at HEAD.
  - It was flipped to true in `5fd37d9` (2026-10-07 23:20 MSK) and reverted in `b95c711` (2026-10-08 01:28 MSK): "Zen-shell acceptance and PRD require featureUnifiedShellAtom default false so Rox classic layout stays default."
- `featureWorkbenchAtom` defaults to false.
- **Granular `workbench.*` flags default ON (P35-08):** mode registry, top chrome v2, tab groups v2, browser surface v2, status bar, panel registry v2, terminal, `execution.coordinator.v1`, harness inspector / chat chrome / agent intel / ext center / agentTeams.
- **Inspector:** `platform/inspector-model.ts`.
  - Knowledge live sections = `['browser']` only (info removed).
  - Session sections = files, git, browser, context.
  - Agent/outline/backlinks sections are not live.
  - `inspectorVisibleAtom` defaults to false.
- **Right action rail:** `platform/InspectorActionRail.tsx` (new 2026-10-07). New session, task, event, note, browser; terminal; collapse.
- **Shell plan wave T-00..T-21:** `docs/plans/2026-10-07-rox-shell-cloud-platform.md`. All done except T-20 Ghostty (blocked).
- **ADR-0001** (`docs/architecture/adr/0001-rox-workbench-convergence.md`): Mode ≠ Surface ≠ Tab ≠ Panel; WorkbenchLayout v2 (TabGroups) is a parallel seam; URL/NavigationContext is the source of truth for the focused surface.
- **Shell-width conflict carried from Phase 2:** Lark filter column 148px < NAVIGATOR minimum 220px.

### 2.4 Design tokens and typography

- **Tokens:** `packages/ui/src/styles/index.css` (~354 custom properties). Key groups:
  - **Base colors:** `--background`, `--foreground`, `--accent` (oklch 0.58 0.16 250), `--info`, `--success`, `--destructive`.
  - **Surfaces:** `--canvas`, `--paper`, `--navigator`, `--input-surface`, `--surface-{canvas,elevated,rail,input,popover}`.
  - **Borders and text:** `--border-subtle/strong`, `--text-primary/secondary/muted`.
  - **Status:** `--status-{neutral,info,running,success,warning,danger}`.
  - **Shadows:** `--shadow-*`.
  - **Fonts:** `--font-sans` = "Inter", system stack (Inter is default since T-10); `--font-mono` = "Rox"; `--font-chat` / `--font-default` alias sans.
- Super-engineering parity contracts: `docs/design/super-engineering-spec.md`, `docs/design/se-wave{1,2}-contract.json`.
- Design-manifest compiler: `packages/shared/src/design-manifest/{schema,compiler}.ts` (v1, `SCREEN_ID_RE`, module/component caps).

### 2.5 i18n

- Rules: AGENTS.md §"Стек и воркфлоу".
- 12 locales in `packages/shared/src/i18n/locales/`: ar, de, en, es, fr, hu, ja, ko, pl, ru, zh-Hans, zh-Hant.
- ru is the default UI language; `fallbackLng: ['ru','en']`.
- Every new key goes into all 12 files, ASCII-sorted. Parity test: `bun test packages/shared/src/i18n`.
- Russian plurals use `_one/_few/_many`, plus `_other`.
- User-authored names (project names, kanban columns) are not translated.

---

## 3. Entities and data model

### 3.1 TASKS (in depth): what Lark Tasks must build on

#### 3.1.1 Personal tasks: the canonical user task list

- **Domain:** `packages/core/src/tasks/personal/`.
  - `types.ts`
  - `store.ts`: `PersonalTaskStore`, 723 lines
  - `projections.ts`, `quick-entry.ts` (RU/EN natural-language dates), `dates.ts`, `cache.ts`, `rpc.ts`, `import-validation.ts`, `things.test.ts`

**Types**
- `TaskListId` = `inbox | today | upcoming | anytime | someday`. Projections add `logbook`, `trash`; filters add `all`.
- Sort: `order | due | priority | project | title`.
- Priority: `none | low | medium | high`.
- `TaskLinkKind` = `note | session | message | workflowRun | meeting | feed | mail | decision`. A `TaskLink` is `{id, kind, label?}`.
- `Recurrence` = `{rule: daily|weekly|monthly|yearly, interval, weekdays?, mode?: fixed|after, until?, timeZone?}`.

**`PersonalTask` fields**
- Identity and placement: `id`, `title`, `notes` (plain text/markdown string), `list`, `projectId?`, `areaId?`, `headingId?`, `parentId?`.
- Classification: `tags[]`, `priority`.
- Dates: `dueAt?`, `startAt?`, `evening`, `recurrence?`.
- Links: `links[]`.
- Ordering and lifecycle: `order`, `createdAt`, `completedAt?`, `cancelledAt?`.
- Checklist: `checklist?[] {id,title,done}`.
- Reminders: `reminderAt?`, `reminderTimeZone?`, `reminderDeliveredFor?`, `reminderRetryAt?`, `reminderError?: permission-denied|permission-required|presentation-failed`.
- Trash: `trashedAt?`.
- Provenance and repeats: `source?: TaskLink`, `repeatOf?`, `repeatOccurrenceAt?`, `repeatNextId?`.
- `updatedAt?`.

**Containers and bundle**
- `TaskProject {id, name, areaId?, order, notes?, deadlineAt?, completedAt?, trashedAt?, createdAt}`. This is a **Things project**, distinct from the workspace Project in §3.4.
- `TaskArea {id, name, order, collapsed?, trashedAt?}`.
- `TaskHeading {id, title, projectId, order}`.
- `TaskAuditEvent`.
- `PersonalTaskBundle v1 {tasks, projects, areas, headings, audit}`.
- Projections: `todayPlan`, `upcomingByDay`, `projectProgress`, tags, search, `tasksLinkedTo(link)` (reverse links).

**Persistence**
- Canonical: `packages/server-core/src/tasks/personal-persist.ts`, `PersonalTaskPersistStore`.
  - `{root}/personal-tasks/<id>.json` = `{id, revision, task}`, plus meta (projects/areas/headings/audit) and a migration marker.
  - Writes use tmp+rename with per-record locks.
  - Revision is a monotonic integer; `putIfRevision` returns `conflict` on a stale `expectedRevision`.
  - `PERSONAL_TASK_SCHEMA_VERSION = 2` (Things fields).
  - Root = **config dir (personal scope, not per workspace)**. The file comment reads "not the DAG `tasks/` tree".
- Service: `packages/server-core/src/tasks/personal-tasks-service.ts`.
- RPC: `handlers/rpc/personal-tasks.ts`, `native-personal-tasks.ts` (workspace-scoped `NativePersonalTaskScope {principal, workspaceId, rootPath}`).
- Channels at `packages/shared/src/protocol/channels.ts:912-917`: `personalTasks:{list,put,delete,migrate,changed}`.
- Optimistic concurrency: `VersionedPersonalTask {task, revision}`, conflicts/rejected lists.
- Renderer: `apps/electron/src/renderer/lib/personal-tasks-sync.ts`.
  - localStorage `rox.personal-tasks.v1` (+ `.quarantine`, `.staging`) is a read-through cache and one-time migration source; the server copy wins.
  - Bridge for extra screens: `lib/extra-screens/personal-task-bridge.ts`.

**UI:** `pages/TasksPage.tsx`, `pages/tasks/{TaskSidebar,TaskDetail,QuickEntry,MoveDialog,atoms,task-model,parts,delegation-errors,use-task-detail-drafts}`.
- Lists: Входящие, Сегодня (+ Этот вечер), Планы, В любое время, Когда-нибудь, Журнал, Корзина.
- Areas → projects (progress pie, headings); tags.
- Keyboard-first: ⌘N Quick Entry, ⌘K move, ⌘T/⌘E, ⌘S, ⇧⌘D, ⌘D, ⌘⌫, ⌥↑/↓. Drag and drop across lists, projects, headings and days.
- Calendar status strip on today/upcoming.
- **"Поручить агенту"** creates a session (status «К выполнению», task as prompt) and links it back (`kind:"session"`). "Агенты" are selectors over live sessions.

**Consumers**
- Project roadmap milestones (`RoadmapMilestone.taskIds`).
- Meetings proposals (`create_task` → `server-core/src/meetings/native-actions.ts`).
- Feed and Radar "→ task".
- Focus top-3.
- Dossier touches.
- Product tour.
- Team model (`TeamTargetKind 'task'` for comments, assignments).
- Encrypted account replica category `tasks`.

**Things 3 mirror:** **not in the repo.** There is no Things.app import or sync code (searched for `things3|culturedcode|things.sqlite`).
- "Things-style" means a UX and data clone.
- `import-validation.ts` validates Rox's own bundle ("adapted from Golden's consumed task import guard").
- Any Things 3 ↔ Lark mirror is external to rox-one.

**Gaps for Lark Tasks**
- Single owner, no assignees/followers. Team assignments live separately in `team` state.
- No task comments or activity (audit only), no attachments, no custom fields.
- No shared task lists or sections; no workspace/server persistence.
- No Gantt/Kanban/table views of tasks (lists only).
- No origin-chat linkage beyond `TaskLink` kinds.
- Identity must become source-scoped `(sourceStoreId, ownerPrincipalId, nativeId)` per `docs/lark-suite-reference/07-domain-entity-model.md §2`.

#### 3.1.2 Other task-like aggregates (do not merge into user tasks)

| Aggregate | Where | Notes |
|---|---|---|
| Conductor DAG ("Tasks" in legacy naming) | `packages/server-core/src/tasks/TaskRunner.ts`, `create-task.ts`, `packages/shared/src/tasks`, channels `tasks:*` (`channels.ts:95`), files `{workspace}/tasks/<slug>/task.yaml` + `runs/<runId>/` | In-process DAG of child sessions. ADR-0001 renames it `WorkflowSpec/WorkflowRun`; RPC and dirs stay for now. Route comment: "Distinct from DAG Conductor tasks". |
| Session kanban | `SessionHeader.kanbanColumn/rank/priority/dueDate/taskSlug/taskRunId/taskNodeId/taskNodeCount/taskDraft` (`packages/shared/src/sessions/types.ts`) | Board view of sessions. UEW: "New task fields MUST NOT be added there". |
| Agent Teams | `packages/core/src/platform/agent-teams/{store,types}.ts`, `<workspace>/.agent-teams/<teamId>/team.json` + `inbox/<agentKey>.jsonl` | Roster + task DAG pointers. Flag `workbench.harness.agentTeams`: ADR-0019 and H-03 say default false, but code `flags.ts` has it default **true** (P35-08). Discrepancy. |
| Notes checkbox tasks | vault-index `tasks` table (document_id, line, checked, text) | Markdown `- [ ]` items, indexed only. |
| Meeting proposals | `MeetingProposal.type='create_task'` | Go through approve → execute into personal tasks. |

### 3.2 NOTES (in depth): what "notes == Lark Docs" must build on

**Canonical storage**
- Markdown files under the workspace notes root: `{workspaceRoot}/notes/**/*.md`.
  - Fallback: `{configDir}/workspaces/{id}/notes` (`packages/server-core/src/handlers/rpc/notes.ts`, 1,788 lines, constants `NOTES_DIR='notes'`, `assets`, `Daily`, `templates`, `projects`).
- YAML frontmatter is parsed with gray-matter / js-yaml. `ParsedNote = {properties, body, tags, links, assetRefs}`.
- Planned layout `~/ROX/Notes/{PARA..., Imports/...}`: `docs/specs/2026-08-10-rox-notes-root-imports-design.md`. Draft, implementation blocked.

**Native engine:** `packages/core/src/rox2/notes-engine.ts` (ROX-AUD-031).
- Local markdown + sidecar revisions.
- Saves require `expectedRevision`; a stale token conflicts.
- SiYuan is not required. Conation is only an adapter.

**Native journal (optional, flag):** `packages/server-core/src/authority/native-journal.ts`.
- SQLite CAS journal with `JournalMutation {principal, workspaceId, kind, nativeId, operationId, expectedRevision, schemaVersion, changes[]}` → `JournalReceipt {issuer, sequence, revision, contentHash, ...}`.
- Related, in `packages/server-core/src/docs/`: `markdown-commit.ts`, `descriptor-resolver.ts` (content descriptors / owners / policies), `block-tree-service.ts`, `legacy-markdown-migration-fence.ts`.
- Core doc primitives in `packages/core/src/docs/`: command-envelope, block-identity, frontmatter-patches, content-descriptor, property-dictionary, list-tree, retained-source.

**Repository:** `packages/core/src/rox2/notes-repository.ts`.
- `NoteOrigin = native|conation|hybrid`; `NoteSyncState = live|cached|stale|offline|denied`.
- Over Rox2 refs.

**DTOs** (`packages/shared/src/protocol/dto.ts:683-844`)
- `NoteLink {target, alias?, line}`.
- `NoteBacklink {noteId, title, path, line, preview}`.
- `NoteAsset {name, path, relativePath, size, mimeType, referencedBy?}`.
- `NoteSummary {id, title, path, relativePath, tags[], properties, links[], assetRefs[], updatedAt, createdAt, size}`.
- `NoteDocument extends NoteSummary {nativeId?, content, backlinks[], nativeRevision?, revision?, sourceStoreId?}`.
- `NoteMutationOptions {operationId, expectedRevision, schemaVersion:1}`.
- `NoteChangedPayload {workspaceId, eventId?, reason, noteId?}`.
- `NoteIndexHealth`, plus Vault insights types (broken links, entity merges, footnotes, named entities, link suggestions).

**RPC** (`channels.ts:204`): `notes:{list, read, save, create, prepareCreate, rename, move, delete, renameFolder, deleteFolder, search, getBacklinks, getInsights, getIndexHealth, getRenameImpact, getDailyNote, importAsset, listAssets, deleteAsset, renameAsset, updateProperties, rebuildIndex, watch, unwatch}`, plus content handlers.
- File watching with self-write suppression.
- Gamification XP on writes.

**Index:** `packages/server-core/src/knowledge/vault-index.ts`.
- File: `{notesRoot}/.craft/vault-index.sqlite`. Rebuildable; never writes `.md`.
- Tables:
  - `meta`
  - `documents(id, relative_path, title, hash, mtime, size, created_at, updated_at, body_text, properties_json, asset_refs_json)`
  - `aliases`, `tags`
  - `wikilinks(source_id, target, alias, heading, line, preview)`
  - `footnotes`
  - `blocks(document_id, block_id, line, text)`
  - `entities`, `entity_mentions`
  - `tasks`
  - `session_refs(document_id, session_id, line)`
  - `calendar_refs`
  - `documents_fts` (FTS5)
- Markdown parsing: `vault-markdown.ts`.

**Daily notes:** `knowledge/daily-notes.ts`.
- `Daily/` folder; template `templates/daily.md`.
- An auto-merged sessions block `<!-- rox:daily-sessions -->`.
- Focus "Итоги дня" upserts into it.

**Editor:** TipTap in `packages/ui/src/components/markdown/`.
- `TiptapMarkdownEditor.tsx`, bubble menus, slash menu.
- Extensions: `WikiLink`, `HashTag`, `MarkdownComment` (preserves `<!-- rox:comment ... -->...<!-- /rox:comment -->`), `MermaidBlock`, `LatexBlock`, `ColumnsBlock`, `TiptapImageBlock`, `AnimatedTaskItem`, `DocumentFolding`, `RichBlockInteractions`, `rox-block-syntax`.
- Renderer: `pages/notes/*`.
  - `NotesViewHost`, chrome variants (document/reading/workspace), `NoteInspector`, `NotesAIMenu` / `note-ai.ts`.
  - `wiki-autocomplete.ts`.
  - `comment-highlights.ts`: quote-anchored highlight comments `{id, quote, body}`.
  - `comment-drafts.ts`, `document-ia.ts`, `focus-state.ts`.

**Views:** `pages/notes/note-views.ts`.
- `NoteViewKind = document | table | base | canvas (JSON Canvas) | outline | graph`.
- `NoteBaseView v1 {filters, formulas (taskCount/openTaskCount/backlinkCount/tagCount), groupBy, sort, columns}`. Client-side.

**Mind map:** `packages/core/src/mindmap/*`.
- Projections entity → MindMapGraph from note, session and knowledge.
- Outline, layout, pin, session-scene-graph.
- RPC `mindmap:*` (`channels.ts:946`).
- Spec: `docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md`.

**Imports**
- `handlers/rpc/notes-import.ts`, `server-core/src/knowledge/notes-import.ts`, `notes-migration.ts`.
- `isImportProvenancedRelativePath` (`packages/shared/src/config`).
- Foreign **session** import: 18 kinds (grok, claude, codex, opencode, chatgpt, cursor, ...) in `packages/shared/src/sessions/import-*.ts`.

**Gaps for Lark Docs**
- No realtime co-editing (no Yjs/Hocuspocus).
- No server copy, ACL, sharing or permissions on notes.
- No version history UI beyond revisions.
- Comments are inline HTML-comment markers and local team comments, not durable anchored discussions.
- No Wiki spaces/tree or Drive library (Recent/Owned/Shared/Favorites).
- No export to docx/pdf.
- Rename/stamping may rewrite raw Markdown (flagged in lark-suite-reference "Главные gaps").
- Note views are client-only.

### 3.3 Sessions (AI chats) and agents

- **Storage:** `{workspace}/sessions/{id}/session.jsonl`. Line 1 is `SessionHeader`; the rest are messages.
  - OMP mirror at `sessions/{id}/omp`.
  - Optional journal shadow/primary: `packages/shared/src/sessions/journal-*.ts`.
- **`SessionHeader` key fields:**
  - Identity and placement: id, sdkSessionId, workspaceRootPath, name, createdAt, lastUsedAt, lastMessageAt.
  - Triage: isFlagged, sessionStatus (user-defined statuses, `packages/shared/src/statuses`), labels[] (`id` or `id::value`, `packages/shared/src/labels`), hasUnread, lastReadMessageId.
  - Runtime: permissionMode (safe/ask/allow-all), memoryMode, enabledSourceSlugs, workingDirectory, model, llmConnection, thinkingLevel.
  - Sharing: sharedUrl, sharedId.
  - Lifecycle: hidden, isArchived, archivedAt, triggeredBy.
  - Relations: projectId, projectIds, parentSessionId.
  - Board and task fields: kanbanColumn, rank, priority, dueDate, taskSlug, taskRunId, taskNodeId, taskNodeCount, taskDraft.
  - Counters and usage: messageCount, tokenUsage.
- Collections: `collection*.ts` (filters, heatmap, metrics, lexorank).
- Side threads: `packages/shared/src/side-threads`.
- Session publication to workspace-service: `apps/workspace-service/src/modules/collaboration/session-publication-registry.ts`, `packages/shared/src/collaboration/session-publication.ts`.
- **Agents**
  - The agent is the OMP runtime.
  - Agent identity: `packages/shared/src/identity/agent-identity.ts`.
  - Meeting agents: `packages/shared/src/meeting-agents/*`.
  - Agent center: extra screen.
  - Agent Teams store: §3.1.2.
  - There is no "agent as bot principal" in any IM.

### 3.4 Projects, OKR, roadmap (relevant to Operately goals/projects/milestones)

- **Files:** `{workspace}/projects/{slug}/`
  - `config.json` (`ProjectConfig`)
  - `roadmap.json` + `roadmap.md`
  - `okr.json`
  - `MEMORY.md`
  - `assets/`
  - Source: `packages/shared/src/projects/{types,storage,okr,roadmap,roadmap-storage,roadmap-ai}.ts`.
- **`ProjectConfig`:** `id, slug, name, description?, workingDirectory?, details?` (prompt context), `colorTheme?, color?, icon?, createdAt, updatedAt, archivedAt?, kanbanColumns?[] {id, name, dropStatusId?, color?}, repositoryConnection?, repositoryBindings?`.
- **OKR**
  - `ProjectOkrDocument {projectId, revision, cycles[]}`.
  - `OkrCycle {id, projectId, title, startDate, endDate, timezone, status: draft|published|archived, revision, objectives[], publishedAt?, archivedAt?}`.
  - `OkrObjective {id, title, description?, weight, owner?, keyResults[]}`.
  - `OkrKeyResult {id, title, weight, measurement, owner?, status?}`.
  - `measurement`:
    - numeric: direction, baseline, target, current|null, unit, evidence[], source, measuredAt, freshness;
    - binary: achieved|null, evidence[] ...
  - `OkrProgress {knownContribution, coverage, score|null}`. A missing score is deliberately distinct from zero.
  - Conflict: `ProjectOkrConflictError`.
  - RPC `projects:{getOkr,saveOkr}` (`handlers/rpc/projects.ts`).
  - UI is in `ProjectInfoPage.tsx`.
- **Roadmap:** `ProjectRoadmap v1`.
  - Top level: `goal, expectedResult, doneCriteria[], inputs[], milestones[], requirements[], risks[], openQuestions[], updatedAt, revision`.
  - `inputs[]` kinds: link|text|note|session|source.
  - `milestones[]`: `{id, title, description, status: planned|active|done|blocked, startDate?, dueDate?, stages[{substages[]}], taskIds[]}`. `taskIds` are personal task ids.
  - `requirements[]`: `{kind: functional|technical|quantitative|qualitative, text, acceptance[], milestoneId?}`.
  - AI modes clarify/spec/improve.
  - `ProjectTimeline.tsx` renders the roadmap timeline. This is not the forbidden agent-teams "Timeline".
- **Server projection:** `apps/workspace-service` `project` table plus `ProjectAuthorityConnectionPanel.tsx` and `SharedProjectProjection.tsx`.
  - Shared metadata only: name and visibility private|members.
- **Gaps vs Operately (for the merge step)**
  - No org/company-level goals or goal tree (OKR is project-scoped).
  - No check-ins/status updates with health, no discussions per project/goal.
  - No champions/reviewers roles, no work map across projects.
  - Milestones exist (roadmap) without comments or timeline events.

### 3.5 Meetings and calendar

- **Meetings model:** `packages/core/src/meetings/model.ts` (RMA-I001).
  - "Meeting is a specialization of Rox2 `call`, not an agent session."
  - `Meeting {schemaVersion, workspaceId, meetingId, entityId, revision, status, title, createdAt, updatedAt, archiveGranted, sourceBinding?{provider, accountId, remoteType, remoteId, remoteRevision}}`.
    - Statuses: planned, permission_required, capturing, paused, finalizing, completed, failed, cancelled.
  - `TranscriptSegment`, `EvidenceSpan`.
  - `MeetingProposal {type: create_task|create_note|knowledge_change|artifact|external, payloadHash, status, sourceSpans, baseRevisions, approvedBy...}`.
  - `OperationResultV2 {mode, lifecycle, verification, receipt}`.
- **Server:** `packages/server-core/src/meetings/*`.
  - Append-only `journal.ts` with CAS and dedupe, single writer per workspace dir.
  - Proposal and operation journals, outbox, capture, import, finalize, followup, retention, sharing, rooms, release-gate, verification.
  - `conation/*` adapters: calendar-calls, crm, files, mail-channels, notes-projects, board-fund.
  - RPC `meetings:*` (`channels.ts:1044`). Meeting planning: `handlers/rpc/meeting-planning.ts`.
- **Calendar:** `packages/core/src/calendar/{types,adapters,store,merge,occurrences,capabilities}.ts` (Issue 18). "Events never become personal tasks."
  - `CalendarProvider = google|outlook|yandex|mailru|appleReminders`.
  - `CalendarAccount {id, provider, displayName, status, scopedCalendarIds, timeZone, credentialRef}`.
  - `CalendarEvent {id, accountId, calendarId, title, startAt, endAt, allDay, timeZone, recurrence?, occurrenceId?, etag?, localDirty?, deleted, kind:'event'}`.
  - `ReminderProposal`, `CapabilityGap`.
  - **Adapters: `FixtureCalendarAdapter`, `UnavailableCalendarAdapter` only (no live).**
  - No calendar route or page. Conation calendar flag `workbench.conation.cal` is off.

### 3.6 Inbox, feed, notifications, team collaboration

- **Inbox:** `pages/inbox/inbox-model.ts`.
  - Pure aggregation.
  - `InboxKind = permission|credential|plan|memory|skill|sender|reply|error|mail|team-recipient`.
  - Groups: decision|message.
- **Feed:** `packages/shared/src/feed/*`, `handlers/rpc/feed.ts`, `native-feed.ts`.
  - Tabs: agents|team|news|subscriptions.
  - Item kinds: session, automation-run, team-activity, news, ...
- **Notifications:** `apps/electron/src/main/notifications.ts` (OS notify). Focus mode queues agent notifications.
- **Team model:** `packages/shared/src/team/*` (team.*.v1; flags `team.{presence,mentions,assign,comments,handoff,sharing,activity,approvals}.v1`, default ON).
  - `TeamTarget {kind: session|message|note|mapNode|task|automation, id, parentId?, title?, revision?}`.
  - `TeamLocalState v1 {comments, assignments, handoffs, access (view|comment|run), approvals, recipientRequests, recipientActions, activity, outbox}`.
  - `TeamInboxItem` kinds: mention|handoff|assign|approval|recipient-request.
  - Sync (`team/sync.ts`): "Rox has no multi-user team API yet". The local adapter reports `org-server-required` and keeps everything in the outbox.
- **Collaboration (sessions):** `packages/shared/src/collaboration/{presence,durable-store,conflict,invite,publication,session-publication,omp-map}.ts`; workspace-service invitations.
- **Orgs:** `packages/shared/src/orgs` (local `orgs.json`).
  - `OrgMember {orgId, userId, role, displayLabel?, username?, email?, joinedAt}`, `OrgInvite`.
  - This is the only people directory besides Dossier.

### 3.7 Pages, memory, decisions, dossier, radar

- **Pages:** §2.2 #10.
  - `{workspace}/pages/{slug}/{page.json, index.html, data/store.sqlite, data/snapshot.json}`.
  - `PageKind = static|interactive|live`.
  - This is the closest existing analogue to Workplace widgets.
- **Memory:** `packages/server-core/src/memory/*`. MemoryFileStore, LessonStore (decisions are injected as lessons), proposals, FTS, episodic, decay, provenance, skill-usage.
- **Dossier, Radar, Decisions**
  - Renderer `localStorage` via `apps/electron/src/renderer/lib/extra-screens/storage.ts` (`loadWorkspaceJson/saveWorkspaceJson`, namespaced per workspace). Decisions also write to memory lessons.
  - This is domain state in the renderer, which conflicts with ADR-0001 #9. Any unified-spec reuse needs a server-side owner.

### 3.8 Rox2 unified entity contract (the "unified model")

- **File:** `packages/core/src/rox2/platform-contract.ts`. A typed seam, with no I/O.
- **`ROX2_ENTITY_KINDS` (21):** session, note, task, project, page, memory, skill, source, automation, connection, file, mail-thread, calendar-event, crm-company, channel, channel-message, call, reminder, workflow, person, license-component.
- **Relations (8):** parent, mentions, blocks, assigned, in-calendar, derived-from, attached-to, member-of.
- **Permissions:** read, write, share, publish, spend, destroy, device-read, cloud-send.
- **Status triad:** `executionMode (live|fixture|simulated) × lifecycle (queued|running|waiting_approval|succeeded|failed|cancelled|unknown) × verification (unverified|receipt_verified|readback_verified)`.
  - `isClaimableLive` = live + succeeded + policy-verified.
  - Legacy `Rox2RunState` is deprecated.
- **Ids:** `formatRox2EntityId(kind,id)` → `kind:id`; `parseRox2EntityId`.
- **Actor:** `AuthenticatedActor {principalId, deviceId, sessionId, authenticatedWorkspaceIds, expiresAt}` is server-owned and never deserialized from bodies.
- **Other files:** `soup-native-actions`, `soup-document-actions`, `rpc-native-actions` (`rpc{Notes,Projects}{List,Read,Act}Result`), `conation-api`, `project-membership`, `surface-context`, `map-reduce`.
- **Soup / GraphQL**
  - `packages/core/src/conation/soup/{client,queries,types}.ts`: a **read-only** GraphQL client to the external Conation Soup (`SoupQueryRoot`; queries `SoupTypename`, `SoupUserPage`, `SoupUserGrouped`).
  - DSS: `conation/dss/*`, a read-only REST client (projects, entries, meta, content).
  - Both flag-off: `workbench.conation.soupClient`, `...dssClient`.
  - There is **no** in-repo GraphQL server or unified DB.

### 3.9 Mail (Stalwart / JMAP)

- **Client:** `packages/shared/src/mail/jmap-client.ts`.
  - RFC 8620/8621, single-origin enforcement, secrets never logged.
  - Also `stalwart-admin.ts` and `provisioning.ts`.
- **Main-process bridge:** `apps/electron/src/main/mail/mail-service.ts`.
  - Loopback-only admin provisioning with the admin credential from the Keychain.
  - Mailbox app password stored in the CredentialManager.
  - Also `mail-model.ts` and `local-ipc.ts`; IPC, not WS-RPC.
- **Pilot server:** `docs/mail-local-stalwart.md`. Stalwart Community v0.16.24 under `~/.rox/mail/`.
  - JMAP/HTTP on 127.0.0.1:8480; SMTP 2525; submission 2587; IMAP 1143.
  - Domain rox.one. No MX, no outbound.
- UI: Inbox → Почта.
- Licence: Stalwart is AGPL, so it stays a separate process reached only over JMAP.

### 3.10 Messaging gateway (the Lark bridge)

- **`packages/messaging-gateway/src/*`:** gateway, router, renderer, binding-store, pairing, access-control, pending-senders, plan-tokens, topic-registry, event-fanout, commands.
  - One instance per workspace, in-process with SessionManager.
  - It **binds external chats (DM / group @mention) to Rox AI sessions**. It is not a human messenger.
- **Lark adapter:** `adapters/lark/{index,card,format}.ts`, using `@larksuiteoapi/node-sdk` `WSClient` long-polling (no public webhook).
  - Phase 1: text DMs and group @mentions, replies, `/pair` commands.
  - Phase 2 code present: interactive cards with buttons (`LARK_MAX_BUTTONS`), edit-expiry handling, attachments, Markdown → post rich text.
- Other adapters: telegram, discord, whatsapp, wechat.
- RPC `messaging:*` (`channels.ts:954`).
- Inbox "new messenger senders" (`sender` kind); Dossier touches include messenger-bound sessions.

### 3.11 Sync, offline and replay mechanisms

| Mechanism | Where | What |
|---|---|---|
| Personal tasks CAS | `personal-persist.ts`, `personalTasks:*` | Integer revision per task, conflict results, localStorage cache + one-time migration |
| Notes CAS / journal | `rox2/notes-engine.ts`, `authority/native-journal.ts`, `NoteMutationOptions` | expectedRevision, operationId, receipts; journal-primary behind flag |
| Native replica outbox | `packages/shared/src/protocol/native-replica.ts` (`__nativeReplica:{open,enqueue,enqueueCreate,pending,acknowledge,close,cacheSnapshot,readSnapshot}`), `isNativeReplicaNetworkLoss` | Offline enqueue → ack on reconnect; snapshot cache. Create plans carry `recoverCreation` for unknown-result retries |
| Encrypted account replica | `packages/shared/src/account-replica/{replica,outbox,crypto,types}.ts` (issue 27) | Categories notes/tasks/sessions/settings (never credentials, cookies, passkeys). AES-256-GCM, device-wrapped account key, `SqliteReplicaOutbox`, `ReplicaOperation {seq, deviceId, nativeId, expectedRevision, changes[]}`, merge LWW / markdown |
| Team outbox | `packages/shared/src/team/{state,sync}.ts` | Local queue; `org-server-required` until a server exists |
| Meetings outbox/journal | `server-core/src/meetings/{journal,outbox,operation-journal}.ts` | CAS + dedupe + quarantine |
| Workspace-service outbox | `project_event`, `project_event_inbox`, `project_projection_watermark`, `project_query_cursor`, `project_create_receipt` | Transactional outbox/inbox, idempotent create receipts, server cursors |
| Claim semantics | `isClaimableLive` (rox2), OperationResultV2 verification | "Live" only with receipt/readback verification |
| Things 3 mirror | — | **Absent** from the repo |
| Lark bridge | messaging-gateway | Chat ↔ session only; no Lark Docs/Tasks/Calendar sync |

### 3.12 Workspace-service tables (complete list at HEAD)

- **`01-domain-contract.sql`**
  - `principal(principal_id, schema_version, revision, created_at, updated_at, deleted_at)`
  - `auth_subject_alias(issuer, subject → principal_id)`
  - `workspace(workspace_id, owner_principal_id, name, revision, policy_epoch, ...)`
  - `workspace_member(workspace_id, principal_id, role owner|member, revision, ...)`
  - `project(workspace_id, project_id, owner_principal_id, name, visibility private|members, revision, ...)`
  - `project_create_receipt(... idempotency_key, command_id, request_hash, observed_revision, result)`
  - `project_event(sequence, event_id, type workspace.member_joined|project.created, aggregate_revision, policy_epoch, causation_id, correlation_id, payload)`
  - `project_event_inbox`, `project_projection_watermark`, `project_query_cursor`
- **`01-local-auth-bootstrap.sql`:** `bootstrap_auth_credential`, `bootstrap_auth_session`.
- **`48-license-audit.sql`:** `license_component`, `license_audit_receipt`.
- **Implications for the unified spec**
  - The Phase-2 numbering `02-directory`...`52-mail` slots in around `48`.
  - Migrations are checksum-bound and additive.
  - Every new table should follow the same conventions: `schema_version`, `revision`, `policy_epoch`, receipts, `clock_timestamp()`.

---

## 4. Cross-linking mechanisms

| Mechanism | Where | Notes |
|---|---|---|
| Wiki links `[[target#heading]]` with alias | TipTap `WikiLink.ts`, `wiki-autocomplete.ts`, vault-index `wikilinks` | Note → note |
| Backlinks | vault-index, `notes:getBacklinks`, `NoteDocument.backlinks` | Inspector backlinks section not live in unified shell |
| Hashtags | `HashTag.ts`, vault `tags` | Notes; tasks have separate `tags[]` |
| Block ids | vault `blocks`, `packages/core/src/docs/block-identity.ts` | Stable anchors (LSX-WP-006 planned to harden) |
| Session refs / calendar refs in notes | vault `session_refs`, `calendar_refs`; daily-notes sessions block | |
| Chat mentions | `packages/shared/src/mentions/index.ts`: `[skill:slug]`, `[source:slug]`, `[file:path]`, `[folder:path]`, `[knowledge:siyuan/block/<id>]` | Agent-context mentions, not people |
| People mentions | `team/mentions.ts` (+ `team.mentions.v1`) | Local, queued |
| Task links | `TaskLink` kinds note, session, message, workflowRun, meeting, feed, mail, decision; `tasksLinkedTo` | Plus `source` provenance |
| Roadmap links | `RoadmapMilestone.taskIds`, `RoadmapInput` kinds note/session/source/link/text | |
| Rox2 entity refs | `kind:id`, 8 relation kinds | The unified ref primitive; recommended spine by lark-suite-reference |
| Knowledge refs | `packages/core/src/knowledge/refs.ts`, SiYuan deep links | |
| Deep links | `rox://...`, `craftagents://...` (`main/deep-link.ts`) | All renderer routes + actions |
| Meeting evidence | `EvidenceSpan` / `sourceSpans` on proposals | |
| Team targets | `TeamTarget {kind, id, parentId, revision}` | Comments/assign/handoff on session, message, note, mapNode, task, automation |

---

## 5. Realtime, auth and identity, search

- **Realtime**
  - Local WS-RPC push (`pushTyped`, `PushTarget`, event buffer, heartbeat) from server-core to the renderer.
  - `*:changed` pushes: `personalTasks:changed`, `pages:changed`, note watch.
  - JMAP EventSource for mail.
  - Lark WSClient for the bridge.
  - Presence is modelled (`collaboration/presence.ts`); ADR-0001 #12 requires it to be server-authoritative and ephemeral.
  - **No multi-user realtime fan-out exists.**
- **Auth / identity**
  - Desktop: provider OAuth in `packages/shared/src/auth/*` (Claude, ChatGPT, Google, Microsoft, Slack, GitHub Copilot, generic PKCE, OAuth relay).
  - Rox account: `rox-account-authority.ts`, `rox-cloud.ts`, `rox-connect-flow.ts`, `rox-pocket-client.ts`. PocketID / pocket-sso provisioning stub: `server-core/src/handlers/user-secrets-provision.ts`, `docs/plans/2026-10-07-secrets-model.md`.
  - Credentials: encrypted `credentials.enc` + Keychain; Infisical provider and identity broker/grants in `packages/core/src/platform/identity/*`.
  - Workspace-service: JWT verification (`src/auth/verified-actor.ts`; EdDSA/RS256/PS256/ES256) + local issuer bootstrap (`local-issuer.ts`) + Postgres identity (`postgres-identity.ts`).
  - Native authority principal: `server-core/src/authority/native-authority.ts`.
- **Search**
  - Notes: vault FTS5.
  - Sessions: `sessions:searchContent`.
  - Sources: `{workspace}/.craft/source-index.sqlite` (FTS5 or LIKE).
  - Memory: `memory/fts-index.ts`.
  - Fuzzy: `packages/shared/src/search/fuzzy.ts`.
  - Omnibox providers: `platform/omnibox-*.ts`.
  - **No cross-entity or server search index.**

---

## 6. Feature flags (defaults at HEAD)

| Family | Flags | Default | Source |
|---|---|---|---|
| Env flags | `CRAFT_FEATURE_DEVELOPER_FEEDBACK` (dev only), `CRAFT_FEATURE_CRAFT_AGENTS_CLI` off, `CRAFT_FEATURE_EMBEDDED_SERVER` off, `CRAFT_FEATURE_KNOWLEDGE` **on**, `CRAFT_FEATURE_NATIVE_SIDECAR` off, `..._NATIVE_JOURNAL_PRIMARY` off, `..._NATIVE_INDEX_PRIMARY` off, `..._NATIVE_INDEX_WATCH` off, `CRAFT_FEATURE_PAGES_SHARING` **on** (opt-out) | as listed | `packages/shared/src/feature-flags.ts` |
| Unified shell master | `featureUnifiedShellAtom` | **OFF** | `renderer/atoms/unified-shell.ts:111` |
| Workbench master | `featureWorkbenchAtom` | OFF | same file |
| Workbench granular | mode-registry, top-chrome v2, tab-groups v2, browser-surface v2, status-bar, panel-registry v2, terminal, `execution.coordinator.v1`, harness inspector/chat-chrome/agent-intel/ext-center, `workbench.harness.agentTeams` | ON (P35-08) | `packages/core/src/platform/workbench/flags.ts` |
| Mode screens | `workbench.mode.{tasks,meetings,inbox,feed}.v1` | ON | same |
| Extra screens | `workbench.mode.{dossier,radar,decisions,agents,focus}.v1` | ON | `extra-screen-flags.ts` |
| Conation | `workbench.conation.{shell,inspector,soupClient,notesBridge,driveRead,canvas,board,mail,cal,dssClient,sessionApply}`, `skills.conation.surfaces` | **OFF** ("All defaults are false") | `flags.ts`, `conation/shell/flags.ts`, `conation/notes/flags.ts` |
| Team | `team.{presence,mentions,assign,comments,handoff,sharing,activity,approvals}.v1` | ON | `packages/shared/src/team/flags.ts` |
| Rox2 native surfaces | `NATIVE_SURFACE_REQUIRES_CONATION_FLAG = false` | — | `pages/rox2-native-surfaces.ts` |

**Doc/code discrepancies to resolve in the unified spec**
- (1) `workbench.harness.agentTeams`: docs (ADR-0019, H-03) say default false; code has it true.
- (2) The parent brief's "flags default false" applies to Conation, the unified-shell master and the native/sidecar flags. Granular workbench, mode, extra-screen and team flags default **true**.
- **Recommendation:** new Lark/Operately surfaces ship behind new `workbench.mode.<id>.v1`-style flags. Whether they default false needs an explicit decision.

---

## 7. Docs and plans already in the repo that overlap the Lark/Operately scope

- `docs/lark-suite-reference/` (rev 2, 2026-09-30, baseline `e953786`):
  - 00 executive summary;
  - 01 live audit;
  - 02 core suite;
  - 05 Rox Bases design;
  - 06 Rox Docs design;
  - 07 entity model / ERD / authority boundaries;
  - 08 automation;
  - 09 implementation plan, with LSX-WP-001...015+ (page content descriptor; personal-task source bindings; atomic Markdown CAS; canonical Task field command; lossless Markdown patch; stable block anchors; BaseDefinition; NoteBaseView migration; source adapters Notes/Tasks/Projects/Meetings/Calendar; ACL query snapshots; 18 typed fields; formula engine; relations; lookup/rollup);
  - 10 test plan; 11 decisions; 12 critical review; 13–14 code intelligence; `issues/`.
  - Its stance: "Сохранить React/Electron/Tiptap, existing routes, note/task/project IDs и domain owners. Расширить Notes до **Rox Docs**, Base view adapters до **Rox Bases**". Its traps list: "Duplicate Task/Contact/Doc rows; mixed Markdown+JSON writers..."
- `docs/rox-suite/` (README, PRD, issue-drafts, published): 30 GitHub issues #1091–#1120. "UI не реализован".
  - Messenger #1106/#1107, Contacts #1108, Docs/Drive #1109, Docs #1110, Wiki #1111, Notes↔Drive #1112.
  - Base #1094, Forms #1095, Sheets #1092, Slides #1093.
  - Automations #1096–#1100, Meetings #1101–#1105.
  - MCP #1113, Admin hub #1114, Help desk #1115–#1116, Approvals #1117–#1118, Viewer/Signing #1119–#1120.
- `docs/unified-tables/` (PRD-V2, TECH-SPEC-V2, IMPLEMENTATION-PLAN-V2, VERIFICATION-GATES-V2): epic #1295, draft PR #1314.
  - 23 integration points.
  - First code slice `a428eb4` = TableSurface codec only. Gates NOT_RUN.
- Also relevant:
  - `docs/unfinished-initiatives.md` (1,154 lines), `docs/spec.md`, `docs/plan.md`;
  - `docs/product/2026-08-13-app-maturity.md`;
  - `docs/specs/2026-08-07-siyuan-integration`, `2026-08-11-rox-connection-fabric`, `2026-08-12-native-substrate`, `2026-08-25-unified-execution-workbench`, `2026-09-10-session-harness-port`, `2026-08-06-branch-chat-groups-design.md`;
  - `docs/plans/2026-10-0x-*` (app completion, shell follow-ups).

---

## 8. Gaps vs the Phase-2 Lark final spec (`/workspace/lark-spec/final/`)

| Lark area (final PRD priority) | Phase-2 proposal | What Rox already has | Gap / required change for the unified spec |
|---|---|---|---|
| Messenger (P0) | New `05-im.sql`, Lark-shaped REST, WS topics, agents as bots, quick panels | AI sessions (chat UI, statuses, labels, branching); messaging-gateway (Lark/TG/... ↔ sessions); team comments/mentions/outbox; Inbox | No human channels/DM, no server IM, no realtime fan-out, no directory. The bot model can reuse gateway binding and router concepts. The IM must stay separate from `Session` (ADR-0001 #4). Align with #1106/#1107. |
| Docs/Wiki/Drive (P1) | Postgres `doc` + `doc_yjs_update` + Hocuspocus + `wiki_space/node`, `folder` | Markdown vault + TipTap + vault index + backlinks + views + journal CAS + daily notes + mind map | **Reconcile:** notes must BE docs. Avoid a second content authority. Options: Markdown stays canonical with a Yjs session layer and server replica, or an explicit one-way migration (#1112 "explicit migration to shared Docs"). Wiki and Drive are new. Comments must become durable anchored discussions. S-10 #9 (no own/forked block editor) targets SiYuan; TipTap is already the editor. |
| Tasks (P1) | Keep `tasks/personal`, add `tasks/shared` + `20-task.sql` | Full Things-style `PersonalTask` with CAS RPC, projects/areas/headings, links, recurrence, reminders, checklist, agent delegation | **Must change:** extend `PersonalTask` into one task aggregate (`WorkItem`) with source-scoped identity, optional server replica, members (assignee/follower), comments/activity, task lists/sections as views over the same store, custom fields via Bases. No parallel `tasks/shared`. Roadmap `taskIds`, meetings proposals and Feed/Radar must keep working. |
| Calendar (P1) | `21-calendar.sql`, FullCalendar, CalDAV/Google sync | `core/calendar` types, merge, occurrences, store; fixture/unavailable adapters; CalendarStatusStrip; Focus screen | New route/page and live adapters. CalendarEvent stays separate from Meeting (ADR-0001 #5) and from tasks ("Events never become personal tasks"). |
| Meetings (P2) | LiveKit, `30-vc.sql` | Local meetings journal, Whisper, proposals → tasks/notes, Conation adapters | Add VC rooms on top of `Meeting` (Rox2 `call`). Reuse proposals and the journal. RS-MTG-01..05. |
| Base (P2) | `40-bitable.sql` | `core/bases` TableSurface v1 codec; NoteBaseView client views | Unified Tables V2 plan already exists (#1295). Base must be views over existing owners (tasks/notes/projects/meetings) plus additive CustomRecord, not a separate record silo. |
| Forms (P2) | `base_view(type='form')` | — | New; depends on Base (#1095). |
| OKR (P3) | `50-okr.sql` | **Project-scoped OKR** (`okr.json`) with cycles, weights, numeric/binary measurement, evidence, freshness, score/coverage | Extend the existing OKR model (org/personal scope, alignment) instead of a new schema. Overlaps Operately goals; merge both. |
| Workplace (P3) | `51-workplace.sql` launcher | Home front page, Pages (dashboards), Integrations catalog, Connections, Extensions | Launcher can be a Home/Pages composition; avoid a second rail (S-10 #2). |
| Email (P3) | `mail` module + `mail_account` | JMAP client, Stalwart pilot, Inbox → Почта | Productionize: provisioning via the rox.one backend, outbound, UI completeness. Keep AGPL Stalwart at arm's length. |
| Contacts (cross-cutting) | `02-directory.sql` | orgs.json members, Dossier (localStorage), Rox2 `person`/`crm-company` kinds, workspace-service principal/member | Directory surface + server owner; Dossier data must move off the renderer. #1108. |
| ACL, realtime, files, events, search | `03-acl`, realtime gateway, `04-files`, event bus | Local WS-RPC; workspace-service outbox pattern; Rox2 permissions enum; team access roles | All new on the server. Must follow ADR-0001 #9/#10 (command-driven, ChangeProposal for AI). |
| Shell | 328px quick panels, Lark layout | Classic layout default; unified shell flag-off; right action rail; 220px navigator minimum | Fit Lark surfaces into existing modes/rail/panels. Resolve the 148 vs 220px conflict. No second rail or palette. |

---

## 9. Constraints the unified spec must respect

### 9.1 S-10 anti-goals (`docs/specs/2026-08-07-unified-shell/10-anti-goals.md`; PR-review checklist)

1. No second palette entry point. ⌘K/⌘P go only through the Command Registry.
2. No second activity rail.
3. No SiYuan AI alongside the Craft/Rox agent.
4. No third-party code in Electron main.
5. Extensions get only broker-issued capabilities, never raw secrets.
6. No DOM transplant of SiYuan plugins.
7. Craft/Rox profile ≠ SiYuan Cloud account (federation only).
8. No labels↔tags sync outside the automation engine.
9. **No own or forked block editor.** Rewriting the SiYuan editor is forbidden.
10. The compatibility view must remain available.

Also from `docs/specs/2026-08-07-siyuan-integration/00-overview.md:148-149` and `unified-shell/08-work-envelope.md:212`:
- "Общая универсальная Entity-БД → **НЕ строить**";
- "Полная двусторонняя синхронизация метаданных → **НЕ строить**";
- work envelopes are narrow single-domain stores.

### 9.2 H-03 harness anti-goals (`docs/specs/2026-09-10-session-harness-port/03-anti-goals.md`, ADR-0019)

1. No second agent runtime: no `dsh` process, **no Cordis host in Electron**, no `~/.dsh` store. Use OMP + `AgentBackend`.
2. No `dsh-*` npm deps.
3. **No third workbench** beside Suite S and UEW; no `node-pty` in the renderer.
4. No copy-paste of community-plugin DOM or bundles.
5. No MITM proxy for permission rules.
6. No secrets or prices in the renderer.
7. No Terminal.app / `.command` launching.
8. No weakening of default permissions for parity.
9. H6 freeze list (sessionBuddy, mnemon, pluginHotReload, agentTeamsRuntime (Cordis), modlens, modsearch, dsh-automation, remote control). Canon: `packages/core/src/platform/workbench/harness-skip-list.ts` *(removed 2026-10-08, wave E-01: UI section, list and locales purged; the freeze stays an anti-goal).*

- The first-party agent-teams skill "не второй оркестратор".
- "**No Timeline / inspector DAG**" in the agent-teams follow-up.

### 9.3 ADR-0001 workbench convergence (accepted 2026-08-13)

- Mode, Surface, Tab and Panel are separate.
- Browser = Surface.
- **WorkItem ≠ Run; user tasks must not extend `Session`; Conductor = WorkflowSpec/WorkflowRun.**
- Session = conversation.
- **CalendarEvent ≠ Meeting.**
- WorkflowDefinition ≠ AutomationDefinition.
- **ActivityEvent ≠ Notification.**
- Knowledge content and WorkGraph state use separate providers. The WorkGraph kernel has not started.
- **All domain mutations are versioned, attributable and command-driven. UI must not store domain state in Jotai.**
- AI mutations go through ChangeProposal.
- Views are stored query definitions, not data copies.
- Presence is ephemeral and server-authoritative.
- Layout is per user; URL is the source of truth.
- Status bar uses the `status` slot.
- `featureUnifiedShellAtom` is the W1 master; new chrome goes behind granular `workbench.*` flags.
- New modules register commands, modes, surfaces and panels through platform registries.
- Out of scope at ADR time: WorkGraph kernel, WorkItems UI, Meetings, Feed, Mail, CRDT, hosted email.

### 9.4 UEW (`docs/specs/2026-08-25-unified-execution-workbench/architecture.md`)

- "There is **no second agent runtime**." `ExecutionCoordinator` sits above existing `AgentBackend`, `SessionManager`, the workflow runner, Cloud Run and `craft-rund`. This is the single orchestrator.
- Terminal bytes are not carried on JSON-RPC.
- No invented performance numbers.
- No new task fields on SessionManager.
- Stale epochs return `FENCE_MISMATCH`.
- Renderer Jotai is not the write path.
- Parent WorkGraph / Turso are not introduced as a side effect.
- No second `AgentBackend` or parallel SessionManager.

### 9.5 Other documented constraints

- **Licences** (Phase 2 + repo): avoid Synapse/Dendrite AGPL, NocoDB SUL, Redis (use Valkey), MinIO AGPL (use SeaweedFS), tldraw licence, and HyperFormula/BlockNote XL GPL. Stalwart only over JMAP.
- Repo licence is Apache-2.0 first-party.
- **SiYuan:** the managed kernel is blocked; G2 licensing is OPEN; production is mode A external-local only (`docs/product/2026-08-13-notes-siyuan-still-blocked.md`, `knowledge/g2-status.ts`).
- **Mail:** loopback pilot only; production provisioning goes through the rox.one backend (`mail-service.ts` header).
- **i18n:** 12 locales, ru default (§2.5).
- **Runtime:** all sessions go through OMP (AGENTS.md "Runtime 0.11.8"). The default permission for new sessions is `allow-all`.
- **Calendar:** "Events never become personal tasks" (`core/calendar/types.ts`).
- **Meetings:** "Meeting is a specialization of Rox2 `call`, not an agent session."
- **Personal tasks:** identity must become source-scoped. Migration must not auto-share personal tasks with workspace members (`lark-suite-reference/07 §2`).
- **Team:** "This module never invents people." Members come only from real org membership.
- **Shell:** keep the classic layout default (`b95c711`). The inspector is hidden by default. The workspace icon rail is off by default.

---

## 10. Open questions for the merge step

1. **Task aggregate.** Should `PersonalTask` be renamed or extended into `WorkItem` (ADR-0001)? Where does the shared server replica live: workspace-service, or the account replica + team outbox? How do Things-style lists coexist with Lark task lists/sections, as views over one store?
2. **Docs authority.** Does Markdown stay canonical with collaborative sessions, or do shared docs get a separate authority with explicit migration (#1112)? Who owns comments and discussions?
3. **OKR + Operately goals.** Extend project OKR to org/personal scope as the goal tree, or keep both?
4. **Agent-teams flag discrepancy** (doc false vs code true). Also confirm a default-off policy for the new Lark/Operately mode flags.
5. **Where human Messenger lives** given "no second rail". A new mode in `modes-seed.ts`, or folded into Chat with a human/agent filter?
6. **Contacts owner** (workspace-service `principal`/`workspace_member` + directory) and migrating Dossier off localStorage.
