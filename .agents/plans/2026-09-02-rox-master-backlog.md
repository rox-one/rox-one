---
id: plan-2026-09-02-rox-master-backlog
type: plan
date: 2026-09-02
source: "docs/superpowers/specs/2026-09-02-rox-local-first-platform-epic.md"
intent_issue: ".agents/intents/2026-09-02-rox-product-program.md"
status: draft
---

# Plan: Rox master backlog

## Context

This is the consolidated, issue-ready backlog for the product direction recorded
in the 2026-09-02 user brief. It merges the existing Local-First Platform epic,
Session Pipeline Canvas v2, Sessions Collection views, Cloud Runs, OMP v2 and
self-learning specs with the current implementation state at `132e391`.

The plan deliberately separates local canonical data, privileged browser/secret
operations, account sync, collaboration and model-improvement use. Those are
different purposes and trust boundaries; they must not be represented by one
misleading switch or implemented through one general cloud-upload path.

Applied findings:

- `none` — `.agents/planning-rules` and `.agents/findings` are absent in this
  worktree; the repository specs and current source audit are the prevention
  context.
- Existing session lesson: a UI/process badge is not completion evidence;
  every issue below has mechanical and live gates.

Strategic duel recommendation: before Wave 4, run a product/security debate on
account replica defaults, collaboration tenancy and product-improvement consent.
These defaults are contested and affect more than one execution session.

## Intent Issue

- **Intent issue:** `.agents/intents/2026-09-02-rox-product-program.md`
- **Bounded context:** `rox-desktop-platform`
- **Domain terms:** Session, WorkflowSpec, Run, Local vault, Memory proposal,
  Browser profile, Account replica, Collaboration, Rox CLI.

Acceptance examples are defined in the intent issue and mapped to issues below.

## Current State: Completed Baseline

Do not recreate these items as new implementation work unless a regression gate
fails:

| Capability | Evidence | Status |
|---|---|---|
| Source dev loop and visual playground | `187eb72`, `39ff7a3` | done |
| Browser-safe Canvas draft preview | `9cc9850`, Canvas v2 P0 | done |
| Local Markdown Knowledge provider | `83cf47f` | done |
| Embedded browser panel retention | `57b6c38` | done |
| Honest Kanban model/provider badge | `80610b2` | done |
| Session metadata N+1 reduction | `79dc276` | done, benchmark still pending |
| Geist / Geist Mono typography | `6bbdd3d`, `ee672f9` | done, distribution decision pending |
| Optional onboarding rules + provider flow | `6e4d1c5`, `bf117dd`, `add6445` | partial product flow done |
| Local notebook shell | `7af9c8e` | partial feature set done |
| Comments, external callouts, localized slash menu | `71cea56` | done for current scope |
| Localized resizable column controls | `132e391` | done |
| SiYuan normal-flow opt-out | `71cea56`, `CRAFT_FEATURE_SIYUAN=1` opt-in | done; legacy removal pending |

## Files to Modify

This is the program-level ownership map. Each implementation issue must narrow it
to exact symbols before execution.

| Scope | Existing / new files |
|---|---|
| Session collections | `apps/electron/src/renderer/components/app-shell/session-*`, session RPC/types |
| Notes and Knowledge | `NotesPage.tsx`, `pages/notes/**`, `renderer/knowledge/**`, `packages/server-core/src/knowledge/**` |
| Markdown/editor views | `packages/ui/src/components/markdown/**`, **NEW** bases/canvas projections |
| Workflow Canvas | `SessionWorkflowEditor.tsx`, **NEW** WorkflowSpec version/run stores |
| Messages/memory | `ChatDisplay.tsx`, `TurnCard.tsx`, annotations, **NEW** memory proposal store |
| Browser | `apps/electron/src/main/browser-pane-manager.ts`, browser renderer pages, **NEW** privileged importer |
| Tasks/calendar | **NEW** `packages/core/src/tasks/**`, task RPC/store/screens and calendar adapters |
| Voice | **NEW** voice capture/model/transcription/TTS services and composer controls |
| Runtime/capabilities | backend interfaces, OmpAgent, skills/source bridges, capability-pack manifests |
| Cloud | `packages/cloud-runner/**`, cloud-runs RPC/UI, **NEW** Daytona provider |
| Account/sync/collab | **NEW** server tenancy/sync/invite/publication services and desktop adapters |
| Shared contracts | protocol DTO/channels, feature flags, migrations, preferences and i18n locales |
| Release | app metadata, config migrations, installers, update channels, docs and receipts |

## Boundaries

**Always**

- Markdown/session logs are canonical; indexes and projections are rebuildable.
- Renderer-visible IDs are never authorization claims.
- Provider credentials are references to keychain/Infisical/vault entries.
- Russian, English and Simplified Chinese are release-gated locales; all locale
  files retain parity and sorting.
- Every issue includes unit/integration validation and, for UI behavior, a live
  Electron or deterministic renderer scenario.

**Decision gates**

- `DG-01`: legal text and explicit purposes for account replica and product
  improvement/model training.
- `DG-02`: browser password/passkey import support per OS and browser.
- `DG-03`: public sharing retention, abuse handling and deletion SLA.
- `DG-04`: paid-only Daytona sandbox quotas and per-user cost ceiling.
- `DG-05`: distributable Geist license/asset decision.

**Never**

- Never silently upload local data behind a no-op “sync off” checkbox.
- Never place cookies/passwords/passkeys in Knowledge, embeddings, logs or a
  general S3/Postgres replica.
- Never auto-fallback from Daytona to Cloudflare, Modal or E2B.
- Never copy third-party UI or source wholesale without license and fit review.
- Never report a provider/model/agent identity that was not resolved from data.

## Baseline Audit

| Metric | Command | Result |
|---|---|---|
| Branch drift vs `origin/main` | `git rev-list --left-right --count origin/main...HEAD` | `0 20` — branch contains main and is 20 commits ahead |
| Current source SHA | `git log -1 --format='%H %s'` | `132e391… fix(notes): localize column resize controls` |
| Renderer files | `rg --files apps/electron/src/renderer \| wc -l` | 806 |
| Electron main files | `rg --files apps/electron/src/main \| wc -l` | 88 |
| Server-core files | `rg --files packages/server-core/src \| wc -l` | 268 |
| Test/spec files | `rg --files \| rg '(__tests__/|\\.test\\.|\\.spec\\.)' \| wc -l` | 774 |
| English locale keys | `node -e "...Object.keys(en).length"` | 3380 |
| Existing planning specs | `rg --files docs \| rg '(spec|prd|plan|roadmap).*\\.md$' \| wc -l` | 93 |
| Cloud providers currently exported | `rg 'Provider' packages/cloud-runner/src` | Local, Native, Cloudflare, Modal; Daytona absent |
| Worktree exclusions | `git status --short` | unrelated `.omo/` and empty `Bn` preserved |

