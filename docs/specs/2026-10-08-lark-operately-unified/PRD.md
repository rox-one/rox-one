# PRD: Rox Unified Suite (Lark surfaces + Operately goals/projects, adapted onto Rox)

**Version:** unified **v2** (incl. the v2.1 pass: ADR-U19–U20, M24–M26), 2026-10-08 (MSK) (v1 kept in `v1/`) · **Owner:** Mark Lindgreen · **Repo baseline (read-only):** `rox-one/rox-one` @ `aedff592` · **Companion docs:** `DATA-MODEL.md`, `UI-SPEC.md`, `TECH-SPEC.md`, `PLAN.md`, audit `ROX-CURRENT-STATE.md`.

**Inputs merged:**
- the Phase-2 Lark package (`../final/`: PRD, UI-SPEC, TECH-SPEC, PLAN, APPENDIX, 165 screenshots);
- the Operately spec (`../operately/OPERATELY-SPEC.md` + `gen/` + 2 user shots);
- the current-state audit of Rox (`ROX-CURRENT-STATE.md`, "audit" below).

**v2 inputs:**
- Mark's revision brief (A–F);
- the omp session transcript, parsed into `inputs/omp-session-requirements.md` and treated as data;
- a clean-room study of `macro-inc/macro` (AGPL-3.0; no code copied).

v2 adds:
- ADR-U13…U18;
- goals G8–G12;
- modules M18–M23;
- the Agent (@rox) column in the matrix;
- §7.10–§7.15, §11.1 and §12.

v2.1 adds (Mark, 2026-10-08): ADR-U19–U20; modules M24–M26; §7.16 (agent panel), §7.17 (cross-functional capabilities X-13…X-26), §7.18 (surface chrome); rows v2.1-1…5 in §12.

Where this document conflicts with the Phase-2 Lark docs or the Operately spec, **this document wins**. Sections of those docs that are not contradicted remain the detailed reference (UI-SPEC Part B/C include them).

---

## 1. Problem and product thesis

Rox already ships a local-first AI workbench with a Things-style task manager, a Markdown/TipTap notes vault, project-scoped OKR and roadmaps, local meetings, an Inbox aggregator, a Feed and a messaging gateway that binds external chats to AI sessions (audit §0, §2.2). It does **not** have human messaging, shared documents, shared tasks, an org goal tree, check-ins, spaces, a calendar surface or a directory.

Lark gives the collaboration surfaces (Messenger, Docs/Wiki/Drive, Tasks, Calendar, Meetings, Base, Forms, OKR, Workplace, Email). Operately gives the goal/project operating system (goals, targets, checklists, check-ins, reviews, projects, milestones, spaces, KPIs, Review inbox, Work Map).

**Thesis:** build **one suite with one entity model**, where Lark and Operately are *surfaces* over Rox's existing domain owners, extended rather than duplicated:
- Notes **are** Docs.
- PersonalTask **is** the task aggregate (WorkItem); every task UI (Things lists, Lark lists, Operately boards) is a view.
- Project OKR **becomes** the goal tree; Lark objectives and Operately goals are the same row.
- Every entity has a `kind:id` reference, a `rox://` deep link, a preview card and backlinks, so any surface can reference or create any other entity, including straight from chat.

## 2. Binding decisions (ADR-style)

Each decision lists the chosen option, the alternative that was rejected, and the consequence. IDs are referenced throughout the package.

### ADR-U01: Task aggregate = PersonalTask extended into WorkItem
- **Decision.** Extend `packages/core/src/tasks/personal` (`PersonalTask`, schema v2) into the ADR-0001 **WorkItem** (schema v3): one aggregate, one store contract, one `task:` kind.
  - Things lists (Inbox / Today / Upcoming / Anytime / Someday / Logbook / Trash), Lark task lists, sections and groups, Operately project task boards, space Kanban and milestone-linked tasks are all **views or filters** over WorkItem.
  - Personal items stay **local-first** in `PersonalTaskPersistStore` (`{configDir}/personal-tasks/<id>.json`, revision CAS).
  - Shared items (any assignee besides the owner, a shared list, project, space or chat origin) replicate to a **server copy in `apps/workspace-service`** (`work_item` table). They use the existing revision-checked command + transactional outbox pattern (`project_event` / `project_create_receipt` generalised).
  - Workflow-runner tasks (Conductor DAG, `tasks:*`), session task fields (`SessionHeader.kanbanColumn…taskDraft`) and agent-teams tasks **stay separate**. They link only via `kind:id` (`workflow-run:`, `session:`, `agent-team:`).
- **Alternative rejected.** A parallel `tasks/shared` module plus a Lark `task` table (Phase-2 TECH-SPEC §6). It duplicates Task rows, which is the #1 trap listed in `docs/lark-suite-reference/07`.
- **Consequences.**
  - Identity becomes source-scoped (`authority`, `ownerPrincipalId`, `nativeId`), with the **id preserved** across local→workspace moves so references never break.
  - Migration never auto-shares (audit §9.5).
  - Roadmap `taskIds`, meeting `create_task` proposals, Feed/Radar "→ task", Focus top-3 and Dossier touches keep working through the same store.