## Program Status Matrix

| Program | Status | Release priority |
|---|---|---|
| Local Notes foundation | partial | P0 |
| Session Pipeline Canvas | P0 draft only | P0 |
| Session List/Table/Kanban | partial | P0 |
| Performance budgets | targets specified, incomplete proof | P0 |
| Browser retention | partial | P0 |
| Auth/provider onboarding | partial | P0 |
| Message actions/memory proposals | mostly absent | P1 |
| Tasks/Calendar/Reminders | playground/prototype only | P1 |
| Rox CLI/OMP parity | partial | P1 |
| Voice | absent | P1 |
| Daytona cloud runs | absent; legacy providers active | P1 |
| Account replica/sync | architecture only | P1, gated |
| Collaboration/share | architecture only | P2, gated |
| Browser profile import | absent | P2, privileged |
| Gamification/quests | backend fragments, no product loop | P2 |
| Hard Rox branding/i18n | partial | P2 |

## Issues

### Issue 00 — Upstream synchronization and branch hygiene

**Status:** ready · **Size:** S · **Dependencies:** none
**Ownership:** Git metadata, merge conflict resolution, generated artifacts only.

Tasks:

- Re-fetch `origin/main`, record the merge base and changed upstream surfaces.
- Rebase or merge only if `origin/main` gains commits; preserve all Rox commits.
- Run source/spec conflict audit for Notes, Canvas, AppShell, Cloud Runs and i18n.
- Remove no user artifacts; keep `.omo/` and `Bn` outside scoped commits.
- Produce a remote SHA readback after integration.

#### Scenarios

```gherkin
Scenario: Integrate a newer upstream safely
  Given origin/main contains changes not in the Rox branch
  When the synchronization issue is executed
  Then every Rox commit is reapplied without lost user work
  And the branch passes the scoped baseline gates
```

Acceptance: `git rev-list --left-right --count origin/main...HEAD` has zero on
the left; source tests and `git diff --check` pass.

### Issue 01 — Product data, consent and deletion contract

**Status:** blocked by `DG-01` · **Size:** L · **Dependencies:** none
**Ownership:** `packages/shared/src/privacy/**`, account settings, legal copy,
server audit/deletion stores.

Tasks:

- Define separate purposes: account recovery replica, real-time sync, AI
  indexing, cloud inference and product improvement/model training.
- Implement append-only consent events with version, scope, time, revocation and
  deletion status.
- Make UI controls truthful; a disabled control must stop that future purpose.
- Define local retention, remote deletion SLA, exports and deletion receipts.
- Explicitly exclude credentials/cookies/passkeys from general replica/training.
- Add a migration for existing users with no fabricated consent.

#### Scenarios

```gherkin
Scenario: Revoke cloud sync without deleting local data
  Given the account has an encrypted replica and real-time sync enabled
  When the user revokes real-time sync
  Then new sync operations stop immediately
  And local canonical files remain available
  And remote deletion status is visible
```

Acceptance: purpose-specific settings, audit tests, revocation integration test,
and a legal/product sign-off artifact.

### Issue 02 — Canonical Rox terminology and identity model

**Status:** ready · **Size:** M · **Dependencies:** Issue 01 for account terms
**Ownership:** shared domain vocabulary, i18n, agent identity settings.

Tasks:

- Define visible terms: Rox, Rox CLI, Rox Cloud, Agent Rox#001 and custom agent
  identity/persona/name.
- Keep OMP/Pi/Craft/Hermes as compatibility implementation metadata only.
- Add typed `AgentIdentity` with generated default and user-owned overrides.
- Remove false provider/model icons and runtime names from normal UI.
- Add a terminology linter and allowlisted compatibility contexts.

#### Scenarios

```gherkin
Scenario: User renames an agent
  Given the default identity is Agent Rox#001
  When the user chooses a name and persona
  Then all new session surfaces use that identity
  And runtime/provider metadata remains available only in technical detail
```

Acceptance: terminology scan, identity persistence tests and Russian/English/
Chinese screenshot matrix.

### Issue 03 — Performance and observability benchmark harness

**Status:** ready · **Size:** L · **Dependencies:** none
**Ownership:** `apps/electron/src/renderer/perf/**`, server tracing, benchmark
fixtures, no feature UI ownership.

Tasks:

- Add deterministic 500/2,000-session and large-vault fixtures.
- Instrument cold ready, cached session switch, view switch, Notes open, browser
  chrome, dropdown open and Canvas layout.
- Add IPC call counters to prevent session permission/metadata N+1 regressions.
- Add long-task, React commit and payload-size telemetry with local redaction.
- Create CI thresholds and a human-readable local performance report.
- Profile bundle/minification hangs separately from runtime performance.

#### Scenarios

```gherkin
Scenario: Cached session switch meets budget
  Given 2,000 indexed sessions and a warm renderer cache
  When the user switches to another cached session
  Then p95 interaction-to-content is below 120ms
  And no full collection reload occurs
```

Acceptance: benchmark report and fail-on-regression CI for declared budgets.

### Issue 04 — Shared premium menu and control system

**Status:** partial · **Size:** M · **Dependencies:** Issue 03
**Ownership:** shared UI primitives and tokens; consumers migrate in later issues.

Tasks:

- Consolidate native selects, long dropdowns, bulk bars, model selectors and
  filter panels onto one searchable/max-height/virtualized surface.
- Add anchored placement, collision handling, keyboard typeahead and focus return.
- Replace inconsistent shadows/radii with Rox tokens.
- Create compact, regular and inspector variants.
- Add deterministic playground stories for 5/50/1,000 items and narrow panels.

#### Scenarios

```gherkin
Scenario: Long menu remains usable
  Given a menu with 1,000 providers, skills or labels
  When the user opens and searches it with the keyboard
  Then it opens within 80ms without layout shift
  And the selected item remains visible
```

Acceptance: shared primitive tests, axe checks and screenshot baselines.

### Issue 05 — Sessions collection, table, Kanban and annual heatmap

**Status:** partial · **Size:** XL · **Dependencies:** Issues 03–04
**Ownership:** session collection state, table/list/board/heatmap adapters.

Tasks:

- Finish one canonical collection query/filter/sort/group model for all views.
- Redesign table selection and floating bulk actions with the shared control system.
- Normalize real model/harness icons, status, project, labels and due dates.
- Add annual heatmap with rounded cells, month labels, today focus and arrow-key
  navigation.
- Clicking a heatmap day opens a sortable table of sessions for that date.
- Add columns: size, messages, duration, tokens, tool calls, commits, parallel
  agents, created time and last-message time.
- Add filters for Codex, Claude, Hermes, OpenCode, OMP/Rox CLI and future agents.
- Persist view/display state per workspace; virtualize tables and boards.

#### Scenarios

```gherkin
Scenario: Inspect sessions from one heatmap day
  Given a year of mixed agent sessions
  When the user selects a heatmap cell with the keyboard
  Then the day table appears with sortable metrics and agent filters
  And today's date is the initial focus
```

Acceptance: collection contract tests, 2,000-session benchmark and desktop/
narrow visual matrix.

### Issue 06 — Local vault index, entities and link suggestions

**Status:** partial · **Size:** XL · **Dependencies:** Issue 01
**Ownership:** Notes provider/index workers and schema migrations.

Tasks:

- Define SQLite schema for documents, blocks, aliases, wikilinks, footnotes,
  tags, entities, tasks, session refs and calendar refs.
- Build full and incremental index rebuild from canonical Markdown.
- Extract named entities with provenance and reversible suggested merges.
- Generate outgoing/backlinks, unlinked mentions and ranked link suggestions.
- Add footnote creation/edit/navigation and broken-link diagnostics.
- Add index health, versioning, corruption recovery and no-network tests.

#### Scenarios

```gherkin
Scenario: Rebuild a lost index
  Given the SQLite index is deleted or corrupt
  When Rox rebuilds the vault index
  Then notes, links, entities and tasks are restored from Markdown
  And no canonical note content changes
```

Acceptance: fixture vault round-trip, incremental watcher tests and recovery proof.

### Issue 07 — Notes document IA and authoring completion

**Status:** partial · **Size:** L · **Dependencies:** Issue 06
**Ownership:** `NotesPage`, `pages/notes/**`, `NoteInspector`, Markdown editor.

Tasks:

- Finish collapsible/resizable Vault → TOC → Editor → Comments/Properties layout.
- Replace residual session-style modes with document breadcrumbs and views.
- Add persistent heading/task/spoiler folding and horizontal-rule shortcut.
- Add footnotes, block IDs, embeds, tables and safe paste/import.
- Add double-click/comment affordance and Google-Docs-style right comment rail.
- Complete wiki-link autocomplete, immediate note creation and outgoing-link panel.
- Add 2/3-column creation, resize, keyboard controls and portable serialization.
- Implement command palette for `!` actions and `@` references to sessions,
  agents, projects, tasks, people and entities.
- Finish local/English/Chinese copy and high-contrast dark/light themes.

#### Scenarios

```gherkin
Scenario: Write a structured local note
  Given a local Markdown note
  When the user adds headings, tasks, footnotes, wikilinks, comments and columns
  Then all structure survives save/reopen and external Markdown editing
  And the side rails restore their previous widths
```

Acceptance: Markdown round-trip corpus, Notes E2E and screenshot-backed rail QA.

### Issue 08 — Notes Bases, Table, Canvas, Outline and Graph views

**Status:** not started · **Size:** XL · **Dependencies:** Issues 06–07
**Ownership:** provider-neutral view engine, local canvas files, note projections.

Tasks:

- Define Obsidian-Bases-like query/view schema over indexed note properties.
- Implement Table/Base views with filters, formulas, grouping and saved layouts.
- Implement local JSON Canvas-compatible note canvas and card provenance.
- Add outline/Tana-style supertags, collapsible hierarchy and view toolbar.
- Add graph/entity view with local links, filters and progressive rendering.
- Add double-click note creation and daily-vault default destination.
- Support conversion between note, prompt/session draft and task without silent loss.

#### Scenarios

```gherkin
Scenario: Reopen a saved note view
  Given a Base or Canvas built from local notes
  When the workspace is reopened
  Then filters, layout, card links and source-note provenance are restored
```

Acceptance: schema tests, import/export fixtures and visual E2E for each view.

### Issue 09 — Session Canvas visual redesign

**Status:** P0 only · **Size:** L · **Dependencies:** Issues 03–04
**Ownership:** `SessionWorkflowEditor`, node cards, minimap, inspector and toolbar.

Tasks:

- Redesign cards with restrained radii, type/status hierarchy and port affordances.
- Replace opaque black minimap with translucent, stateful viewport/navigation.
- Make Fit/Reset/Run controls a compact native Rox toolbar.
- Add current-run state, selected-node inspector and visible execution progress.
- Add sticky notes, frames, groups, align/distribute/tile actions and smart guides.
- Add Heptabase-like magnetic arrows and accessible connection keyboard flow.
- Add running/waiting/error/selected visual baselines in dark and light themes.

#### Scenarios

```gherkin
Scenario: Navigate a large live trace
  Given a running workflow wider than the viewport
  When the user uses the minimap and selects a running node
  Then the viewport and inspector show its current state without losing context
```

Acceptance: interaction/screenshot matrix and Canvas performance budget.

### Issue 10 — Editable WorkflowSpec, versioning and execution

**Status:** draft nodes only · **Size:** XL · **Dependencies:** Issue 09
**Ownership:** WorkflowSpec schema/store, validation, run overlay and runners.

Tasks:

- Finalize typed nodes: note, model, tool, memory, subflow, condition, merge,
  human input, output and annotation/frame.
- Implement right-click palette, double-click default note and node conversion.
- Validate typed ports, cycles, required inputs and permission policy.
- Add save/version/import/export and deterministic layout persistence.
- Promote immutable session trace to editable workflow draft with provenance.
- Add `Run node`, `Run from here`, `Run selection` and `Run pipeline`.
- Persist run overlays and artifact links to exact WorkflowSpec version.
- Add replay, fork and compare versions.

#### Scenarios

```gherkin
Scenario: Version and replay a pipeline
  Given an editable workflow derived from a session
  When the user saves a version and runs it twice
  Then each run references the same immutable specification version
  And artifacts and state can be compared
```

Acceptance: schema/property tests, save/reopen E2E and local deterministic run.

### Issue 11 — Message reactions, highlight and hover dock

**Status:** annotations foundation only · **Size:** L · **Dependencies:** Issue 04
**Ownership:** TurnCard/message annotations and session event persistence.

Tasks:

- Add Telegram-like hover/tap dock with default heart and expandable emoji picker.
- Persist like/dislike/reaction events per message and aggregate counts.
- Add yellow transparent highlight and comment annotation using existing primitives.
- Add copy, quote/reply, share, learn and quick-action affordances.
- Ensure keyboard/touch alternatives and no hover-only functionality.
- Add local-first annotation migration and collaboration-ready actor metadata.

#### Scenarios

```gherkin
Scenario: React and highlight a message
  Given an assistant message
  When the user adds a heart and highlights one passage
  Then both survive reopen and remain attached to the same message/range
```

Acceptance: event parity tests, stale-anchor tests and hover/touch visual QA.

### Issue 12 — Side threads and quick challenge actions

**Status:** not started · **Size:** L · **Dependencies:** Issue 11
**Ownership:** message branch/thread model, side panel and prompt templates.

Tasks:

- Start a side thread from any user/assistant message with source provenance.
- Add quick prompts: grill, challenge, verify, counterarguments, rewrite,
  research and concise reply.