### ADR-U02: Docs authority = Markdown for private notes; explicit migration to a workspace authority with Yjs when shared
- **Decision.** Markdown files in the notes vault stay **canonical for private notes**.
  - Sharing a note is an explicit **Share → Move to shared Docs** command (#1112). It migrates the note to a workspace-service `doc` authority with Yjs co-editing (Hocuspocus), and the server **snapshots back to Markdown**.
  - The local `.md` becomes a read-only mirror stamped with `rox_authority: workspace` and `rox_doc_id`.
  - Exactly **one authority per doc at any time**, recorded on the doc and in the local tombstone. "Make a private copy" forks to a new id; "Move back to private" is an explicit reverse migration (owner only, only when no other editors).
  - **Comments and reactions:** one shared `comment` + `reaction` model for all shared entities (docs, tasks, goals, projects, check-ins, posts, milestones, KPIs, files, messages). Inline anchors live on doc comments. Private notes keep `<!-- rox:comment -->` markers, which convert into `comment` rows at share time.
- **Alternative rejected.** (a) Markdown stays canonical even for shared docs, with a Yjs session layer on top: two writers, which is the "mixed Markdown+JSON writers" trap. (b) Every note moves to Postgres: this breaks local-first and the vault/journal/CAS stack.
- **Consequences.**
  - The Notes surface **is** the Docs surface: one rail entry, one editor (TipTap stays, with `y-prosemirror` added), one kind (`note:`, alias `doc:`).
  - Lark's "Docs home" (Recent / Owned by Me / Shared With Me / Favorites) is a view over private and shared docs together.

### ADR-U03: Goals = existing project OKR extended into an org / space / personal goal tree
- **Decision.** The existing `okr.json` model (cycles, objectives, weighted KRs, numeric/binary measurement, evidence, freshness) is extended into a **goal tree**: `goal` (scope company / space / personal, `parent_goal_id`), `goal-target`, `goal-check`, `okr-cycle`.
  - The same row is an **Operately goal** and a **Lark OKR objective** (an objective = a goal with `cycle_id` and `goal_kind='objective'`).
  - **Targets = key results.** Numeric KRs become targets. Binary KRs become checks (or 0→1 targets when weighted).
  - **One `check-in` table** for goals and projects (polymorphic subject). **One `review` table** for goal retrospectives, project retrospectives and Lark OKR cycle reviews.
- **Alternative rejected.** Keeping project OKR and adding a separate Operately goal schema plus a separate Lark `okr_*` schema: three goal models.
- **Consequences.**
  - `okr.json` migrates once per project (DATA-MODEL §6.2, MIG-04) and then becomes a generated export.
  - The project page shows its goals through `parent`/`aligned-to` links.
  - Lark's "My OKRs", "Alignment" and "Reviews" tabs are views in the Goals app.

### ADR-U04: Feature flags: every new Lark/Operately mode or flag defaults OFF
- **Decision.** All new modes and features ship behind new flags that **default false**:
  - modes: `workbench.mode.{messenger,calendar,contacts,goals}.v1`;
  - features: `docs.shared.v1`, `docs.drive.v1`, `docs.wiki.v1`, `tasks.lark.v1`, `tasks.shared.v1`, `goals.checkins.v1`, `spaces.v1`, `kpis.v1`, `tables.base.v1`, `forms.v1`, `meetings.vc.v1`, `mail.client.v2`, `workplace.v1`, `search.server.v1`, `entities.links.v1`, `entities.previews.v1`.
  - This differs from the current house style, where granular `workbench.*` flags default true (audit §6).
- **Recorded issue (do not change in this programme):** `workbench.harness.agentTeams` is documented default **false** in ADR-0019/H-03 but is **true** in `packages/core/src/platform/workbench/flags.ts` (P35-08). Filed as a separate fix ticket: rox-one/rox-one#1535. This spec does not touch it.
- **Alternative rejected.** Defaulting new modes ON like `workbench.mode.tasks.v1`. That would expose half-built server-dependent surfaces in the classic layout, which must stay the default (`b95c711`).

### ADR-U05: Human Messenger = a new mode in `modes-seed.ts`
- **Decision.** Add a `messenger` mode (order 25, between `chat` 20 and `meetings` 30) to `apps/electron/src/renderer/platform/modes-seed.ts`, inside the **existing** rail. There is no second rail and no second palette (S-10 #1, #2).
  - AI sessions stay in **Chat** (Session = conversation, ADR-0001).
  - The two are cross-linked:
    - "Ask Rox" on any message opens or creates a session seeded with the message, linked `derived-from`.
    - A session can be shared into a chat as a session card.
    - Rox agents appear in Messenger as **bot principals** (an agent chat = a bot DM bound to a session through the messaging-gateway binding model).
- **Alternative rejected.** Folding human chats into Chat with a human/agent filter. That mixes Session and IM aggregates and breaks ADR-0001 #4.

### ADR-U06: Contacts are owned by the workspace-service directory; Dossier migrates off localStorage
- **Decision.** The **directory** lives in `apps/workspace-service`:
  - `principal` (kinds user / bot / guest / service), `workspace_member`, `user_profile` (title, manager, timezone, status), `department`;
  - `contact_card` for people and companies without accounts (Dossier persons, `crm-company`).
  - Dossier data moves from renderer `localStorage` (`lib/extra-screens/storage.ts`) to this owner, or to a local `contacts` store when no workspace is connected. The Dossier screen becomes a view of Contacts.
  - `orgs.json` members are imported as directory members on connect.
- **Alternative rejected.** Keeping Dossier in localStorage with a separate Contacts store. It violates ADR-0001 #9 (no domain state in the renderer) and duplicates Contact rows.

### ADR-U07: Spaces auto-provision a chat + Docs folder; KPIs are their own module; Operately status wording
- **Decision.**
  - Creating a **space** atomically creates a space **group chat** (`channel:` with `space_id`) and a root **Docs folder** (`folder:` with `owner=space`), plus default chat tabs (Goals, Projects, Tasks, KPIs, Docs).
  - **KPIs** are a small module of their own (`kpi`, `kpi_entry`, `kpi_entry_edit`, `kpi_annotation`), not Base tables. "Sync to Base" is a later export.
  - **Status vocabulary** is Operately's everywhere, including the Lark OKR tab: `on_track` "On track", `caution` "Caution" (**not** "At risk"), `off_track` "Off track", `pending`, `outdated`, `paused`, `achieved` / `completed`, `missed`. Lark "No status" = `pending`.
- **Alternatives rejected.** Spaces without a chat (the space chat would be a manual step, so discussions and check-ins could not publish cards). KPIs as Base tables (no cadence reminders, Review or check-in integration). Lark's "At risk" label kept in the OKR tab (two labels for one state).

### ADR-U08: Kind names: existing Rox kinds stay canonical; Lark/Operately names become aliases
- **Decision.** Never rename an existing `ROX2_ENTITY_KINDS` value. New concepts get new kinds, and Lark/Operately synonyms are registered as **aliases** that the parser normalises:

| Alias | Canonical kind |
|---|---|
| `doc`, `post`, `discussion` | `note` |
| `chat` | `channel` |
| `message` | `channel-message` |
| `meeting` | `call` |
| `event` | `calendar-event` |
| `user`, `contact` | `person` |
| `company` | `crm-company` |
| `objective` | `goal` |
| `key-result` | `goal-target` |
| `mail` | `mail-thread` |
| `workflowRun` | `workflow-run` |

- **Alternative rejected.** Renaming to Lark names (`doc:`, `chat:`). That forces a migration of every stored reference (TaskLink, roadmap inputs, team targets, vault refs) for no user value.

### ADR-U09: Cross-integration without a universal entity database
- **Decision.** Cross-integration is built from four narrow primitives (audit §9.1 forbids "Общая универсальная Entity-БД"):
  1. the `kind:id` **kind registry** (catalog of 54 kinds with owner, authority and capabilities);
  2. an **`entity_link` relations table** (edges only, no copied entity data; a local SQLite mirror per workspace plus a server table);
  3. **`rox://` deep links** for every kind;
  4. a **reference resolver + preview registry**, where each owner module registers `resolve()` and card/chip/hover components.
  - No owner gives up its data. The resolver fans out to owners and caches previews only in memory.
- **Alternative rejected.** A single `entity` table or GraphQL federation layer.

### ADR-U10: Gantt is a view type, not a mode
- **Decision.** Operately's Work Map "Timeline" and Lark Base/Tasks "Gantt" ship as one shared **Gantt view type** (`frappe-gantt`, MIT) inside Goals, Tasks and Base. It is labelled **"Gantt" / «Гантт»** and never "Timeline".
  - The H-03 anti-goal ("No Timeline / inspector DAG" for agent teams) refers to the agent-teams run inspector, not to planning views, and `ProjectTimeline.tsx` already exists for roadmaps.
  - **Approved by Mark on 2026-10-08** (PRD §11.1, D-v2-1).

### ADR-U11: Shell fit: Lark proportions inside existing shell slots
- **Decision.**
  - Lark's 148px labelled rail is **not** built. The existing mode rail stays, and new modes are icons with tooltips (an optional existing "labels" setting may show labels).
  - The Messenger filter column maps to NAVIGATOR at **220px minimum** (the shell minimum is not lowered). It collapses to a 56px icon strip.
  - Chat list = COLLECTION (320, 264–420). Quick panels = INSPECTOR (328).
  - In the **classic layout** (default), the mode sidebar hosts the filter list as a collapsible header above the chat list.
  - Lark colours are mapped to Rox tokens (UI-SPEC §2). The Lark palette is not imported.
- **Alternative rejected.** Lowering NAVIGATOR to 148 for Messenger only, or adding a Lark-style labelled rail (S-10 #2).

### ADR-U12: Review merges into Inbox; notifications are activity-derived
- **Decision.**
  - Operately's **Review** page becomes a **"Ревью / Review" view inside the existing Inbox mode**, with its own badge count, plus new `InboxKind` values (`review`, `mention`, `assignment`, `notification`).
  - The Operately bell / Lark notification centre is the Inbox "Notifications" view plus OS notifications.
  - ActivityEvent (`domain_event`) ≠ Notification (`notification`), per ADR-0001.
- **Alternative rejected.** A separate Review mode, which would make three inbox-like surfaces.

### ADR-U13 (v2): All Rox files live in `~/rox` (visible), not `~/.rox`
- **Decision.**
  - `resolveConfigDir()` resolves `ROX_CONFIG_DIR` → else **`~/rox`**, creating it on a clean install.
  - `~/.rox` is no longer a default. An existing `~/.rox` is migrated once (MIG-13): moved to `~/rox`, with `~/.rox` left as a symlink to `~/rox` for tools and scripts that still read it.
  - Every hard-coded `~/.rox` / `homedir()+'.rox'` path found in the audit is routed through `resolveConfigDir()`, including the remote SSH server install dir (`~/rox/remote-server` on new installs).
  - Rox never writes defaults into `~/Documents` or `~/Desktop`.
- **Why.** Mark's explicit requirement (B). The audit saw both: code prefers `~/rox` only when it already exists, otherwise `~/.rox`, and the repo policy doc says "do not delete `~/.rox`".
- **Alternative rejected.**
  - Keep `~/.rox` as the default and make `~/rox` opt-in (today's policy). That contradicts B.
  - Hard move without a symlink. That breaks external tools; omp remark #14 says live dot-configs must not be broken.
- **Consequence.** Work package W1-13. Tests cover all four starting states (none, `.rox` only, `rox` only, both).

### ADR-U14 (v2): Agent autonomy through the same command bus (no second orchestrator)
- **Decision.**
  - Each member has one **personal agent** principal (`@rox`), running in the **existing** Rox agent runtime (omp sessions, server-core). It acts only by dispatching ordinary **commands** (the same catalogue as the UI).
  - Effective permission = owner's ACL ∩ granted scopes.
  - Commands are classified `routine` / `consequential` / `privileged`:
    - routine → auto;
    - the other two → **approval request** to the owner, unless a **standing approval** matches.
  - Per-scope **rate limits** apply. Every attempt is written to an append-only, hash-chained **audit log**.
  - The agent reports completion only after a readback (`verification=readback_verified`).
- **Alternative rejected.**
  - A separate "agent orchestrator" service with its own task queue (violates audit §9 and H-03 "no second orchestrator").
  - Agents writing directly to stores (bypasses ACL, audit and idempotency).
  - "Spawn more subagents automatically" (omp remark #20).
- **Consequence.** Packages W1-11 (contracts) and AGT-2 (UX + runtime wiring). The MCP catalogue (AGT, #1113) uses the same scopes.

### ADR-U15 (v2): Domain automation rules are event consumers with idempotent steps
- **Decision.** The five required behaviours (R1–R5, PRD §7.13) are built into the domain layer.
  - Each rule is a `domain_event` consumer whose actions are commands with deterministic idempotency keys.
  - Each rule records a `rule_execution` and is configurable in Settings → Automations.
  - They are not user-built Automations (#1096–#1100) and not a workflow engine.
- **Alternative rejected.**
  - Implement the rules in the Automations canvas (not shipped; it would block E on #1096–#1100).
  - Implement them as agent prompts (non-deterministic and not idempotent).
- **Consequence.** W1-12 (rule engine contract + R1–R5 definitions) and AUTO (implementation in wave 2).

### ADR-U16 (v2): Team = workspace with a default General chat plus public / private group chats and channels; email invitees become placeholder principals
- **Decision.**
  - Creating a team creates a workspace plus **one General group chat by default**. Members can then create additional **group chats** and **channels**, each **public** (discoverable, joinable by any member) or **private** (invite-only, hidden) (D-v2-2, approved).
  - Inviting an email with no account creates a **placeholder principal** (same id forever). The placeholder is added to General (and target chats) as a *not-yet-activated* member.
  - On sign-up with that verified email, the account is attached to the placeholder, so all history (mentions, assignments, chat membership) is preserved.
- **Alternative rejected.**
  - Invitation-only rows that create the person at sign-up (history would reference an email string, not a person).
  - Adding invitees only after acceptance (Lark default; contradicts E4).
- **Consequence.** `13-identity-lifecycle.sql` and rules R2 / R4. The UI shows pending members with a «Приглашён» badge.

### ADR-U17 (v2): Personal Drive per account with 1 TB default quota
- **Decision.**
  - Every account gets a personal Drive («Мой диск») on creation (R5) with `quota_bytes` = 1 TiB by default (workspace-configurable).
  - Usage is computed from a storage ledger: every version plus trash counts, charged to the owner.
  - Bytes live in **SeaweedFS** (S3 API, Apache-2.0), or any S3 in cloud deployments.
  - Agent / session artifacts, note attachments, chat files and recordings appear in Drive as **virtual folders** (saved queries, no copies).
  - Local-only users get the visible folder `~/rox/drive/`.
- **Alternative rejected.**
  - Shared-only Drive (Phase-2 design; no personal space).
  - Copying artifacts into Drive (doubles storage, and the copies drift).
  - MinIO (AGPL).
- **Consequence.** `16-drive-quota.sql` and package DRV.

### ADR-U18 (v2): Collaboration model: Yjs for shared docs, OSS suggestion mode, server-derived receipts
- **Decision.**
  - Shared docs co-edit through Yjs / Hocuspocus with awareness cursors.
  - **Suggestion mode** uses `@handlewithcare/prosemirror-suggest-changes` (MIT), not TipTap Pro.
  - Comments are threaded, anchored by Yjs relative positions, with mentions and resolve / reopen.
  - Presence is ephemeral (Valkey).
  - Read receipts are derived from `last_read_seq` (chats) and `doc_view` (docs).
  - Shared task lists and shared calendars use the one ACL engine.
  - Offline: Yjs merges docs; other entities use per-field LWW with revision checks and an inline conflict chip.
- **Alternative rejected.**
  - TipTap Pro collaboration / comments / track-changes (commercial licence).
  - Operational transforms.
  - Per-message receipt rows (they don't scale for groups).
- **Consequence.** New §7.10 requirements, UI-SPEC §18 and package COL.


### ADR-U19 (v2.1): One persistent, context-aware agent panel on every surface
- **Decision.**
  - The `@rox` chat is available on **every** surface as a right-docked panel. It is toggled with ⌘J and sits next to the inspector (UI-SPEC §25).
  - It survives navigation, mode switches and restarts.
  - It receives a typed **SurfaceContext**: surface, route, focused entity, selection, visible refs (TECH-SPEC §18). Each surface package supplies its context through a provider slot.
  - The panel conversation is an ordinary omp **session** (`origin='agent-panel'`), and it acts only through command-bus commands with the ADR-U14 risk classes and approvals.
  - It shares the right dock with the 328 quick panels, the 560 task detail and the collaboration panels by three deterministic rules: side-by-side, shared dock with tabs, or overlay (UI-SPEC §25.5).
- **Alternatives rejected.**
  - A separate floating assistant window, which loses context and duplicates the session model.
  - A per-surface assistant implementation, which would mean N assistants and N policies.
  - A second agent runtime for the panel, which breaks "no second orchestrator".
  - Putting the agent into the inspector stack only, which would kill persistence when a quick panel opens.
- **Consequence.** M24, §7.16, UI-SPEC §25, TECH-SPEC §18, packages W1-15 (contract) and AGP (surface). Flag `agent.panel.v1`.

### ADR-U20 (v2.1): Surface chrome contract: one rail, a declared left sidebar and a three-zone top bar per surface
- **Decision.**
  - Every surface declares its **left sidebar** (header with a create split button, «Закреплённое», primary views, user sections, footer, collapsed 56 state, counters, row context menu) and its **top bar** (left "where am I", center "how am I looking at it", right "who is here and what can I do", with @rox always last). The declaration goes through a typed chrome schema registered in the W1-07 slot registry (TECH-SPEC §19).
  - The existing mode rail stays the only rail. Mode sub-areas (Wiki, Drive, Base, Forms in Docs; Projects, Spaces, KPIs in Goals) are sidebar sections with a "‹ back" drill-in, not a second rail.
  - The per-surface content is specified in UI-SPEC §26 (matrices A and B) and §27 (wireframes).
- **Alternatives rejected.**
  - Lark's labelled 148 px rail (already rejected by ADR-U11).
  - A second icon column for sub-areas.
  - Free-form per-surface headers, which give inconsistent placement of Share, presence and create.
- **Consequence.** M25, §7.18, UI-SPEC §26–§27, TECH-SPEC §19, packages W1-15 (schema) and CHR (rollout). Flag `workbench.chrome.surfaces.v1`. With the flag off, the v2 layouts (UI-SPEC §3.3) are unchanged.


## 3. Goals and non-goals

**Goals**
1. **G1:** One entity model. Every user-visible object has a `kind:id`, a `rox://` link, a preview card and backlinks ("Referenced in").
2. **G2:** Messenger at Lark parity (P0 of Phase 2 retained), plus create-anything-from-chat and live entity cards.
3. **G3:** Notes = Docs: private Markdown plus shared collaborative docs, Wiki, Drive and Docs home, in one surface.
4. **G4:** Tasks = one store with three faces: Things (personal planning), Lark (lists, sections, kanban, subscribers, comments) and Operately (statuses, priority, size, milestones, boards).
5. **G5:** Operately parity: goals, targets, checklists, subgoals & projects tree, check-ins, discussions, milestones, resources, champion / reviewer / contributors, privacy, close / reopen / pause / move / delete, Work Map, Review, Spaces, KPIs, templates, Markdown export.
6. **G6:** Calendar, Meetings (VC), Contacts, Base/Forms, Email and Workplace adapted onto existing Rox owners.
7. **G7:** Implementation in ≤ 3 waves. All contracts land in wave 1; every surface package in wave 2 depends only on wave-1 contracts.
8. **G8 (v2):** Deep collaboration: presence, co-editing with cursors, threaded comments with mentions, suggestion mode, granular sharing, receipts, offline / conflict handling, shared task lists and calendars.
9. **G9 (v2):** Create anything from anywhere: tasks, meetings and events from inside Docs (inline blocks, `/` commands, selection → task) and from Chat (message → task / event / doc), with one command contract per action.
10. **G10 (v2):** A personal agent `@rox` for every member that can autonomously create events, tasks, docs, group chats and calls through the same commands, governed by scopes, approvals, rate limits and an audit log.
11. **G11 (v2):** Built-in domain automations R1–R5 (event → notes + prep task; member → General chat + agent; new account → agent DM welcome; invites → placeholder members; new account → personal Drive 1 TB).
12. **G12 (v2):** All local files under the visible `~/rox` folder.

**Non-goals (this programme)**
- No second agent runtime or orchestrator; no Cordis host; no third workbench (H-03, UEW).
- No own or forked block editor; TipTap stays (S-10 #9).
- No universal entity DB or bidirectional metadata sync (audit §9.1).
- No E2EE, federation or Matrix transport.
- No copying of Operately `app/ee` (billing). No Operately auth/company admin screens (S47, S48, S50 merge into Rox Settings).
- Sheets (#1092), Slides (#1093), Help Desk (#1115–#1116), Approvals (#1117–#1118) and Viewer/Signing (#1119–#1120) are out of scope. They plug into the same contracts later.
- No change to the agent-teams flag value (ADR-U04).

## 4. Personas

| Persona | Primary jobs | Key surfaces |
|---|---|---|
| **P1 Founder/exec (Mark)** | Set company goals, see Work Map health, review check-ins, steer from chat | Goals, Review (Inbox), Messenger, Docs |
| **P2 Team lead / champion** | Run projects, milestones and weekly check-ins, assign tasks, unblock | Projects, Tasks board, Messenger space chat, Calendar |
| **P3 Individual contributor** | Plan the day (Today), work assigned tasks, write docs, chat | Tasks (Things views), Docs, Messenger |
| **P4 Reviewer / stakeholder** | Acknowledge check-ins and retrospectives, comment | Review, Goal/Project pages, notifications |
| **P5 Rox agent (bot principal)** | Draft check-ins, summarise Review, own tasks, answer in chats, create docs | Messenger (bot DM/group), Tasks (assignee), Docs |
| **P6 Guest / external** | Collaborate on one space, doc or chat | Space chat, shared doc, tasks assigned to them |
| **P7 Solo local user (no workspace server)** | Everything personal, offline | Tasks, Docs (private), Goals (personal space), Calendar |

## 5. Surface inventory: existing Rox surface → unified surface

Legend:
- **KEEP**: unchanged.
- **EXTEND**: same surface with new capabilities.
- **BECOMES**: renamed or re-scoped, same owner.
- **NEW**: new mode or surface.
- **VIEW**: hosted inside another surface.

The flag column lists the new flag (all default OFF, ADR-U04). Audit row numbers refer to `ROX-CURRENT-STATE.md` §2.2.

| # | Existing Rox surface (audit §2.2) | Unified result | Lark source | Operately source | Change | Flag |
|---|---|---|---|---|---|---|
| 1 | Home / Главная | Home = hub, plus an Operately-style Home (favourited goals/projects, due soon, my work) and a **Workplace "Apps"** section (launcher) | Workplace (UI §12.1) | Home S01 | EXTEND | `workplace.v1` (apps section); home widgets `goals.v1` |
| 2 | Chat / Сессии (AI) | KEEP as AI sessions. Adds "Share to chat" (session card) and a backlink "Discussed in" | Agent chat look (msg/34) | — | KEEP + links | `entities.links.v1` |
| 3 | Session board / table / heatmap | KEEP (session fields are not tasks, UEW) | — | — | KEEP | — |
| 4 | Tasks / Задачи (Things) | **Tasks = WorkItem.** Sidebar adds Lark sections (Owned, Subscribed, Activities, Quick Access, Task Lists, groups). Views: Things lists, Lark List/Kanban, Operately status board, Gantt, Table. Detail pane = merged Lark/Operately task page | Tasks (UI §10) | Tasks tab, Space Kanban, Task page S20/S30/S38 | EXTEND | `tasks.lark.v1`, `tasks.shared.v1` |
| 5 | Notes / Заметки | **Docs (= Notes).** Rail label «Документы»; route `notes/*` kept plus alias `docs/*`. Adds Docs home (Recent / Owned / Shared / Favorites), Lark doc chrome (Share, permission dialog, ··· menu, TOC, comments panel), shared co-editing, Wiki, Drive, Base, Forms entries in ＋New | Docs/Wiki/Drive (UI §5) | Docs & Files S40–S42, Discussions S36/S37 | BECOMES | `docs.shared.v1`, `docs.drive.v1`, `docs.wiki.v1` |
| 6 | Meetings / Встречи | EXTEND: Lark landing (Start / Join), VC rooms (LiveKit) on the existing `Meeting` (`call`), minutes → doc, schedule from chat/calendar | Meetings (UI §9) | — | EXTEND | `meetings.vc.v1` |
| 7 | Inbox / Входящие | EXTEND: new views **Ревью** (Operately Review: Due soon / Needs your review / My upcoming work), **Уведомления** (bell), **Упоминания**. Existing kinds kept | Notification centre, Assistants | Review S31, Notifications S32 | EXTEND | `goals.checkins.v1` (Review), `entities.links.v1` |
| 7a | Mail (Inbox → Почта) | EXTEND to the Lark mail client layout (Compose, folders, reading pane, **Share to chat**); stays inside Inbox | Email (UI §12.2) | — | EXTEND | `mail.client.v2` |
| 8 | Feed / Лента | EXTEND: "Team" tab = activity feed from `domain_event` (Operately feed grouped by day) | — | Feed S10/S24 | EXTEND | `goals.v1` |
| 9 | Projects / Проекты | **Projects = Operately projects.** Same `projects/{slug}` owner, extended with champion / reviewer / contributors, status, check-ins, milestones (from roadmap), resources, discussions, Tasks tab, pause / close. Session/workdir/MEMORY features kept as the "Workspace" tab | — | Project page S19–S28 | EXTEND | `goals.v1` |
| 10 | Pages / Страницы | KEEP; registered as Workplace apps (pages appear in the Apps launcher); `page:` previews in chat | Workplace widgets | — | KEEP + links | — |
| 11 | Memory | KEEP | — | — | KEEP | — |
| 12–15 | Sources, Skills, Automations, Connections | KEEP. Automations gain triggers/actions for new domain events (#1096–#1100) | Base automation | — | KEEP + events | — |
| 16 | Knowledge (SiYuan) | KEEP (mode A external-local); `knowledge:` refs resolvable in chat | — | — | KEEP | — |
| 17 | Search / Поиск + Omnibox ⌘K | EXTEND: Omnibox gets **category providers** (Messages, Docs, Tasks, Goals, Projects, Milestones, Check-ins, Spaces, People, Events, Files). SearchPage = Advanced search (filters by type / space / owner / date). No second palette (S-10 #1) | Global search (UI §3.3) | Search S44 | EXTEND | `search.server.v1` |
| 18–23 | Browser, Terminal, Cloud runs, Extensions, Diff, Screen | KEEP | — | — | KEEP | — |
| 24 | Settings | EXTEND: Notifications (batch window, instant mentions, daily summary), Messenger, Calendar accounts, Directory/Admin (#1114), API tokens and MCP grants (#1113) | Settings | Account S47 (merged) | EXTEND | — |
| 25 | Dossier / Досье | BECOMES a view of **Contacts** (`contact_card`), data migrated off localStorage (ADR-U06) | Contacts | People | BECOMES | `workbench.mode.contacts.v1` |
| 26 | Radar | KEEP; storage moves to a server-core store (ADR-0001 #9 debt); `radar-topic:` kind | — | — | KEEP (+store) | — |
| 27 | Decisions | KEEP; `decision:` kind; decisions can link to goals, projects and check-ins | — | — | KEEP + links | — |
| 28 | Agent center | KEEP; agents are visible as bot principals | Connect Agents | — | KEEP | — |
| 29 | Focus | EXTEND: uses the real Calendar and WorkItem Today view | — | — | EXTEND | — |
| 30 | Shortcuts | EXTEND with new shortcuts | — | — | EXTEND | — |
| 31 | Conation surfaces | KEEP flag-off | — | — | KEEP | — |
| 32–33 | Webui, iOS | Webui hosts the same surfaces; iOS out of scope | — | — | — | — |
| N1 | — | **Messenger** (human IM): DMs, groups, channels, topic groups, space chats, bot/agent chats, quick panels, tabs, cards, slash commands | Messenger (UI §4) | Space discussions → cards | NEW mode `messenger` | `workbench.mode.messenger.v1` |
| N2 | — | **Calendar**: Day / Week / Month, calendars, rooms, free/busy, event detail | Calendar (UI §8) | — | NEW mode `calendar` | `workbench.mode.calendar.v1` |
| N3 | — | **Contacts / People**: directory, org chart, profile (Lark card + Operately tabs), external contacts, starred, groups, Dossier | Contacts (UI §4.11) | People S45/S46 | NEW mode `contacts` | `workbench.mode.contacts.v1` |
| N4 | Project OKR (inside Projects) | **Goals & Projects** app (mode `goals`): Work Map (default), Goals, Projects, My OKRs, Alignment, Reviews, Spaces, KPIs, Templates | OKR (UI §11) | S02–S18, S29, S33–S39, S43 | NEW mode `goals` | `workbench.mode.goals.v1` |
| N5 | — | **Spaces** (inside Goals & Projects plus Messenger and Docs): space page with tool cards, members, access | — | S33–S36 | NEW (view) | `spaces.v1` |
| N6 | — | **KPIs** (space tool + Goals app tab) | — | S39 | NEW (view) | `kpis.v1` |
| N7 | notes views `base`/`table` | **Base** (inside Docs, ＋New › Base): Grid / Kanban / Calendar / Gantt / Gallery / Form views over Unified Tables (#1295) | Base (UI §6) | — | EXTEND | `tables.base.v1` |
| N8 | — | **Forms** (Base form view + standalone form docs) | Forms (UI §7) | — | NEW (view) | `forms.v1` |
| N9 | — | **Wiki** (inside Docs) | Wiki (UI §5.3) | — | NEW (view) | `docs.wiki.v1` |
| N10 | — | **Drive** (inside Docs: files, folders, links, uploads) | Drive | Resource hub | NEW (view) | `docs.drive.v1` |
| N11 | Pages + IntegrationsCatalog | **Workplace** = Apps section of Home + "Apps" in ＋ menu; opened apps become surface tabs (not rail items) | Workplace (UI §12.1) | — | NEW (view) | `workplace.v1` |

**Rail after the programme** (modes-seed order; new modes are flag-gated):

| Order | Mode | Label (RU / EN) | Status |
|---|---|---|---|
| 10 | home | Главная / Home | existing |
| 20 | chat | Чат / Chat (AI sessions) | existing |
| 25 | messenger | Мессенджер / Messenger | **new** |
| 30 | meetings | Встречи / Meetings | existing |
| 35 | calendar | Календарь / Calendar | **new** |
| 40 | tasks | Задачи / Tasks | existing |
| 45 | goals | Цели и проекты / Goals & Projects | **new** |
| 50 | notes | Документы / Docs (id stays `notes`) | existing, relabelled |
| 55 | contacts | Контакты / Contacts | **new** |
| 60 | feed | Лента / Feed | existing |
| 70 | inbox | Входящие / Inbox (+ Review, Mail) | existing |

The extra-screens group "Ещё" is unchanged except that Dossier opens Contacts › Dossier.

## 6. Modules: scope and acceptance criteria

Module IDs are reused in DATA-MODEL, TECH-SPEC and PLAN. Priority (P0–P3) is the user-value order; it does **not** imply sequencing, because all surface modules run in parallel in wave 2 (PLAN).

### M0 Platform contracts (entities, links, resolver, commands, ACL, activity), P0
**Scope:**
- kind registry (54 kinds + aliases);
- `entity_link` store (local + server);
- `rox://` routes for all kinds;
- reference resolver and preview registry (chip / card / hover / unfurl);
- command envelope + receipts + outbox (local and server);
- `domain_event` bus;
- ACL engine with the Operately-compatible levels;
- directory principals;
- comment / reaction / subscription model;
- shared UI primitives (StatusBadge, PersonField, ContextualDateField, PrivacyField, CommentsSection, ReactionBar, ActivityTimeline, EntityPicker, EntityChip / EntityCard, SidePanelFrame).

**Acceptance:**
1. `parseEntityRef('doc:abc')` returns `{kind:'note', id:'abc'}`, and the same holds for all 13 aliases. Unknown kinds return a typed error. `formatEntityRef` round-trips for all 54 kinds (property test).
2. Every kind has a registered resolver. In the fixture workspace, resolving a reference to a deleted or inaccessible entity returns a `tombstone` or `no_access` preview within 50 ms. The resolver never throws.
3. A link created between a local task and a shared doc appears in both entities' "Referenced in" lists. Deleting either side tombstones the link and removes it from both lists.
4. Every mutation command returns a receipt `{commandId, revision, eventIds}`. Replaying the same `idempotencyKey` returns the same receipt. A stale `expectedRevision` returns `conflict` with the current revision.
5. `can(actor, verb, ref)` agrees with the matrix in DATA-MODEL §8 for 100% of the generated cases.
6. All new i18n keys exist in the 12 locales (parity test green), RU is the default.

### M1 Messenger, P0
**Scope:**
- Phase-2 Messenger scope (UI-SPEC Part B §4), adapted to the Rox shell;
- DMs, groups, channels, topic groups, bot/agent chats, space chats;
- filters, labels, pins, Done, mute, flag;
- threads, reactions, read receipts, drafts, edit/recall, forward;
- tabs, announcement, Group Settings;
- the four header quick panels (Docs, Tasks, Calendar, Contacts);
- **entity mentions and unfurl cards for every kind**;
- **create from chat:** task / doc / meeting / event / goal / project / milestone / check-in / poll / base record;
- "Ask Rox" bridge to AI sessions;
- external bridge mirroring (messaging-gateway `chat.external_source`).

**Acceptance:**
1. Two users in separate clients exchange DMs. p95 delivery is < 300 ms on LAN. Unread badge, read receipt and unread divider are correct after reconnect, with no gaps or duplicates (seq check).
2. Typing `/task Buy domain @anna tomorrow` creates a shared WorkItem (assignee Anna, due tomorrow, `derived-from` the message). It posts a task card that both users can complete inline, and the Tasks quick panel shows it.
3. Typing `/doc`, `/meeting`, `/event`, `/goal`, `/project`, `/milestone`, `/checkin`, `/poll` and `/link` each open the right prefilled creator, and the created entity is linked to the message (`derived-from`).
4. Pasting a `rox://` link or Rox web URL of any of the 54 kinds renders the registered card. Cards respect ACL: a no-access card shows "Request access".
5. A space chat shows tabs Goals · Projects · Tasks · KPIs · Docs, and they render the space Work Map, the board, KPIs and the folder.
6. All Lark menu labels in UI-SPEC Part B §4 appear verbatim (EN) with RU translations.
7. A bot (Rox agent) added to a group receives @mentions, answers through `POST /im/v1/messages` and can create tasks via commands. Its actions show in the activity feed with the bot as actor.

### M2 Docs (= Notes) + Wiki + Drive, P1
**Scope:**
- one Docs surface over private Markdown notes and shared docs;
- Docs home (Recent / Owned by Me / Shared With Me / Favorites + custom views);
- Lark doc chrome: header, Share popover, Permission settings dialog, ··· menu, TOC, block handle menu, selection toolbar, comments panel, version history;
- **explicit Share/Move to shared Docs (#1112)**; Yjs co-editing with presence; snapshot back to Markdown;
- anchored comments + reactions; doc subtypes `post` (discussions) and `announcement`;
- Wiki spaces/tree; Drive (folders, files, links, upload, favourites, shortcuts);
- "Docs & Files" tabs embedded in goals, projects and spaces;
- entity mentions (`@` people, `@` / `[[` any entity);
- export to Markdown / docx / PDF.

**Acceptance:**
1. A private note edited offline and online keeps its Markdown file canonical. No server row exists until Share is invoked.
2. Share → "Move to shared Docs" on a note with 3 inline comments creates a workspace `doc` with the **same id** and 3 anchored `comment` rows. The local file becomes read-only with `rox_authority: workspace`. Two users co-edit with cursors. Within 10 s of idle, the server writes a Markdown snapshot that round-trips through the vault indexer (backlinks and tags still resolve).
3. At no time do two writers exist: a local save attempt on a migrated note returns `AUTHORITY_MOVED` with the doc link.
4. Docs home lists private and shared docs together, correctly filtered by tab, with Lark columns (Name, Location, Owner, Created, Recent ↓).
5. `[[` / `@` autocompletes any kind (tasks, goals, people, chats…). Inserted mentions render as entity chips and create `mentions` links.
6. A goal's "Docs & Files" tab shows its folder. Adding a doc there creates it with the goal's ACL inherited.

### M3 Tasks (WorkItem: Things + Lark + Operately), P1
**Scope:**
- the PersonalTask → WorkItem v3 migration (local, in place);
- Things views kept exactly;
- **Lark Tasks list exactly** (sidebar Owned / Subscribed / Activities / Connect Agents / Quick Access (All Tasks, Created, Assigned, Completed) / Task Lists + New Group; toolbar New Task ▾, Ongoing ⇄, Filter, Sort by, Group by, Customize; List | Kanban; detail pane);
- **Operately format:** status sets (Not started / In progress / Done / Canceled, customizable), priority (none / low / normal / high / urgent), size, milestone, board by status, list grouped by milestone, Space Kanban, task page;
- assignees, subscribers (followers), comments + activity, attachments, subtasks, dependencies (`blocks`);
- reminders (Things reminderAt + Operately before_due / due_day / overdue / on_date + Lark alert);
- recurrence; custom fields (via Unified Tables field registry); Gantt and Table views;
- shared lists; agent assignees.

**Acceptance:**
1. After upgrade, every existing personal task, project, area and heading is visible unchanged in the Things views (golden snapshot of 500 fixture tasks), and no task is shared.
2. The Lark "Owned" view lists the same tasks as Things "All" for a solo user. Counts, sort and filter options match UI-SPEC Part B §10 verbatim.
3. Assigning a personal task to a workspace member prompts "Share this task?". On confirm, it moves to workspace authority with the same id. The assignee sees it in "Assigned" and can plan it into their own Today without affecting the owner's Today (per-user planning state).
4. A project's Tasks tab (board) shows the project's tasks in status columns. Dragging changes `status_key` and emits `task.task_status_change`. List view groups by milestone with "No milestone".
5. Completing a task in any view (Things checkbox, Lark ✓ Mark Complete, Operately Done column, chat card) updates all views within one realtime tick.
6. Roadmap milestone progress, meeting `create_task` proposals, Feed "→ task" and Focus top-3 still pass their existing tests.

### M4 Calendar, P1
**Scope:**
- Calendar mode (Day / Week / Month; sidebar with my calendars, subscribed calendars, rooms);
- event detail and editor (Lark), RSVP, recurrence (`rrule`), free/busy, time zones;
- Google / Outlook / CalDAV adapters (replace the fixture adapter);
- workspace calendars and events;
- "Create meeting" from an event; Focus integration.
- Events never become tasks (they link via `in-calendar`).

**Acceptance:**
1. Connecting Google shows events in Week view within 5 s. Edits sync both ways with etag conflict handling.
2. `/event` in chat prefills attendees from chat members. The event appears in the chat's Calendar quick panel and in each attendee's calendar.
3. A task with a due date appears in the optional "Tasks" overlay calendar without creating an event row.

### M5 Meetings (VC), P2
**Scope:**
- Lark landing (Start a meeting / Join a meeting);
- LiveKit rooms bound to the existing `Meeting` (`call:`) aggregate;
- in-call UI (Part B §9); recording / transcript via the existing on-device Whisper pipeline;
- minutes as a `note` (subtype `minutes`); proposals → tasks/docs (existing journal);
- start from chat / calendar / goal / project.

**Acceptance:**
1. Two users join a room from a chat card. Ending the call writes a Meeting with a transcript and proposals, using the existing journal; no duplicate Meeting rows.
2. Approving a `create_task` proposal creates a WorkItem linked `derived-from` the meeting.

### M6 Contacts / People, P1
**Scope:**
- directory (members, bots, guests), departments and org chart (`manager_id`);
- profile: Lark profile card + Operately tabs (Tasks / Assigned / Reviewing / Paused / Completed / Activity / About);
- external contacts, starred, My Groups;
- **Dossier merged** (contact cards for people and companies, touches, brief);
- invite people.

**Acceptance:**
1. Dossier entries from localStorage are migrated once, with a count report and no duplicates on re-run. Afterwards the extra screen reads from the store.
2. A person card (chat hover, `@` mention, profile page) shows the same data. "Message", "Call" and "Schedule" work.
3. Org chart renders the `manager_id` tree for 500 members in < 500 ms.

### M7 Goals & OKR, P1
**Scope:**
- Goals & Projects mode;
- Work Map: columns Name, Status, Progress, Due Date, Assigned On, Space, Project, Champion, Role, Next step; tabs All work / Goals / Projects / Completed / Paused; views Table | Gantt;
- Add item modal;
- goal page: Overview with Goal Description, Targets, Checklist, Subgoals & Projects, Docs & Files, Contributors; tabs Check-Ins / Discussions / Docs & Files / Activity; sidebar Last Check-In, Parent Goal, Start / Due Date, Champion, Reviewer, Privacy, actions;
- targets (Update / Edit / Delete), checklist, subgoal tree, alignment (`aligned-to`);
- OKR cycles; **My OKRs** (Lark layout: cycle switcher, draft / publish, weights); **Alignment** tree; **Reviews**;
- close / reopen with retrospective; move to space; Markdown export; delete (blocked with children);
- migration of project `okr.json`.

**Acceptance:**
1. Goal "Launch AI Platform" from `user-shots/01-goal-overview.png` can be reproduced field by field. Labels follow the SHOT, e.g. "Last Check-In", "Goal Description".
2. Progress = mean target progress combined with checklist completion, matching the Operately formula on 50 fixture goals. Derived status follows OPERATELY §3.2 (outdated if check-in is > 3 days overdue).
3. A migrated project OKR shows each objective as a goal with the same weights. Numeric KRs become targets with baseline / target / current / unit, and binary KRs become checks. `OkrProgress` score equals the pre-migration score.
4. My OKRs shows the same goal rows filtered by cycle and owner. Publish validates that weights sum to 100%.
5. Delete is blocked when subgoals or projects exist ("Move or delete the subgoals and projects first").

### M8 Projects, P1
**Scope:**
- Operately project page on the existing Rox project: Overview with Description, Milestones (Upcoming + "Show N completed"), Resources chips, Contributors; tabs Tasks / Check-ins / Discussions / Docs & Files / Activity; plus **Workspace** (existing sessions, working directory, MEMORY, roadmap AI);
- sidebar: Last check-in, Parent goal, dates, Champion, Reviewer, Contributors with responsibility, Privacy, Notifications;
- actions: Copy URL · Move · Pause / Resume · Close · Export as Markdown · Save as template · Delete;
- milestone page with a Complete dialog; roadmap → milestones migration.

**Acceptance:**
1. `user-shots/02-project-overview.png` reproduces with SHOT layout, with the code-only sections appended below Contributors.
2. Existing roadmap milestones appear as milestones with the same ids, and `taskIds` become `task.milestoneId`. Roadmap AI (clarify / spec / improve) still works.
3. Pausing sets status `paused` (badge ⏸). Closing requires a retrospective and writes a `review` row.

### M9 Spaces, P2
**Scope:**
- space page with tool cards (Goals & Projects, Discussions, Documents & Files, Tasks, KPIs, Templates);
- configure tools; New space (Name, Purpose); members and access; delete by typing the name;
- **auto group chat + Docs folder**; space Work Map; space Kanban.

**Acceptance:**
1. Creating a space creates exactly one chat and one root folder in the same command receipt. Deleting it archives both after the name confirmation.
2. Adding a member to the space adds them to the space chat and grants the space's default access to its goals, projects and docs that use "Everyone in the space…" privacy.

### M10 Review, Activity, Notifications, P1
**Scope:**
- Inbox › Review: groups Due soon / overdue, Needs your review, My upcoming work; assignment types check_in, goal_update, project_task, space_task, milestone, kpi_update, project_retrospective, goal_retrospective;
- activity feed per entity / space / person / home;
- notification centre (Inbox › Notifications, Mark all read);
- OS notifications; email digest (batch window, instant mentions, daily summary);
- Assistant bot cards in DMs with actions (Acknowledge, Check in, Mark done).

**Acceptance:**
1. A reviewer gets exactly one notification and one Review item per submitted check-in. Acknowledging clears both and notifies the champion.
2. With a 5-min batch window, 10 notifications produce one digest email; a mention produces an instant email when enabled.
3. Activity types cover all 141 Operately actions plus Lark IM/task/doc/calendar events (DATA-MODEL §9). Each type has a renderer and an RU/EN string.

### M11 KPIs, P2
**Scope:** KPI cards (value, delta, sparkline, champion, cadence), detail with chart (ECharts), annotations, Log update, history, edits; Review items for due KPI updates; links to goals.

**Acceptance:** Logging a weekly KPI value updates the card, the sparkline and the Review item; editing an entry keeps an edit history row.

### M12 Base & Forms, P2
**Scope:**
- Lark Base UI over **Unified Tables** (#1295): views Grid / Kanban / Calendar / Gantt / Gallery / Form;
- source adapters over WorkItems, goals, projects, docs and meetings (views, not copies), plus `custom_record` for free tables;
- Forms (#1095) with public fill;
- automations hook (#1096–#1100).

**Acceptance:**
1. A Base view over "Tasks where project = X" edits task fields through task commands (no record copy).
2. A form response creates a record or task, as configured.

### M13 Search, P1
**Scope:** server index (Postgres FTS ru + en + simple, later Meilisearch CE); Omnibox category providers; Advanced search page; ACL-filtered; local providers (vault FTS5, tasks, sessions) merged with server results.

**Acceptance:** "Search for spaces, projects, goals, milestones, tasks, or people..." returns grouped results across local and server owners in < 300 ms p95, and never returns entities the actor cannot read.

### M14 Workplace, P3
**Scope:** an Apps section on Home (Favorites, All Apps categories); Rox surfaces, Pages, integrations and bots as apps; opened apps become surface tabs.

**Acceptance:** Favouriting an app pins it to Home. Opening a Page app opens it as a surface tab; no rail item is added.

### M15 Email, P3
**Scope:** Lark mail client layout inside Inbox › Почта over JMAP/Stalwart; Share to chat (mail card); create task / doc from mail; production provisioning through the rox.one backend.

**Acceptance:** "Share to chat" posts a `mail-thread` card that opens the thread for recipients with access. "Create task" links `derived-from`.

### M16 Templates & Markdown export, P3
**Scope:** project templates (single payload table, relative dates), "Save as template" / "Create from template"; Markdown export for goals and projects (S49) and docs.

**Acceptance:** A project created from a template has milestones and tasks shifted relative to its start date. Export produces Markdown with check-ins and targets.

### M17 Agents & MCP tools, P2
**Scope:**
- Operately's MCP tool catalogue becomes Rox agent tools over the same command bus (goals, projects, milestones, tasks, spaces, docs, comments, people, search, fetch);
- "Check-in drafting" assistant;
- Review summary;
- bot principals.
- All AI mutations go through ChangeProposal (ADR-0001).

**Acceptance:** An agent asked "draft my weekly check-in for project X" produces a draft check-in (state `draft`) via a ChangeProposal that the champion publishes. No direct write happens without approval.

### M18 Collaboration layer (v2), P1
**Scope:**
- presence (rail avatars, doc facepile, "active now" in chats and tasks);
- Yjs co-editing with named cursors and selections;
- threaded comments (doc inline, entity-level, task, event) with mentions, resolve / reopen and "Assign as task";
- suggestion mode (suggest / accept / reject, per-suggestion threads);
- share dialog (people, groups, spaces, chats, link; roles viewer / commenter / editor / manager; expiry);
- "Viewed by";
- message read receipts;
- shared task lists (members, follow, per-user Today);
- shared calendars (owner / editor / viewer / free-busy);
- an offline / pending banner and an inline conflict chip.

**Acceptance:**
1. Two users editing one shared doc see each other's cursors within 300 ms (LAN).
2. A suggestion by B appears for A with author and time. Accepting applies it, notifies B and leaves a resolved thread.
3. Offline edits by both users merge without loss.
4. Changing a task field while offline that someone else changed yields the "Keep mine / Keep theirs" chip, and the chosen value wins with a new revision.
5. In a 5-person group, "Read by 3" lists the right people.
6. A calendar shared as free / busy shows busy blocks without titles.

### M19 Cross-surface creation (v2), P1
**Scope:**
- **Docs → tasks:**
  - inline task block (`/task`, `[] ` markdown shortcut in shared docs, the "Create task" bubble on a selection);
  - linked task-list embed;
  - checklist → tasks conversion.
- **Docs → meetings / events:** `/meeting`, `/event` blocks with a date / time picker that create a real `calendar-event` (+ optional call) and render a live card.
- **Docs → people:** `@person` mention; `@rox` hands off to the agent.
- **Chat → entities:**
  - message → task / event / meeting / doc / goal / check-in, multi-select → doc;
  - thread → summary doc via @rox;
  - `/group` creates a group chat from the selected participants.
- **Shared mechanics:**
  - every created entity gets `derived-from` + anchor (doc block id / message seq) and a live card at the origin;
  - edits flow both ways (the card reflects the entity; the doc block shows checkbox, assignee, due).

**Acceptance:**
1. Selecting text in a doc and pressing ⌘⇧T creates a task with the selection as title and the doc block linked. The task's "Created from" shows the doc and scrolls to the block.
2. Ticking the inline checkbox in the doc completes the task everywhere.
3. `/event Weekly sync Fri 15:00 @Anna` in a doc creates an event with Anna invited (after confirmation) and the block shows RSVP status.
4. "Create event" on a chat message pre-fills title, time (NL parse) and attendees = chat members.

### M20 Agent autonomy (`@rox`) (v2), P1
**Scope:**
- personal agent provisioning;
- `@rox` mention in any chat, doc or comment, plus the agent DM;
- the agent creates events, tasks, docs, group chats, calls / meetings, reminders, check-in drafts, Drive files and invitations through commands;
- scopes, approval policy UI (Settings → Agent), approval cards (DM + Inbox Review), standing approvals, rate limits, audit log viewer, pause agent / kill switch;
- action report cards with undo for reversible actions.

**Acceptance:**
1. "@rox schedule a 30-min call with Anna and Oleg tomorrow afternoon" in a group chat produces an approval card ("Event with 2 attendees: consequential").
2. Approve → event + call created and invites sent; the report card links all three. The audit log shows proposed → approved → executed with the provenance message.
3. "@rox create a task to review the deck" in my DM executes immediately (routine) and reports with an undo.
4. The 11th group message within a minute is rate-limited with a notice.
5. Paused agent → every command is `denied`.

### M21 Identity lifecycle & onboarding (v2), P1
**Scope:**
- account creation hooks; team (workspace) creation with email invites; placeholder principals and activation;
- the default General chat, plus member-created group chats and channels with a public / private toggle (UI-SPEC §23.4);
- personal agent DM and **welcome message** (Macro-style, adapted: lists only resolvable `@handles`);
- starter guide doc + starter tasks; onboarding wizard step "Ваш агент @rox".

**Acceptance:**
1. A new account sees, within 5 s of first sign-in, a DM from Rox greeting them in their locale. The DM explains `@rox` can be tagged in any chat and lists real handles (their agent and up to 5 teammates).
2. Every `@handle` in it is a live mention chip.
3. Inviting `new@x.com` shows them in General as «Приглашён». After they sign up, earlier messages that mention them now link to their profile.

### M22 Personal Drive & quota (v2), P1
**Scope:**
- Drive home (Suggested, Recent);
- My Drive, Shared with me, Recent, Starred, Trash, Storage page;
- upload (drag-drop, folder upload, resumable multipart);
- folders, move / copy / rename, shortcuts, version history, previews (images, PDF, video poster, text / code, office via conversion later);
- quota indicator «X из 1 ТБ использовано» with breakdown;
- virtual folders: «Артефакты агентов», «Файлы из чатов», «Вложения заметок», «Записи встреч».

**Acceptance:**
1. A new account sees «0 Б из 1 ТБ».
2. Uploading a 2 GB file resumes after a network drop, and usage updates within 2 s of completion.
3. An agent-generated PDF appears under «Артефакты агентов → ⟨session⟩» without a copy, and "Save to My Drive" moves it into a real folder, charging quota once.
4. Trash auto-purges after 30 days.
5. At 100% usage, uploads are blocked with a clear message; reads still work.

### M23 Storage root migration `~/rox` (v2), P0
**Scope:**
- `resolveConfigDir()` → `~/rox`;
- MIG-13 move + symlink;
- codemod of all hard-coded `~/.rox` paths (manifest in TECH-SPEC §10.2);
- remote SSH install dir;
- doc / string updates;
- `rox migrate-config [--dry-run|--revert]`.

**Acceptance:**
1. Fresh install creates only `~/rox`.
2. Existing `~/.rox` users end with `~/rox` as the real directory and `~/.rox` → `~/rox` symlink, with no data loss (checksum manifest identical).
3. Both-exist case merges with a conflict report.
4. No code path outside `resolveConfigDir()` references `.rox` (CI grep gate).


### M24 Agent panel everywhere (v2.1), P1
**Scope:**
- the docked / overlay / minimised panel and the shared-dock rules;
- ⌘J / ⌘⇧J, the top-bar and action-rail entry points, «Спросить @rox» on every entity;
- SurfaceContext providers for every surface, with quick actions per surface;
- context chips with explicit consent for private items;
- persistence across navigation and restart;
- act-on-context through commands (suggestions only on shared docs);
- topics and history; «Открыть в Чате».

**Acceptance:**
1. On each of the 15 surface classes in UI-SPEC §25.7, ⌘J opens the panel and the context bar shows the correct focus entity within 300 ms of navigation.
2. Navigating between 5 surfaces mid-answer does not interrupt streaming; the thread shows context dividers, and the draft and scroll position are preserved.
3. With a 328 quick panel open at 1440 px, the panel uses the shared dock (tabs), and at 1100 px it opens as an overlay; MAIN never drops below 640.
4. Private notes and DMs are never attached without a click (negative test).
5. «Задачи из выделенного» in a doc produces an approval card and, after approval and readback, the tasks with `derived-from` links.
6. Restart restores the topic, draft and dock state.

### M25 Surface chrome: left sidebar and top bar per surface (v2.1), P1
**Scope:**
- the chrome schema (sidebar + top bar) per surface;
- common anatomy: header create split button, «Закреплённое», counters (red = action, grey = volume), collapsed 56 with peek, width memory;
- the common row context menu;
- the three-zone top bar with fixed right-zone order and responsive collapse;
- Settings → «Панели и боковые панели».

**Acceptance:**
1. Every surface listed in UI-SPEC §26.2 renders its sidebar sections in the specified order, and its top bar matches §26.3 (snapshot per surface, in both UI profiles).
2. No second rail or icon column exists (a DOM gate on the shell).
3. ⌘B collapses and expands every sidebar, and the state is remembered per surface.
4. At 1100 / 960 px the center control and the right zone collapse as specified.
5. Counters follow the red / grey rule (unit test over the counter providers).

### M26 Cross-functional capabilities X-13…X-26 (v2.1), P1
**Scope:** the 14 capabilities in §7.17. Each one uses existing commands, kinds and relations.

**Acceptance:**
1. Each X-id has one command contract (TECH-SPEC §20) and one UX entry (UI-SPEC §28).
2. Each X-id has a journey step (J21–J23) with a negative test (permission, missing module, flag off → entry hidden).
3. Undo works for X-13, X-14, X-16, X-18 and X-19.


## 7. Cross-integration matrix

### 7.1 Universal affordances (every kind, every surface)
Every entity of every kind gets the following, provided by M0 and implemented once:
- **Reference:** `kind:id` and `rox://<route>` (DATA-MODEL §3). These are insertable via `@` / `[[` in any TipTap surface: docs, chat composer, comments, check-ins, task notes, goal descriptions.
- **Preview:**
  - chip (inline);
  - hover card;
  - full card (chat unfurl, doc embed);
  - **"Referenced in"** backlinks block on its page or detail pane, grouped by kind.
- **Actions on every page/detail:**
  - **Copy link**;
  - **Share to chat…** (posts its card to a chat or DM);
  - **Discuss in chat** (opens or creates a chat linked `attached-to`, role `discussion`);
  - **Create task from this** (task `derived-from`);
  - **Add to…** (task list / project / goal / space / doc as link);
  - **Open in new tab**.
  - v2.1: **Спросить @rox** (X-25, opens the agent panel with this entity as context);
  - v2.1: **Закрепить** (X-26), **Напомнить…** (X-16), **Связать с целью…** (X-18);
  - v2.1: drag the entity to another surface (X-13).
- **Mentions** create `mentions` links. Attachments create `attached-to` links. Embeds create `embeds` links. Creation from another entity creates `derived-from` links (origin).

### 7.2 Reference / create matrix (entity × surface)

Legend:
- **R** = can be referenced there (mention, link, card, embed).
- **C** = can be created from there (prefilled, linked `derived-from`).
- **T** = can be pinned as a chat tab or embedded as a full view.
- **B** = that surface shows the entity's backlinks / "Referenced in".
- **—** = not applicable.

| Entity (kind) | Messenger (chat) | Docs | Tasks | Calendar | Meetings | Goals & Projects | Spaces | Contacts | Inbox / Review | AI Chat (session) | Base | Search | Agent (@rox) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Task (`task`) | R C T B | R C B | R C B | R (overlay) | R C (proposal) | R C (Tasks tab, milestone) | R C (Kanban) | R (profile tabs) | R (assigned, due) | R C ("Create task") | R C (view over tasks) | R | R C (create, assign own; others → approval) |
| Task list / section (`task-list`, `task-section`) | R T | R | R C | — | — | R (project board = list) | R T | — | — | R | R | R | R C |
| Doc / note / post (`note`) | R C T B | R C B | R C (notes, attach) | R (event agenda doc) | R C (minutes) | R C (Docs & Files, discussions) | R C | R | R (comment, mention) | R C ("Save to Docs") | R C (doc field) | R | R C (private auto; share → approval) |
| Chat (`channel`) | R C | R C ("Discuss in chat") | R (origin chat) | R C (event chat) | R C (meeting chat) | R C ("Discuss in chat") | R C (auto space chat) | R C (Message) | R | R (gateway-bound) | R | R | R C (group chat → approval) |
| Message (`channel-message`) | R (reply, forward, link) | R ("Export to Docs") | R (origin) | — | R | R | R | — | R (mentions) | R C ("Ask Rox") | R | R | R C (owner DM auto; shared chat → approval) |
| Meeting (`call`) | R C T B | R C B (from doc: "Schedule meeting") | R B | R C | R C B | R C | R C | R | R (invites) | R | R | R | R C (with others → approval) |
| Calendar event (`calendar-event`) | R C B | R C (from doc: event block) | R | R C B | R C | R C (milestone/check-in due) | R | R (free/busy) | R (invites) | R | R | R | R C (hold auto; invites → approval) |
| Goal (`goal`) | R C T B | R C B | R B | R | R | R C B | R C | R (profile) | R (check-in due, review) | R C (proposal) | R | R | R C (proposal) |
| Target / KR (`goal-target`) | R (card) | R | R B | — | — | R C | — | — | R (update due) | R | R | R | R C (proposal) |
| Check-in (`check-in`) | R C (`/checkin`) B | R | — | R (due) | — | R C B | R (summary card) | R | R C (Needs review) | R C (draft via agent) | R | R | R C (draft; publish → approval) |
| Review / retro (`review`) | R | R | — | — | — | R C B | R | — | R (ack) | R | — | R | R |
| Project (`project`) | R C T B | R C B | R B | R | R | R C B | R C | R | R | R (session project) | R | R | R C (proposal) |
| Milestone (`milestone`) | R C B | R | R C B | R (due) | — | R C B | R | — | R (due) | R | R | R | R C |
| Space (`space`) | R (space chat) T | R (folder) | R (Kanban) | R | — | R C B | R C B | R (member of) | R | R | R | R | R C (privileged → approval) |
| KPI (`kpi`, `kpi-entry`) | R C (`/kpi` log) T | R (embed chart) | R | R (cadence) | — | R C | R C | — | R (update due) | R | R | R | R C (log entry) |
| Person (`person`) | R (mention, card) C (DM) | R (mention) | R (assignee) | R (attendee) | R (participant) | R (champion/reviewer) | R (member) | R C B | R | R | R (user field) | R | R C (invite = privileged) |
| File / folder / link (`file`, `folder`, `drive-link`) | R C T | R C T B | R (attachment) | R (attachment) | R (recording) | R C (Resources) | R C | — | R | R | R (attachment) | R | R C (artifacts → Drive) |
| Base / record / form (`base`, `base-record`, `form`) | R C T | R C T | R C | R (calendar view) | — | R | R | — | R | R | R C B | R | R C |
| Mail thread (`mail-thread`) | R (Share to chat) | R | R C (task from mail) | R (invite) | — | R | — | R | R C | R | R | R | R C (send → approval) |
| AI session (`session`) | R (session card) C (Ask Rox) | R | R (delegated: "Поручить агенту") | — | R (analysis session) | R (project sessions) | — | — | R (unread replies) | R C B | — | R | R C B (origin of agent actions) |
| Decision, page, memory, workflow-run, radar-topic | R | R | R | — | R | R | — | — | R | R | — | R | R |

**Totals (counted from the table above):**
**v2 changes:**
- a 13th column, **Agent (@rox)**: what the personal agent can reference or create through commands, with the approval class in brackets (ADR-U14);
- Docs column: Meeting `R B` → `R C B`, Calendar event `R` → `R C`, Chat `R` → `R C` (cross-surface creation, §7.11).

**Totals (computed from the table):**
- 21 entity rows × 13 surfaces = 273 cells. 35 are **—** (not applicable).
- **R:** all 238 applicable cells (87% of all cells). Every kind can be referenced on every surface where it makes sense.
- **C:** 92 cells (v1: 70). Agent 19 kinds; Messenger 14 and Goals & Projects 14; Docs 9 and Spaces 9; Tasks 6 and AI Chat 6; Meetings 5; Calendar 3 and Base 3; Contacts 2 and Inbox 2; Search 0.
- **T:** 13 cells (Messenger 10, Docs 2, Spaces 1).
- **B:** 33 cells (Messenger 8; Docs, Tasks, Goals & Projects 6 each; Agent 1). Backlinks appear on every entity page that has a sidebar or detail pane.

### 7.3 Chat slash commands
The slash palette opens on `/` at the start of the composer. It is filtered as you type, and arrow keys + Enter select. Every command creates through the owner module's command (no direct DB writes) and then posts the entity card to the chat with a `derived-from` link to the source message.

| Command | Opens / does | Prefill | Result in chat |
|---|---|---|---|
| `/task [title] [@person] [date]` | Inline task creator (Lark quick entry + Rox natural-language dates RU/EN) | assignee ⊆ chat members, origin chat, list = chat's default list | Task card |
| `/todo` | Alias of `/task` | — | — |
| `/doc [title]` | New doc dialog (Doc · Note · Base · Form · Mind map) | folder = chat/space folder, shared with members | Doc card + chat Docs panel entry |
| `/note` | Alias of `/doc` (private note by default) | — | Doc card |
| `/meeting` | Start an instant meeting or schedule one | participants = members | Meeting card with Join |
| `/event` | Event editor | attendees = members, title = chat name | Event card with RSVP |
| `/goal [title]` | Add goal modal | space = chat's space, champion = me | Goal card |
| `/project [title]` | Add project modal | space, champion = me, contributors = selected members | Project card |
| `/milestone` | Milestone creator (pick project) | project = chat's linked project | Milestone card |
| `/checkin` | Check-in form for a goal/project I champion (picker) | status = last, excerpt = selection | Check-in summary card with [Acknowledge] |
| `/kpi` | Log KPI value (picker) | — | KPI card with delta |
| `/poll` | Poll composer | — | Poll card |
| `/remind [when]` | Personal reminder task on this message | owner = me, local | Ephemeral confirmation |
| `/link` | EntityPicker over all 54 kinds | search query | Entity card |
| `/group @a @b [name]` (v2) | Create a group chat with the mentioned people (and the current chat's selected members); private by default, with a public toggle | members, name = topic, visibility | Group chat card + system message in the new chat ("Created from ⟨chat⟩") |
| `/channel [name]` (v2) | Create a channel (public by default, with a private toggle) | name, description, visibility | Channel card + system message in the new channel ("Created from ⟨chat⟩") |
| `/call` (v2) | Alias of `/meeting` (instant) | participants = members | Meeting card with Join |
| `/drive` (v2) | Attach from Drive (picker) or upload to Drive | — | File card |
| `/space` | Open or link a space | — | Space card |
| `/record` | New Base record (pick table) | — | Record card |
| `/ask` | "Ask Rox": opens an AI session seeded with the thread | context = selected messages | Session card (private by default) |
| `/gif`, `/shrug` | Out of scope | — | — |

**`@rox` in chat (v2).** Typing `@rox` followed by an instruction is not a slash command: it invokes the author's personal agent (ADR-U14). The agent replies in the thread, then either executes (routine) or posts an approval card. `@rox-<username>` addresses someone else's agent, which may only answer or ask its owner.

### 7.3a Docs slash commands (v2)
These open in shared docs and private notes alike. Commands that create workspace entities in a private note ask to share or keep them local.

| Command | Creates | Block rendered |
|---|---|---|
| `/task [title] [@person] [date]` | task (list = doc's default list or picker) | inline task block (checkbox, title, assignee, due; live) |
| `/tasks` | embed a task list view (pick / new) | live list embed |
| `/event [title] [when] [@people]` | calendar event (draft until confirmed) | event block (time, attendees, RSVP, Join) |
| `/meeting` | instant call, or scheduled event with call | meeting block |
| `/doc` | sub-doc | link card |
| `/person` or `@` | mention | person chip |
| `/rox [instruction]` or `@rox` | agent invocation on the doc / selection | agent action card |
| `/goal`, `/project`, `/milestone`, `/kpi`, `/checkin` | as in chat | entity card |
| `/date` | date chip (click → "Create event") | date chip |

### 7.4 Composer "⊕ More" menu (Lark order kept, Rox additions grouped)
The Lark items keep their exact labels and order (UI-SPEC Part B §4.8):
1. Image & Video
2. Local File
3. Docs
4. Contact Card
5. Poll
6. Task
7. Translate
8. Message Type

The Rox additions sit after a divider under the heading **Create** («Создать»):
- Meeting
- Event
- Goal
- Project
- Milestone
- Check-in
- Base record

A final item, **Link Rox item…** («Ссылка на объект Rox…»), opens the EntityPicker.

### 7.5 Message "··· More" menu additions
The Lark items keep their order: Multiselect | Flag | Pin, Clip to Top, Copy Message Link, Translate, Delete | Add Task, Export to Docs.

The Rox additions go after **Export to Docs**:
- **Create ▸** Task · Doc · Meeting · Event · Goal · Project · Check-in draft · Base record
- **Link to ▸** (attach this message to an existing entity via the EntityPicker; writes `attached-to`)
- **Ask Rox** (AI session)
- **Copy as reference** (`kind:id`)

### 7.6 Entity cards in chat (unfurl)
Sending a `rox://` link, a Rox web URL or a `kind:id` token renders a card (max 420 wide, Lark card styling, Rox tokens). Cards are live: they subscribe to the entity topic and re-render when it changes. Actions run commands with the viewer's permissions.

| Kind | Card content | Inline actions |
|---|---|---|
| task | checkbox, title, status chip (Operately set), priority, due, assignees, list/project | Mark done · Assign to me · Open |
| note (doc/post) | type icon, title, owner, updated, first lines | Open · Request access (if denied) · Add as tab |
| goal | status badge, progress pie, champion, due (contextual), next step | Open · Check in (champion) · Add to chat tabs |
| project | status badge, milestone progress "1/3", champion, next milestone | Open · Check in |
| milestone | ⚑ title, due, task progress | Open · Mark complete |
| check-in | subject, status chip, author, date, excerpt | Acknowledge (reviewer) · Open · React |
| call (meeting) | title, time, participants, live indicator | Join · Open minutes |
| calendar-event | time range, title, location / room, attendees | Accept · Maybe · Decline · Open |
| kpi | name, value + unit, delta vs previous, sparkline | Log update · Open |
| person | avatar, name, title, department, local time, status | Message · Call · Profile |
| space | name, purpose, member count | Open · Join |
| file / folder / link | icon, name, size, owner | Open · Download |
| base-record / form | primary field + 3 fields / form title | Open · Fill |
| mail-thread | subject, from, date, snippet | Open (if mailbox access) |
| session | AI session title, status, last message | Open in Chat |
| other kinds | generic: icon, title, kind label | Open |

### 7.7 Chat tabs per entity
- Tabs (`chat_tab`) can point at any entity (`kind='entity'`, `ref`). Kinds: Lark `chat`, `announcement`, `files`, `docs`, `pins`, `link`, `doc`; [ROX] `tasks`, `calendar`, and `entity` for goal / project / milestone / task-list / space-work-map / kpis / base-view / folder.
- **Default tabs:**
  - group: Chat · Announcement;
  - agent chat: Chat · File · Docs;
  - **space chat: Chat · Goals · Projects · Tasks · KPIs · Docs**;
  - **entity-discussion chat** (from "Discuss in chat" on a goal/project/task): Chat · ⟨that entity⟩.
- An entity page lists "Chats with this as a tab" in "Referenced in".

### 7.8 Header quick panels (Docs/Notes, Tasks, Calendar, Contacts)
Kept from Phase-2 UI-SPEC §4.4, with these changes:
- **Docs / Notes panel:**
  - Lists `note` entities linked to the chat (entity_link), docs shared in messages and docs tabs.
  - "+ New doc" menu: Doc · Note (private) · Base · Form · Mind map. A private Note created here is *not* shared until the user chooses Share (ADR-U02).
- **Tasks panel:**
  - Lists WorkItems with `derived-from`/`attached-to` this chat, grouped Ongoing / Completed.
  - Shows Operately status chips.
  - "+ Create task" uses the shared quick entry.
- **Calendar panel:** agenda for 14 days (events with chat members or linked to the chat) and the members' free/busy strip.
- **Contacts panel:** member list with roles, status and local time. In a DM, the person card (Contacts module).
- **Optional fifth button in space chats: Goals** (space Work Map mini). It is off by default and enabled per chat in "Edit header buttons".

### 7.9 Reverse direction: every surface can show chats
- Goal, project, milestone, task and doc pages show **"Discussed in"** (chats whose messages link to them) with jump-to-message.
- Calendar events and meetings show their chat.
- Person pages show "Shared chats".

### 7.10 Collaboration requirements (v2)

| ID | Requirement | Surfaces | Spec |
|---|---|---|---|
| R-COL-01 | **Presence:** online / away / DND / offline dot on avatars everywhere. "Active now" facepile on docs, task detail, event detail and chats; typing indicators in chats and comments | all | UI-SPEC §18.1 |
| R-COL-02 | **Co-editing** shared docs with named coloured cursors, selections and "following" (click an avatar to follow their viewport) | Docs | §18.2 |
| R-COL-03 | **Comments:** inline (anchored to a text range), block-level, and entity-level (task, event, goal, project, file). Threaded replies, @mentions (people, `@rox`, entities), reactions, resolve / reopen, "Assign as task", filter (open / resolved / mine / mentions) | Docs, Tasks, Calendar, Goals, Drive | §18.3 |
| R-COL-04 | **Suggestion mode:** Editing / Suggesting / Viewing mode switch. Suggestions show insert / delete marks with author colour; accept / reject one or all; each suggestion has a thread; commenter role can suggest but not edit | Docs | §18.4 |
| R-COL-05 | **Permissions & sharing:** one Share dialog for every shareable kind (doc, folder, task, task list, calendar, goal, project, space, base, file). Invite people / groups / spaces / chats, role per grantee, link sharing (off / workspace / anyone; view / comment / edit), expiry, "Request access" flow, transfer ownership | all | §18.5 |
| R-COL-06 | **Notifications for collaboration:** mention, reply, suggestion, resolve, share, access request, assignment, due. Per-entity follow / unfollow; digest. Never leak restricted content | Inbox | §12, DATA-MODEL §9.2 |
| R-COL-07 | **Offline & conflicts:** "Offline: changes will sync" banner; per-item pending badge; docs merge automatically; field conflicts show an inline chip; revoked access while offline keeps a local draft | all | §18.7 |
| R-COL-08 | **Read receipts:** DMs ✓ / ✓✓; groups "Read by N" with a list (≤ 500 members); docs "Viewed by"; privacy setting to hide own receipts (DMs only, Lark rule: you then don't see others') | Messenger, Docs | §18.8 |
| R-COL-09 | **Shared task lists:** members with roles, followers, per-user Today, assignment from list members, live updates, list chat tab | Tasks | §18.9 |
| R-COL-10 | **Shared calendars:** share a calendar (owner / editor / viewer / free-busy) with people, spaces or chats; subscribe; overlay colours; "Find a time" across members | Calendar | §18.10 |
| R-COL-11 | **Team chats:** every team has one General group chat by default. Members create more **group chats** (conversation for a chosen set of people) and **channels** (named, topic-based, with an optional "only admins post" setting). Each is **public** (listed in «Обзор чатов», self-join) or **private** (invite-only, not discoverable, no preview to non-members). Public ↔ private can be switched by owners / admins, with a warning (D-v2-2) | Messenger | §23.4 |

### 7.11 Cross-surface creation flows (v2)

Each flow has one command contract (TECH-SPEC §12) and one UX flow (UI-SPEC §19).

| ID | From → to | Triggers | Command | UI-SPEC |
|---|---|---|---|---|
| X-01 | Doc → task (inline) | `/task`, `[] ` + text then ⌘↵, toolbar ☐ | `docs.insert_task_block` → `tasks.create` | §19.1 |
| X-02 | Doc selection → task | bubble "Задача" or ⌘⇧T | `tasks.create_from_selection` | §19.2 |
| X-03 | Doc checklist → tasks | block menu "Convert to tasks" | `tasks.create_many_from_checklist` | §19.3 |
| X-04 | Doc → event | `/event`, date chip "Create event" | `docs.insert_event_block` → `calendar.create_event` | §19.4 |
| X-05 | Doc → meeting | `/meeting` (instant or scheduled) | `docs.insert_meeting_block` → `vc.start_meeting` / `calendar.create_event{call:true}` | §19.5 |
| X-06 | Doc → task list embed | `/tasks` (list picker or new list) | `docs.embed_view{ref:task-list}` | §19.6 |
| X-07 | Message → task | hover ⋯ → Задача, `/task` reply, ⌘⇧T on a focused message | `tasks.create_from_message` | §19.7 |
| X-08 | Message → event / meeting | ⋯ → Событие / Встреча, `/event`, `/meeting` | `calendar.create_event_from_message` / `vc.start_meeting{origin}` | §19.8 |
| X-09 | Message(s) → doc | ⋯ → Документ; multi-select → "Save to doc" | `docs.create_from_messages` | §19.9 |
| X-10 | Chat → group chat | `/group @a @b`, member list → "New group with…" | `im.create_chat{from}` | §19.10 |
| X-11 | Any → `@rox` | mention `@rox` + instruction in chat / doc / comment | `agents.invoke` → commands (ADR-U14) | §22 |
| X-12 | Event → notes + task (automatic) | rule R1 | `docs.create_meeting_notes`, `tasks.create{draft}` | §19.11 |

v2.1 adds X-13…X-26 (drag and drop, time-blocking, meeting outcomes, remind me, check-in drafts, link-to-goal, bulk actions, Person 360, Today agenda, email → anything, form → anything, presence huddle, ask @rox, pins) in §7.17.

### 7.12 Agent autonomy requirements (v2)

| ID | Requirement |
|---|---|
| R-AG-01 | The agent can create: events (with / without attendees), tasks (own lists, assign), docs (private, or in a shared folder), group chats, calls / meetings, reminders, check-in drafts, Drive files / folders, invitations. It can update / complete its own creations. **All through command-bus commands.** |
| R-AG-02 | Invocation: agent DM; `@rox` in any chat, thread, doc or comment; scheduled requests ("every Friday, draft my check-in"); rule steps (R2 / R3). |
| R-AG-03 | Permission scopes per agent (Settings → Agent → Permissions). Effective = owner ACL ∩ scopes. Admins can set workspace floors. |
| R-AG-04 | Approval policy by risk class (routine auto / consequential ask / privileged ask + floor). Approval cards in the agent DM and Inbox → Review. Approve / Reject / "Always allow here" (standing approval with selector + expiry). Approvals expire after 24 h. |
| R-AG-05 | Audit log: every agent / rule action with provenance (message, session, rule). Filterable viewer; export CSV; hash-chain verification. |
| R-AG-06 | Rate limits per scope (defaults in DATA-MODEL §5.14), visible in settings, with a notice when hit. |
| R-AG-07 | Kill switch: "Pause agent" (owner) and workspace-wide "Pause all agents" (admin). |
| R-AG-08 | Report-after-readback: the agent posts a result card only after reading back the created entity; failures are reported honestly. |
| R-AG-09 | **No second orchestrator:** the agent runs in the existing omp runtime / session model; multi-step plans are ordinary sessions and agent-teams where already supported. |

### 7.13 Domain automations (v2)
Rules R1–R5 are specified as trigger → actions with idempotency keys in DATA-MODEL §5.16:
1. **R1:** calendar event created → meeting-notes doc bound to the date and linked to the daily note, plus a draft prep task in the backlog list.
2. **R2:** member joins → added to the General chat and gets a personal agent.
3. **R3:** new account → DM with personal `@rox`, an immediate welcome explaining `@rox` can be tagged in any chat, and a list of real handles (Macro-style).
4. **R4:** team invites by email → invitees added to the team chat as not-yet-activated placeholder members; they activate on sign-up with history kept.
5. **R5:** new account → personal Drive with a 1 TB quota.

### 7.14 Drive requirements (v2)
| ID | Requirement |
|---|---|
| R-DRV-01 | Personal Drive per account: Home, My Drive, Shared with me, Recent, Starred, Trash, Storage |
| R-DRV-02 | Upload files and folders (drag-drop, picker, paste), resumable up to 50 GB per file; per-file progress; cancel |
| R-DRV-03 | Folders, nested; move, copy, rename, shortcut, star, share (R-COL-05) |
| R-DRV-04 | Previews: images, PDF (pdf.js), audio / video (poster + player), text / code (Shiki), Markdown; office files via a later conversion service (out of v2 scope) |
| R-DRV-05 | Versions: upload a new version, list, restore, download. Each version counts against quota |
| R-DRV-06 | Quota: «X из 1 ТБ использовано» with a breakdown by type (Docs, Images, Video, Artifacts, Chat files, Trash) and the largest files; warnings at 80 / 90 / 100% |
| R-DRV-07 | Artifacts from agents / sessions / notes / chats / meetings appear in virtual folders without copying |
| R-DRV-08 | Trash with 30-day auto-purge; restore; empty trash |
| R-DRV-09 | Local-only: `~/rox/drive/` folder with the same UI (no quota enforcement; shows disk usage) |

### 7.15 Storage requirement (v2)
- **R-STO-01:** all local Rox files live under `~/rox` (configDir), never `~/.rox`, `~/Documents` or `~/Desktop`. Existing `~/.rox` is migrated (MIG-13) and left as a symlink.


### 7.16 Agent panel requirements (v2.1)
| ID | Requirement |
|---|---|
| R-AGP-01 | The agent panel is available on every surface (UI-SPEC §25.7 list), toggled by ⌘J, the top-bar @rox button and the action-rail item; «Спросить @rox» exists on every entity context menu |
| R-AGP-02 | Persistent: open state, topic, draft, scroll and running work survive navigation, mode switches, tab switches and restarts |
| R-AGP-03 | Context-aware: SurfaceContext (surface, route, focus, selection, visible refs ≤ 50, text excerpt ≤ 2,000 chars) is shown as removable / lockable chips; private notes and DMs need explicit consent |
| R-AGP-04 | Acts on context only through commands with ADR-U14 risk classes; shared docs are edited only as suggestions; reversible results offer undo for 10 min |
| R-AGP-05 | Coexists with quick panels (328), task detail (560), comments (360) and in-call panels by the side-by-side / shared-dock / overlay rules; MAIN ≥ 640 always |
| R-AGP-06 | States Hidden, Docked, Overlay, Minimised, Thinking, Running, Awaiting approval, Paused, Rate limited, Offline, Restricted, Error, each with the copy and motion in UI-SPEC §25.4 / §25.6 |
| R-AGP-07 | The panel topic is an omp session (`origin='agent-panel'`), listed in Chat mode, openable full-size; no second runtime |

### 7.17 Cross-functional capabilities (v2.1)
| ID | Capability | Command(s) (TECH-SPEC §20) | UI-SPEC |
|---|---|---|---|
| X-13 | Drag and drop of any entity between surfaces | `entities.drop{source, target}` → resolves to the owner command (`tasks.attach`, `calendar.create_time_block`, `docs.embed_view`, `im.share_entity`, `goals.link_work`, `drive.move`) | §28 |
| X-14 | Time-blocking tasks on the calendar | `calendar.create_time_block{taskRef, start, end}` | §28, §27.10 |
| X-15 | Meeting outcomes → tasks, decisions, doc, chat | `meetings.publish_outcomes{callId, decisions[], tasks[], summary}` | §28, §27.11 |
| X-16 | Remind me / snooze any entity | `reminders.create{subjectRef, at}`, `reminders.cancel` | §28 |
| X-17 | Check-in draft from activity | `checkins.draft_from_activity{subjectRef, since}` (read-only draft) | §28, §27.12 |
| X-18 | Link work to a goal / project from anywhere | `goals.link_work{goalRef, workRef}` (`aligned-to` / `member-of`) | §28 |
| X-19 | Multi-select bulk actions + ⌘K "Actions on selection" | `commands.batch{commands[]}` (one receipt, one undo) | §28 |
| X-20 | Person 360 | `people.get_overview{personRef}` (read model over links + ACL) | §28, §27.15 |
| X-21 | Today agenda across surfaces | `agenda.today{date}` (read model) | §28, §27.1 |
| X-22 | Email → task / event / doc / chat | `tasks.create_from_email`, `calendar.create_event_from_email`, `docs.create_from_email`, `im.share_entity{kind:'mail-message'}` | §28, §27.16 |
| X-23 | Form submission → task / Base row / chat | `forms.configure_on_submit`; on submit the form dispatches `tasks.create`, `tables.insert_row`, `im.send_message` as the form owner | §28, §27.8 |
| X-24 | Presence huddle from any shared object | `vc.start_meeting{origin: ref, invite: presentPrincipals}` | §28 |
| X-25 | Ask @rox about this | `agents.panel_open{focusRef}` → ordinary session messages | §25, §28 |
| X-26 | Pins across surfaces | `entities.pin{ref}`, `entities.unpin`, `entities.reorder_pins` | §26.1, §28 |

### 7.18 Surface chrome requirements (v2.1)
| ID | Requirement |
|---|---|
| R-CHR-01 | One rail only; mode sub-areas are left-sidebar sections with a "‹ back" drill-in |
| R-CHR-02 | Every surface's left sidebar follows the common anatomy (header create split button, «Закреплённое», primary views, user sections, footer, collapsed 56, counters, row context menu) with the content of UI-SPEC §26.2 |
| R-CHR-03 | Every surface's top bar has the three zones with the content of UI-SPEC §26.3; @rox is always the last right-zone item; Share and presence appear only on shared objects; the surface create action lives in the sidebar header |
| R-CHR-04 | Responsive collapse at 1280 / 1100 / 960 px as specified; sidebar width and collapsed state are remembered per surface |
| R-CHR-05 | Each surface has an ASCII wireframe, features, layout and states in UI-SPEC §27 before its package merges |


## 8. Success metrics

| Metric | Target (90 days after flags ON for the team) |
|---|---|
| Duplicate entity rows (tasks / docs / contacts / goals) | **0** (nightly invariant check: one authority per id) |
| Share of tasks created from chat / meetings / docs (`derived-from` ≠ null) | ≥ 30% |
| Weekly check-in submission rate for active projects | ≥ 80% on time; outdated < 10% |
| Review latency (check-in submitted → acknowledged) | median < 24 h |
| Chat message delivery | p95 < 300 ms (LAN), 0 lost messages (seq audit) |
| Doc co-editing | 0 Markdown snapshot divergences in the nightly round-trip check |
| Search | p95 < 300 ms, 0 ACL leaks in the red-team suite |
| Cross-links | ≥ 50% of goals/projects have ≥ 1 linked doc and chat |
| Regression | existing Tasks, Notes, Projects and Meetings test suites stay green at every merge |
| Agent actions (v2) | 100% of agent mutations have an audit row with provenance; 0 consequential actions executed without approval or a matching standing approval; ≥ 95% report-after-readback |
| Automations (v2) | R1–R5 duplicate executions = 0 (idempotency audit); p95 rule latency < 5 s |
| Welcome (v2) | welcome DM visible ≤ 5 s after first sign-in for ≥ 99% of new accounts |
| Collaboration (v2) | cursor latency p95 < 300 ms (LAN); 0 lost offline edits in the chaos suite |
| Storage (v2) | 0 data-loss reports from MIG-13; quota drift (ledger vs recomputed) = 0 |

## 9. Non-functional requirements (summary; details in TECH-SPEC §7)
- **Local-first:** every personal surface works offline. Shared surfaces queue commands in the outbox and show a "pending sync" state.
- **Performance:**
  - Work Map with 2,000 items renders < 300 ms;
  - task list with 10k tasks is virtualised;
  - chat with 1,000 conversations renders < 50 ms.
- **Security:** ACL on every read and subscription; bot tokens are scoped; no secrets in the renderer; HTML sanitised.
- **i18n:** 12 locales, RU default, ASCII-sorted keys, RU plurals.
- **Accessibility:** keyboard-first (Lark and Things shortcuts preserved), focus rings, ARIA roles on lists, grids and menus.
- **Licences:** Apache-2.0 first party; Operately reuse under Apache-2.0 with NOTICE; never copy `app/ee`.

## 10. Risks (top 12; mitigations in PLAN §7)
1. **Authority confusion** (local vs workspace) for tasks and docs. Mitigation: same id across moves, an explicit share command, a tombstone with `movedTo`, and a nightly invariant check.
2. **Wave-1 contract churn** blocks 31 parallel packages. Mitigation: contracts frozen at the end of wave 1 behind a contract test suite; any change needs an RFC and a version bump.
3. **Scope size** (Lark × Operately). Mitigation: P0/P1 first within wave 2 by staffing, not sequencing; P3 packages can slip to the wave-3 slot.
4. **Shell fit** (classic layout default, unified shell flag-off). Mitigation: every surface specifies both layouts (UI-SPEC §3).
5. **Realtime server is new** (no multi-user fan-out today). Mitigation: Valkey + `ws` gateway in wave 1 with a load test.
6. **Markdown ↔ Yjs fidelity** (rox:comment markers, wiki links, columns). Mitigation: snapshot round-trip golden tests per TipTap extension.
7. **Migration of Dossier, OKR and roadmap** loses data. Mitigation: dry-run reports, idempotent migrators, backups of original files.
8. **Flag defaults OFF** delay dogfooding. Mitigation: an internal "suite preview" profile that flips all flags for the team.

9. **(v2) Agent overreach.** Scopes, approvals, rate limits, the kill switch and an audit chain; privileged actions can never get standing approvals.
10. **(v2) Path migration data loss.** Move with a checksum manifest, a symlink, no deletion and `--revert`; rehearsal in W3-02.
11. **(v2) Placeholder abuse / spam invites.** Invite rate limit (privileged scope), expiry after 30 days, admin revoke.
12. **(v2) Drive cost.** Quota ledger, content-addressed blobs, trash purge, warnings.

## 11. Decisions Mark must confirm
1. **Gantt vs "Timeline"** (ADR-U10): ship Operately's Work Map timeline as a "Gantt" view type (not a mode, not named Timeline). Confirm this does not violate the H-03 intent.
2. **Rail label for Notes:** rename «Заметки» to «Документы» (route id `notes` unchanged), or keep «Заметки» with the Docs home inside.
3. **Things "Projects" in Tasks become "Task lists"** (Lark naming), because "Project" now means the Operately/Rox project. Areas become list groups. Labels change; data does not.
4. **Status RU labels:**

   | Status key | RU label |
   |---|---|
   | on_track | «По плану» |
   | caution | «Внимание» |
   | off_track | «Отстаёт» |
   | pending | «Не начато» |
   | outdated | «Устарело» |
   | paused | «На паузе» |
   | achieved | «Достигнуто» |
   | missed | «Не достигнуто» |

   Confirm the wording; the EN labels are Operately's.
5. **Priority scale:** unify to none / low / normal / high / urgent (Rox `medium` → `normal`).
6. **Spaces require a connected workspace server.** A solo local workspace gets one implicit "Personal" space. Confirm that solo users don't need multiple local spaces.
7. **Navigator width:** keep 220px minimum (Lark's 148px filter column is not reproduced exactly).
8. **Default-OFF flags for all new modes**, including Messenger. Confirm, and name who flips them for dogfooding.
9. **Agent-teams flag discrepancy:** filed as a separate ticket, #1535 (2026-10-08). This programme does not change it.
10. **Review inside Inbox** (not a separate rail mode).

### 11.1 v2 decisions: all 13 APPROVED by Mark on 2026-10-08
Mark approved D-v2-1…D-v2-13 on 2026-10-08 («ВСЁ ОК»), together with filing the plan's issues and a spec PR. They are binding decisions and no longer open questions.

- **D-v2-1:** ✅ **APPROVED by Mark, 2026-10-08.** **`~/.rox` handling.** Move to `~/rox` and leave `~/.rox` as a compatibility symlink; never delete. This resolves the conflict with omp remark #14 ("do not move live dot-configs out of home") in favour of requirement B; the symlink keeps tools that read `~/.rox` working. `.omp`, `.codex` and the other dot-configs are never touched.
- **D-v2-2:** ✅ **APPROVED by Mark, 2026-10-08.** **Team = workspace.**
  - Every team gets **one General group chat by default** (created with the workspace; all active members, and invited placeholders as pending members).
  - Members can create **additional group chats and channels, each either public or private**.
    - Public: listed in «Обзор чатов», any workspace member can join.
    - Private: invite-only, not discoverable, content visible to members only.
  - Spaces are sub-teams with their own chats.
  - Data model: DATA-MODEL §5.11 (chat kind, visibility and membership). UI: UI-SPEC §23.4.
- **D-v2-3:** ✅ **APPROVED by Mark, 2026-10-08.** **R1 scope:** notes and the prep task are created for the **organiser only**. All-day, declined and `free` events are skipped (and so are events tagged `#no-notes`).
- **D-v2-4:** ✅ **APPROVED by Mark, 2026-10-08.** **R1 backlog list:** a dedicated system list «Бэклог» per user, not the Things Inbox («Входящие»).
- **D-v2-5:** ✅ **APPROVED by Mark, 2026-10-08.** **Personal agent naming:** `@rox` always means *my* agent; other people's agents are `@rox-<username>`, shown as «Rox · Имя».
- **D-v2-6:** ✅ **APPROVED by Mark, 2026-10-08.** **Default approval policy:** routine = auto; consequential / privileged = ask; standing approvals allowed for consequential, never for privileged. Inviting people is always `privileged`.
- **D-v2-7:** ✅ **APPROVED by Mark, 2026-10-08.** **Rate-limit defaults** as tabled in DATA-MODEL §5.14.
- **D-v2-8:** ✅ **APPROVED by Mark, 2026-10-08.** **Quota:** 1 TiB per user (shown as "1 TB"); versions and trash count; chat attachments count against the uploader; workspace admins can change the default.
- **D-v2-9:** ✅ **APPROVED by Mark, 2026-10-08.** **Welcome DM** lists only real, resolvable handles: the user's agent, built-in agents (if enabled) and up to 5 recently active teammates (unlike Macro, which mentions fixed staff accounts).
- **D-v2-10:** ✅ **APPROVED by Mark, 2026-10-08.** **Placeholder visibility:** placeholders are visible to all workspace members; held notifications are emailed as a daily "N updates waiting" digest (titles only).
- **D-v2-11:** ✅ **APPROVED by Mark, 2026-10-08.** **Workspace-level hidden metadata folders** (`{workspaceRoot}/.rox/…`, `.craft/…`) stay as they are, inside `~/rox/workspaces/{id}/`; no per-workspace rename.
- **D-v2-12:** ✅ **APPROVED by Mark, 2026-10-08.** **Flag exception for requirement B:** all v2 flags default OFF except `storage.visible-root.v1`, which turns ON by default in wave 3 after the migration rehearsal (W3-02). Until then the move is manual (`rox migrate-config`).
- **D-v2-13:** ✅ **APPROVED by Mark, 2026-10-08.** **Inferred agent triggers** (a reply in an agent thread triggers the agent without `@rox`) are a parameter, default **off** in v2.

## 12. Requirement traceability (v2)
Every v2 input requirement maps to a doc section and a work package, so completeness can be checked (omp remark #5).

| Input | Requirement | PRD | DATA-MODEL | UI-SPEC | TECH-SPEC | PLAN package(s) |
|---|---|---|---|---|---|---|
| A | omp transcript remarks (`inputs/omp-session-requirements.md`) | §11.1, §12 | §5.13 | §2.6, §18.0 | §7, §13.5 | per item |
| B | Storage `~/rox` | ADR-U13, M23, §7.15 | §2, MIG-13 | §21.1 (wizard path) | §10 | W1-13, W3-02 |
| C1 | Presence | §7.10 R-COL-01 | §5.17 | §18.1 | §11.1 | W1-14, COL |
| C2 | Co-editing (Yjs, cursors) | R-COL-02 | §5.2, §5.17 | §18.2 | §11.2 | DOC-1, COL |
| C3 | Comments / mentions / threads | R-COL-03 | §5.8, §5.17 | §18.3 | §11.3 | W1-08, COL |
| C4 | Suggestion mode | R-COL-04 | §5.17 | §18.4 | §11.4 | COL |
| C5 | Permissions & sharing | R-COL-05 | §8 | §18.5 | §3.6, §11.5 | W1-04, COL |
| C6 | Notifications | R-COL-06 | §9.2 | §12, §18.3 | §5 | W1-09, REV |
| C7 | Offline / conflicts | R-COL-07 | §10 (rule 9) | §18.7 | §11.6 | W1-03, COL |
| C8 | Read receipts | R-COL-08 | §5.17 | §18.8 | §11.7 | MSG-1, COL |
| C9 | Shared task lists | R-COL-09 | §5.1, §5.17 | §18.9 | §11.8 | TSK-1, COL |
| C10 | Shared calendars | R-COL-10 | §5.17 | §18.10 | §11.9 | CAL, COL |
| C / D-v2-2 | Team chats: default General + public / private group chats and channels | R-COL-11, ADR-U16 | §5.11 | §23.4 | §15.1 | W1-11, ONB, MSG-1 |
| C11 | Create task / meeting / event from Docs | §7.11 X-01…X-06 | — | §19.1–§19.6 | §12 | XSC |
| C12 | Create from Chat | X-07…X-10 | — | §19.7–§19.10 | §12 | MSG-2 |
| D | Agent autonomy | ADR-U14, M20, §7.12 | §5.12–§5.14 | §22 | §13 | W1-11, AGT-2 |
| E1 | Event → notes + task | R1 | §5.16 | §19.11, §24 | §14 | W1-12, AUTO |
| E2 | Member → General chat + agent | R2 | §5.11, §5.12, §5.16 | §23 | §14, §15 | W1-12, AUTO, ONB |
| E3 | New account → agent DM welcome | R3 | §5.16 | §21 | §14, §17 | AUTO, ONB |
| E4 | Invites → placeholder members | R4, ADR-U16 | §5.11 | §23 | §15 | W1-11, ONB |
| E5 | Personal Drive + quota | R5, ADR-U17, M22, §7.14 | §5.15 | §20 | §16 | W1-05, DRV |
| F | Macro welcome research | §11.1 D-v2-9 | — | §21.2 | §17 | ONB |
| v2.1-1 | Re-verify end to end + more cross-functional capabilities | §7.17, M26 | §5.18 | §28 | §20 | XFN, W1-15 |
| v2.1-2 | Agent panel on every surface (persistent, context-aware, dockable, ⌘J) | ADR-U19, M24, §7.16 | §5.18 | §25 | §18 | W1-15, AGP |
| v2.1-3 | UI / UX per surface (features, layouts, states) | M25 | — | §27 | §19 | CHR + each surface package |
| v2.1-4 | Left sidebar per surface (single rail) | ADR-U20, R-CHR-01/02 | — | §26.1, §26.2 (matrix A), §27 | §19 | W1-15, CHR |
| v2.1-5 | Top center bar per surface + left / right consistency | ADR-U20, R-CHR-03/04 | — | §26.1, §26.3 (matrix B), §27 | §19 | W1-15, CHR |