- Add a “magic” prompt-improvement button beside cloud execution.
- Implement meta-prompt sections: intent, examples, constraints, requirements,
  skills, risk, evidence, output schema and hardness.
- Let the user preview/edit the generated prompt before sending.
- Preserve thread status and return-to-parent navigation.

#### Scenarios

```gherkin
Scenario: Challenge one answer in a side thread
  Given a selected assistant message
  When the user chooses "Жёстко проверить"
  Then Rox opens a child thread with an editable generated prompt
  And the source message remains linked
```

Acceptance: prompt snapshot tests and branch/thread E2E.

### Issue 13 — Session learning and memory proposals

**Status:** memory backend partial · **Size:** XL · **Dependencies:** Issues 01, 11
**Ownership:** extraction workflow, proposal store, Memory UI and audit events.

Tasks:

- Trigger bounded post-session extraction by activity/close/explicit Brain action.
- Classify proposals as fact, preference, rule, event, credential reference or
  recurring action; credentials store references only.
- Show max 2–3 line blue proposal cards in chat.
- Actions: global forever, project only, reject, edit/improve and delete.
- Add conflict detection, source links, provenance, risk flags and expiry.
- Add review page, promotion/demotion and per-workspace disable.
- Add “learn from this session” side agent with lessons-learned preview.
- Account for inference tokens/cost and use a bounded Rox API model policy.

#### Scenarios

```gherkin
Scenario: Approve a project-scoped rule
  Given Rox extracts a reusable behavior from a session
  When the user edits it and chooses "Только для проекта"
  Then the rule applies only in that project
  And its source session and consent event remain visible
```

Acceptance: proposal lifecycle tests, conflict fixtures and end-to-end approval.

### Issue 14 — Embedded browser product integration

**Status:** lifecycle partial · **Size:** L · **Dependencies:** Issues 03–04
**Ownership:** BrowserPaneManager policy, browser UI, routing and session state.

Tasks:

- Route safe `http/https` links to the internal browser by default.
- Define explicit external/deep-link/auth/file/unsafe-scheme policy table.
- Make top `+` create a new session panel and a separate browser icon open Browser.
- Keep Sessions visible when Browser gains focus; fix “Browser closed” dead pane.
- Add tabs, history, downloads, profile indicator, inspect/devtools and restore.
- Preserve cookies/page/scroll/forms across route switches and app restart.
- Add agent-aware link instructions to Rox CLI context without forcing every URL.

#### Scenarios

```gherkin
Scenario: Open a link without losing session navigation
  Given the user is reading a Rox message
  When the user opens an https link
  Then it opens inside the retained browser panel
  And the session list remains available
```

Acceptance: pane lifecycle integration tests and real authenticated-page smoke.

### Issue 15 — Privileged browser profile import

**Status:** not started · **Size:** XL · **Dependencies:** Issues 01, 14, `DG-02`
**Ownership:** Electron main-process import worker, keychain/vault, audit UI.

Tasks:

- Discover all Safari, Chromium and Firefox profiles without reading secrets.
- Recommend explicit source profile, then most recently used on import day.
- Separate consent for history/bookmarks, cookies and credentials/passkeys.
- Import history/bookmarks into local profile index.
- Import cookies into encrypted browser partitions using reviewed SweetCookie-like
  adapters; no renderer transfer.
- Import passwords only with OS approval into the credential vault.
- Add dedupe, dry run, category counters, rollback and deletion receipts.
- Add locked-profile, corrupt DB, running-browser and unsupported-version states.

#### Scenarios

```gherkin
Scenario: Import bookmarks but not credentials
  Given several browser profiles are discovered
  When the user selects bookmarks/history and declines cookies/passwords
  Then only selected categories appear in the Rox profile
  And no credential store is accessed
```

Acceptance: fixture-based imports, macOS approval smoke and secret-leak scan.

### Issue 16 — Agent browser inspection and element editing

**Status:** partial browser tooling only · **Size:** L · **Dependencies:** Issue 14
**Ownership:** browser tool bridge, page annotations and user confirmation UI.

Tasks:

- Add inspect/grab element mode with stable selectors and screenshots.
- Let users attach comments/instructions to selected DOM elements.
- Support safe text/style/property edits in a preview transaction.
- Require explicit approval before destructive submit/purchase/publish actions.
- Persist element annotations with page URL/version and stale-selector handling.
- Reuse current-tab automation where possible; avoid a parallel hidden browser.

#### Scenarios

```gherkin
Scenario: Annotate an element for an agent
  Given a page is open in the Rox browser
  When the user grabs a component and writes an instruction
  Then the agent receives selector, screenshot and comment
  And the page is not mutated until approval
```

Acceptance: controlled local page E2E and stale-selector recovery tests.

### Issue 17 — Things-style Tasks domain

**Status:** playground only · **Size:** XL · **Dependencies:** Issues 06, 03–04
**Ownership:** task schema/store, Tasks screen, note/session links.

Tasks:

- Define Inbox, Today, Upcoming, Anytime, Someday and Logbook projections.
- Add projects, areas/lists, headings, subtasks, tags, priority, due/start time,
  evening and recurrence.
- Implement calm Things-like three-pane UI with keyboard-first quick entry.
- Add “Today plan” calendar strip and grouping by project/time.
- Link tasks bidirectionally to notes, sessions, messages and WorkflowSpec runs.
- Support drag/reorder, natural-language dates and offline operation.
- Add import/export and activity/audit history.

#### Scenarios

```gherkin
Scenario: Plan today from linked work
  Given tasks linked to notes and sessions
  When the user opens Today
  Then events and tasks are grouped into a readable daily plan
  And completing a task updates every projection without deleting provenance
```

Acceptance: task state-machine/property tests and desktop/narrow E2E.

### Issue 18 — Calendar and Reminders connectors

**Status:** not started · **Size:** XL · **Dependencies:** Issues 01, 17
**Ownership:** provider adapters, OAuth, sync journal and calendar UI.

Tasks:

- Build adapters for Google Calendar, Outlook/Microsoft, Yandex and Mail.ru where
  supported; specify capability gaps explicitly.
- Add Apple Reminders integration through a privileged macOS adapter.
- Implement OAuth/account connection, scoped calendars and revocation.
- Add timezone, recurrence, all-day, conflict and deletion semantics.
- Merge events with Today/Upcoming views without converting events into tasks.
- Add proactive reminder suggestions as editable proposals, never automatic spam.
- Add offline cache, incremental sync and conflict UI.

#### Scenarios

```gherkin
Scenario: Show connected events in Today
  Given Google Calendar is connected and task sync is offline-capable
  When the user opens Today
  Then cached events and local tasks appear together with correct timezone
  And revoking OAuth removes future sync without deleting local tasks
```

Acceptance: adapter contract suite and one live account test per provider.

### Issue 19 — Voice dictation, playback and wake word

**Status:** not started · **Size:** XL · **Dependencies:** Issues 01, 20
**Ownership:** local model manager, audio capture, transcription/TTS services, UI.

Tasks:

- Add local STT option: Whisper Large v3 Turbo via MLX on Apple Silicon and a
  documented fallback for other machines.
- Add cloud STT option through Rox/Deepgram with explicit audio retention policy.
- Add free Edge TTS fallback and optional local Fish Speech-compatible engine.
- Add per-message listen button, voice dictation button and live transcript edit.
- Add Russian wake phrase “Так, Рокс!” behind explicit always-listening consent.
- Implement VAD, device selection, model download/health and offline state.
- Add onboarding choices and accessible keyboard alternatives.

#### Scenarios

```gherkin
Scenario: Dictate locally without cloud audio
  Given the local Whisper model is installed
  When the user dictates a message
  Then transcription occurs locally and remains editable
  And no audio is uploaded
```

Acceptance: audio fixture accuracy, privacy network test and macOS live smoke.

### Issue 20 — Onboarding, accounts, providers and environment setup

**Status:** partial · **Size:** L · **Dependencies:** Issues 01–02, 14–19
**Ownership:** onboarding wizard, Account settings and import/setup resumability.

Tasks:

- Keep Rox account/auth before provider selection; support resume and skip.
- Present Rox as primary, subscriptions secondary, custom/local providers tertiary.
- Add environment questions: local/cloud models, STT/TTS, wake word, browser
  import categories, sync purposes and notifications.
- Make AI terminology plain Russian with inline explanations.
- Add custom agent rules and labels: `Обязательно`, `Запрет`, `На усмотрение`,
  custom.
- Keep every onboarding choice editable later in Settings.
- Add migration/versioned onboarding so existing users see only new questions.

#### Scenarios

```gherkin
Scenario: Skip optional setup and resume later
  Given a new user has signed in
  When they skip voice and browser import
  Then Rox remains usable
  And Settings offers the same setup without losing prior choices
```

Acceptance: all paths in wizard tests and locale screenshot matrix.

### Issue 21 — Quests, ratings and gamified onboarding

**Status:** backend fragments only · **Size:** L · **Dependencies:** Issue 20
**Ownership:** quest/rating schema, onboarding UI and telemetry consent boundary.

Tasks:

- Define non-manipulative quests for first note, first link, first task, first
  workflow, first browser action and privacy review.
- Add XP/badges/rating states without blocking core functionality.
- Use progress cards in the sidebar/banner slot inspired by the reference UI.
- Add dismiss/snooze and accessibility; never punish disabled cloud features.
- Add agent/session quality ratings with optional feedback and provenance.
- Separate local progress from opted-in product analytics.

#### Scenarios

```gherkin
Scenario: Complete an optional onboarding quest
  Given the user has not linked two notes
  When they complete the link quest
  Then local progress updates and the quest dismisses
  And no cloud analytics event is sent without consent
```

Acceptance: quest state tests and consent-aware analytics tests.

### Issue 22 — Rox CLI / OMP capability parity

**Status:** partial · **Size:** XL · **Dependencies:** Issues 02, 04
**Ownership:** backend interface, OmpAgent, shared events, skills UI and commands.

Tasks:

- Complete MCP source proxies with shared tool-def generator and permission parity.
- Map thinking stream to a collapsible “Рассуждение” surface.
- Implement true OMP branching with entry IDs and seeded fallback.
- Discover OMP skills read-only, show source badges and enable prompt injection.
- Produce a complete slash-command catalog in Russian with value/use-case and
  native UI location for share, join, export, vibe and every supported command.
- Map commands to buttons/menus/settings, leaving terminal syntax as secondary.
- Rename user-facing runtime to Rox CLI while preserving compatibility IDs.

#### Scenarios

```gherkin
Scenario: Use an OMP capability through Rox UI
  Given a Rox CLI session with an enabled MCP source
  When the model invokes the source and streams reasoning
  Then permissions, results and reasoning render through normal Rox surfaces
```

Acceptance: OMP/Pi parity matrix and live Electron scenarios for G1–G4.

### Issue 23 — Autonomous “magic word” workflows

**Status:** not started · **Size:** L · **Dependencies:** Issue 22
**Ownership:** workflow registry, composer hints, execution policy and docs.

Tasks:

- Define typed workflows for `ultragoal`, `ultrawork`, `agisota`, `board-room`,
  `ultragrill`, `trustrust`, `orchestrate workflowz` and existing words.
- Specify triggers, agents, evidence gates, concurrency, stop conditions and cost.
- Show active words/skills inline in the composer with hover explanations.
- Add explicit confirmation for high-cost/high-trust workflows.
- Make workflows reproducible WorkflowSpecs, not hidden prompt macros.
- Add cancellation, continuation and summary artifacts.

#### Scenarios

```gherkin
Scenario: Activate a magic workflow transparently
  Given the user types a supported magic word
  When the composer resolves it
  Then Rox shows the workflow, skills, cost class and stop condition before run
```

Acceptance: registry/schema tests and one deterministic scenario per workflow.

### Issue 24 — Capability packs, AGENTS.md, SOUL.md and tokenizer

**Status:** fragmented tools exist · **Size:** XL · **Dependencies:** Issues 22–23
**Ownership:** installer/catalog, agent context generation and capability policy.

Tasks:

- Inventory and license-review requested tools: Syft, CodeWiki, DeepWiki variants,
  Understand Anything, CodeGraph variants, Graphify, Archify, visual-explainer,
  summarize, fs-safe, agent-scripts, CUA, remindctl, tokentally, SweetCookie,
  sweetlink, Firecrawl tools and document tooling.
- Group them into installable packs: code intelligence, browser, documents,
  reminders, security/SBOM and research.
- Pin versions/checksums; do not globally install or auto-enable high-risk tools.
- Generate Rox AGENTS.md capability heuristics: when to activate, expected output,
  permission and unusual-use guidance.
- Add Rox CLI `SOUL.md` as optional identity/values context, distinct from policy.
- Add provider-aware universal token estimation and actual usage reconciliation.
- Add health/update/removal UX and offline capability report.

#### Scenarios

```gherkin
Scenario: Agent selects an installed capability pack
  Given a URL or repository task and installed code-intelligence tools
  When the agent plans the task
  Then it selects the smallest appropriate tool with stated expected output
  And requests permissions only when required
```

Acceptance: install/uninstall idempotency, provenance manifest and capability
selection fixtures.

### Issue 25 — Daytona-only cloud runner adapter

**Status:** absent · **Size:** XL · **Dependencies:** Issues 01, 03, 22, `DG-04`
**Ownership:** `packages/cloud-runner`, server RPC, settings and cloud-run UI.

Tasks:

- Implement `DaytonaProvider` against current CloudRunProvider contract.
- Move supplied credentials into secret-reference storage; never log values.
- Remove Cloudflare/Modal/E2B from normal provider registry and UI.
- Add project/snapshot/sandbox, budget, TTL, region and image settings.
- Implement start/ready/running/done/failed/cancelled/expired lifecycle.
- Add cancel/kill, watchdog, zombie cleanup and durable artifact import.
- Run conformance with bounded real Daytona resources and cleanup receipts.
- No provider fallback on Daytona failure.

#### Scenarios

```gherkin
Scenario: Run a bounded Daytona job
  Given a valid secret reference, budget and TTL
  When the user starts and then cancels a cloud run
  Then the Daytona sandbox terminates and final state is read back
  And no other provider receives the job
```

Acceptance: conformance suite, live sandbox lifecycle and zero secret leakage.

### Issue 26 — Advanced Cloud Runs product

**Status:** partial legacy UI/backend · **Size:** XL · **Dependencies:** Issue 25
**Ownership:** cloud-run domain/UI/artifacts/automations.

Tasks:

- Resume failed run, true cancel/kill, bounded concurrency and multi-tool research.
- Structured artifacts, model mix, run fork and session-topic prefill.
- Schedules, presets, artifact preview, failure details and cost estimate.
- Streaming progress, shared read-only result, report-to-presentation pipeline.
- Nightly conformance, zombie guard and import sanitizer.
- Restore OMP runner path and multi-run personas on Daytona only.
- Remove obsolete Cloudflare/Modal assumptions from F1–F22 spec and code.

#### Scenarios

```gherkin
Scenario: Resume a failed research run
  Given a Daytona run failed after a durable checkpoint
  When the user resumes it with the same bounded policy
  Then execution continues from the checkpoint and artifacts remain linked
```

Acceptance: revised F1–F22 dependency matrix and provider conformance.

### Issue 27 — Encrypted account replica and device sync

**Status:** architecture only · **Size:** XXL · **Dependencies:** Issues 01, 06,
17, `DG-01`
**Ownership:** sync protocol, server tenancy, crypto/key lifecycle and conflict UI.

Tasks:

- Define encrypted operation journal for notes, tasks, sessions and settings.
- Bind every workspace to authenticated account membership server-side.
- Add per-category replica/sync controls and truthful state readback.
- Implement device enrollment, key rotation/recovery and revocation.
- Add CRDT/merge policy per data type; Markdown conflicts remain user-visible.
- Implement snapshot/bootstrap, incremental sync and offline queue.
- Add exports, deletion requests, receipts and multi-device recovery tests.
- Explicitly exclude operational credentials/cookies/passkeys.

#### Scenarios

```gherkin
Scenario: Recover on a second device
  Given an account replica exists and a new device is enrolled
  When the user signs in and decrypts the workspace
  Then allowed categories are restored
  And excluded credential categories remain absent
```

Acceptance: two-device deterministic suite, tenancy attack tests and key-loss drill.

### Issue 28 — Collaboration, “Позвать Бро”, sharing and publication

**Status:** architecture only · **Size:** XXL · **Dependencies:** Issues 01, 11–13,
27, `DG-03`
**Ownership:** invite service, presence, session permissions, public publication.

Tasks:

- Define invite URL `bro.rox.one/@username/{sessionId}/{joinKey}` with one-time,
  expiry, role and revocation semantics.
- Generate QR/link/contact-share card in chat from “Позвать Бро”.
- Require Rox account/app and server-side membership before session access.
- Add presence avatars/status under session controls and multi-author prompts.
- Define conflict model for simultaneous prompts/annotations.
- Separate collaboration from immutable read-only publication/share.
- Add public redaction preview, expiry, abuse controls and deletion.
- Add OMP share/join/export/vibe mapping to native surfaces.

#### Scenarios

```gherkin
Scenario: Invite another Rox user to a session
  Given the owner generates a one-time collaborator invite
  When an authenticated user joins before expiry
  Then presence and permissions become visible
  And a reused/revoked key grants no access
```

Acceptance: two-user E2E, authorization fuzz tests and publication redaction test.

### Issue 29 — Paid per-user Grok bot / Daytona sandbox

**Status:** not started · **Size:** XL · **Dependencies:** Issues 25, 27–28
**Ownership:** paid entitlement, sandbox templates, native Rox surface.

Tasks:

- License/security review `agisota/grok-bot-0.18-reconstructed` before reuse.
- Define a Rox-native mode/tab instead of embedding its raw UI.
- Provision paid-only per-user Daytona sandbox from a hardened template.
- Bind lifecycle to account entitlement, budgets, inactivity TTL and cleanup.
- Expose sessions/artifacts through typed Rox contracts, not shared filesystem.
- Add operator controls, health, backup/export and incident shutdown.

#### Scenarios

```gherkin
Scenario: Provision a paid isolated bot workspace
  Given an entitled user requests the feature
  When Rox provisions the Daytona template
  Then the sandbox is isolated, budgeted and linked to that account only
```

Acceptance: license decision, threat model, provisioning conformance and teardown.

### Issue 30 — Code intelligence and repository visualization

**Status:** fragmented prototypes/tools · **Size:** XL · **Dependencies:** Issues 08,
10, 24
**Ownership:** code index adapters, graph schema, note/canvas projections.

Tasks:

- Evaluate requested CodeWiki/DeepWiki/CodeGraph/Graphify/Archify tools against one
  adapter contract: symbols, edges, summaries, citations and incremental updates.
- Select smallest maintained/licensable set; record rejected duplicates.
- Add SBOM with Syft and repository safety scan before agent ingestion.
- Index repositories locally and materialize linked architecture notes/canvas.
- Add visual explainer output with source-line provenance.
- Make tools agent-discoverable through capability packs, not always-on daemons.

#### Scenarios

```gherkin
Scenario: Explain a repository with provenance
  Given a local repository is approved for indexing
  When the user requests an architecture map
  Then every graph node links to a source symbol and commit
```

Acceptance: adapter benchmark on representative repositories and citation audit.

### Issue 31 — Research, Exa/search and source presentation

**Status:** generic search exists · **Size:** L · **Dependencies:** Issues 01, 24
**Ownership:** research policy, query planner, source UI and citation store.

Tasks:

- Add evidence planner for links/reference analysis with primary-source priority.
- Support bounded parallel multilingual and domain/dork queries with explicit
  result/cost/time caps; do not hardcode 10–15×50 requests for every message.
- Deduplicate, rank and preserve query/source provenance.
- Highlight sourced statements with unobtrusive dotted underline and hover card.
- Add source reliability, date and contradiction indicators.
- Cache/search results according to consent and provider terms.

#### Scenarios

```gherkin
Scenario: Research a referenced URL
  Given a user asks to analyze a current external source
  When the research planner runs bounded multilingual queries
  Then the answer cites deduplicated sources and exposes query provenance
```

Acceptance: research fixture evaluation, cost cap test and citation UI smoke.

### Issue 32 — Sidebar, dashboard cards and hard Rox design pass

**Status:** partial · **Size:** L · **Dependencies:** Issues 02–05, 17, 21
**Ownership:** AppShell/sidebar, tokens, workspace switcher and dashboard cards.

Tasks:

- Refine workspace switcher, profile card and onboarding/reminder promo slot.
- Use top mini-dashboard cards for sessions, tokens/cost, active agents, tasks and
  sync/cloud state; never decorative fake numbers.
- Reduce merged black panes; add borders/gutters/elevation and collapsible rails.
- Apply premium graphite Rox visual language without copying reference pixels.
- Replace generic plus/browser/cloud/info controls with clear icons/tooltips.
- Finalize full-screen/narrow/three-pane responsive behavior.
- Add complete Russian/English/Simplified Chinese copy and locale-specific QA.

#### Scenarios

```gherkin
Scenario: Read a dense workspace at a glance
  Given sessions, tasks and agents are active
  When the user opens the main workspace
  Then sidebar and dashboard cards show real current state with clear hierarchy
```

Acceptance: token audit, visual regression matrix and no-fake-data checks.

### Issue 33 — Final Rox branding, packaging and migration

**Status:** partial branding · **Size:** XL · **Dependencies:** Issues 02, 20, 22,
25, 32, `DG-05`
**Ownership:** package metadata, app IDs, schemes, config migration, docs/installers.

Tasks:

- Replace visible Craft/Pi/OMP/Hermes names with Rox taxonomy across app/web/docs.
- Migrate config directories, app names, deep links and user data with rollback.
- Preserve old aliases long enough for imports/updates; emit deprecation diagnostics.
- Finalize `rox.one`, `bro.rox.one`, update endpoints and signed artifacts.
- Decide/package Geist legally or use a documented system fallback.
- Build/notarize macOS; prepare Windows/Linux packaging and update channels.
- Add clean install, upgrade, downgrade, export and uninstall tests.

#### Scenarios

```gherkin
Scenario: Upgrade an existing Craft-era installation
  Given old local sessions, credentials and browser state
  When the user installs the Rox-branded release
  Then data migrates once and the app opens under Rox identity
  And rollback preserves the original data
```

Acceptance: migration matrix, signed build/notarization and download verification.

### Issue 34 — Security, privacy and release assurance

**Status:** continuous · **Size:** XL · **Dependencies:** all trust-boundary issues
**Ownership:** threat models, CI gates, incident controls and release evidence.

Tasks:

- Threat-model account sync, invites, browser import, voice and Daytona separately.
- Add authorization tests for every cloud RPC and cross-workspace identifier.
- Add secret/log/artifact scans and credential-reference enforcement.
- Add sandbox/network/filesystem policies for agents and cloud runs.
- Add dependency/SBOM/vulnerability and license gates for adopted repositories.
- Add backup/restore, deletion, incident kill switch and audit exports.
- Produce release evidence bundle: tests, screenshots, performance, security,
  migrations, live smoke and remote/download readback.

#### Scenarios

```gherkin
Scenario: Reject cross-workspace access
  Given a valid user authenticated to workspace A
  When the client submits an identifier from workspace B
  Then the server denies access and records a safe audit event
```

Acceptance: red-team suite, release checklist and independent verification.

## Slice Validation Plan

| Slice | First failing test | Write scope | Lane | Acceptance scenario |
|---|---|---|---|---|
| S0 | upstream conflict fixture | Git metadata/spec reconciliation | integration | integrate newer upstream |
| S1 | consent revocation lifecycle | privacy/account server + settings | L2/L3 | revoke sync |
| S2 | 2,000-session benchmark | perf fixtures/instrumentation | benchmark | cached switch |
| S3 | vault rebuild fixture | local index only | L1/L2 | rebuild index |
| S4 | Notes structured round-trip | Notes/editor only | L2/L3 | structured note |
| S5 | WorkflowSpec save/reopen | Canvas/schema/store | L2/L3 | version/replay |
| S6 | heatmap day navigation | collection/heatmap | L2/L3 | inspect day |
| S7 | reaction/annotation parity | messages/annotations | L1/L3 | react/highlight |
| S8 | memory proposal approval | memory proposal store/UI | L2/L3 | approve project rule |
| S9 | browser retained link | browser manager/UI | L2/L3 | internal link |
| S10 | profile import category isolation | privileged importer | L2/security | import bookmarks only |
| S11 | task Today projection | task domain/UI | L1/L3 | plan today |
| S12 | calendar adapter contract | connector package | L2/live | show connected events |
| S13 | offline STT fixture | voice services/UI | L2/live | local dictation |
| S14 | OMP parity contract | OmpAgent/shared/UI | L2/live | source + reasoning |
| S15 | magic workflow schema | workflow registry | L1/L3 | transparent activation |
| S16 | Daytona conformance | cloud runner/server/UI | L2/live | bounded Daytona run |
| S17 | two-device sync | sync service/desktop | L3/security | recover second device |
| S18 | two-user invite | collab service/UI | L3/security | join/revoke invite |
| S19 | branding migration fixture | packaging/migration | L2/release | upgrade old install |

## Tests

- **Unit:** pure domain reducers, schemas, permission/policy selectors, parser and
  adapter fixtures.
- **Integration:** RPC registration/parity, persistence/reopen, local index,
  provider conformance and migration rollback.
- **E2E:** deterministic renderer playground plus native Electron journeys.
- **Security:** cross-workspace IDs, invite replay, secret redaction, browser
  category isolation and sandbox escape attempts.
- **Performance:** 500/2,000-session, large vault, long menus, Canvas and browser
  lifecycle benchmarks with declared p95 thresholds.
- **Release:** clean install, upgrade/downgrade, signed artifact, update channel,
  remote SHA and public/private download readback.

## Wave Validity

| Check | Status | Notes |
|---|---|---|
| Distinct write scopes within waves | conditional | serialize AppShell, shared i18n and protocol edits |
| Shared migrations declared first | pass | privacy/index/task/sync schemas precede consumers |
| Shared CLI surfaces serialized | pass | Issues 22–24 execute sequentially |
| Integration order declared | pass | see Execution Order |
| One owner per slice | required | assign at execution time; no joint writes |
| Rollback/discard path | pass | feature flags, schema versioning and revertable commits |

**Wave decision:** parallel only for rows with disjoint files; all shared
`AppShell.tsx`, protocol, i18n, route and migration changes are sequential.

## Execution Order

### Wave 0 — Truth and safety gates

Issues 00–04. Freeze vocabulary, truthful consent, benchmark harness and shared
control primitives before high-surface feature work.

### Wave 1 — Local product core

Issues 05–10. Sessions views, vault index, Notes views and versioned Canvas. These
can partially parallelize, but Notes/Canvas share Markdown and reference schemas.

### Wave 2 — Interaction layer

Issues 11–16. Message actions, memory proposals and internal browser. Browser
profile import begins only after the consent schema lands.

### Wave 3 — Personal operating system

Issues 17–21. Tasks, Calendar, Voice, onboarding and quests. Task schema lands
before Notes/task links and Calendar projections.

### Wave 4 — Runtime and cloud

Issues 22–26 sequentially at shared runtime seams: Rox CLI parity → transparent
workflows → capability packs → Daytona → advanced Cloud Runs.

### Wave 5 — Account and multi-user

Issues 27–29. Encrypted replica precedes collaboration; paid Grok sandbox follows
Daytona tenancy, entitlements and cost controls.

### Wave 6 — Ecosystem and release

Issues 30–34. Code intelligence, research UX, design hardening, branding migration
and security/release assurance.

## File Dependency Matrix

| Surface | Primary files/packages | Issues |
|---|---|---|
| Shell/navigation | `AppShell.tsx`, routes, SurfaceTabs | 05, 14, 20, 32–33 |
| Sessions collection | `components/app-shell/session-*`, session RPC | 03, 05 |
| Notes/Knowledge | `NotesPage.tsx`, `pages/notes/**`, knowledge provider/index | 06–08, 13, 17 |
| Canvas/workflows | `SessionWorkflowEditor.tsx`, core workflow schemas/store | 09–10, 23 |
| Chat/messages | `ChatDisplay.tsx`, `TurnCard.tsx`, annotations/session events | 11–13 |
| Browser | `browser-pane-manager.ts`, browser renderer pages/import worker | 14–16 |
| Tasks/Calendar | **NEW** task domain/store/screens and connector adapters | 17–18 |
| Voice | **NEW** voice services, model manager and composer controls | 19–20 |
| Runtime/tools | OmpAgent/backend types/skills/source bridge | 22–24 |
| Cloud | `packages/cloud-runner`, cloud-runs RPC/UI | 25–26 |
| Sync/collab | **NEW** sync/collab services, membership/invite APIs | 27–29 |
| Shared governance | protocol DTO/channels, feature flags, i18n, migrations | all waves |

## File Conflict Matrix

| Shared file/surface | Conflicting issues | Rule |
|---|---|---|
| `AppShell.tsx` | 05, 14, 17, 20, 32–33 | sequential integration commits |
| shared protocol DTO/channels | 10–13, 17–19, 25–29 | schema issue first, consumers later |
| i18n locale JSON | every UI issue | one locale owner per wave; sort/parity after merge |
| `TurnCard.tsx` | 11–13, 19, 22 | serialize message/voice/thinking changes |
| `NotesPage.tsx` | 07–08, 13, 17 | issue-local adapters; do not parallel-edit page |
| connection/provider settings | 20, 22, 25, 27 | canonical provider registry owner only |

## Cross-Wave Shared File Registry

| Shared seam | Owning wave | Consumer waves | Guard |
|---|---|---|---|
| protocol DTO/channels | first issue introducing each schema | all later consumers | registration parity + typecheck |
| i18n locale JSON | one owner per wave | every UI issue | sort/parity/coverage |
| `AppShell.tsx` | integration owner per wave | collection/browser/task/branding | sequential commits |
| feature flags/preferences | Wave 0 governance | cloud/sync/browser/voice | migration + default-state tests |
| local reference schema | Wave 1 Knowledge | tasks/memory/canvas/sync | canonical round-trip corpus |
| provider registry | Wave 4 runtime/cloud | onboarding/cloud/release | no implicit fallback test |
| tenancy membership | Wave 5 sync | collaboration/publication | cross-workspace attack tests |

## Roll-up Acceptance

| Intent scenario | Issues | Required evidence |
|---|---|---|
| Local note works offline | 06–08 | offline save/rebuild/reopen E2E |
| Session becomes pipeline | 09–10 | WorkflowSpec version/replay E2E |
| Browser state survives | 14–16 | retained authenticated-page smoke |
| Credentials stay secret | 01, 15, 34 | secret scan + category isolation |
| Memory is proposed | 11–13 | approval lifecycle E2E |
| Daytona only | 25–26 | live conformance and provider registry readback |
| Collaboration membership | 27–28, 34 | two-user + attack test |
| Navigation stays fast | 03–05 | p95 benchmark report |
| Voice is controlled | 19–20 | local/cloud privacy test |
| Branding hides internals | 02, 32–33 | terminology scan + screenshots |

## Conformance Checks

| Area | Check type | Check |
|---|---|---|
| Every source issue | tests | `bun test path/to/issue-owned.test.ts` |
| Shared types | command | `bun run typecheck:all` |
| UI copy | command | `bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage` |
| Diff hygiene | command | `git diff --check` |
| Renderer | build | non-minified compile gate plus release minified build |
| UI behavior | E2E | deterministic playground and native Electron smoke |
| Performance | benchmark | p95 budgets from Issue 03 |
| Secrets | security | staged secret scan; no credential values in logs/artifacts |
| Cloud/auth | security | cross-workspace authorization and provider-fallback tests |
| Release | readback | signed artifact/download/update and remote SHA readback |

## Verification Commands

```bash
bun run typecheck:all
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
bun run lint
bun test
bun run test:visual
git diff --check
```

Each live-provider issue adds its own bounded conformance command and cleanup
receipt. Browser credential, collaboration and sync issues also require scoped
secret and authorization attack tests.

## Planning Rules Compliance

| Rule | Status | Justification |
|---|---|---|
| PR-001 Mechanical Enforcement | PASS | every issue has a mechanical or live gate |
| PR-002 External Validation | PASS | provider/browser/account programs require live conformance |
| PR-003 Feedback Loops | PASS | performance, memory, sync and cloud expose durable state |
| PR-004 Separation Over Layering | PASS | credentials, replica, sync, collaboration and publication are separate |
| PR-005 Process Gates First | PASS | consent, tenancy, schemas and benchmarks precede UI consumers |
| PR-006 Cross-Layer Consistency | PASS | file/conflict matrices serialize shared seams |
| PR-007 Phased Rollout | PASS | seven waves with feature flags and rollback paths |

Unchecked rules: 0.

## Post-Merge Cleanup

- Search modified scope for `TODO|FIXME|HACK|XXX` and resolve/track intentionally.
- Remove stale Craft/OMP/Pi names only after migration aliases are verified.
- Re-run locale sort/parity and protocol registration parity.
- Read back remote branch SHA, signed artifacts and live provider state.
- Preserve source receipts and recovery manifests for background services.

## Next Steps

1. Review/lock decision gates `DG-01`–`DG-05`.
2. Convert Wave 0 and Wave 1 issues into tracker items with one owner each.
3. Execute Issue 03 benchmark harness first; it provides objective gates for all
   subsequent UI work.
4. Run a pre-mortem on Issues 15, 25, 27 and 28 before implementation.
