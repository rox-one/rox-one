# Plan: ROX Master Backlog (35 issues)

id: plan-2026-09-02-rox-master-backlog
date: 2026-09-02
intent: `.agents/intents/2026-09-02-rox-product-program.md`
branch_convention: `cursor/<descriptive-name>-6a75` for this Wave 0 landing
preferred_base: `main`

## How to use this plan

- **Wave 0 (this landing):** Issue 00 + Issue 03 only.
- **Do not implement** Issues 01, 02, 04–34 in the Wave 0 PR except tiny
  supporting hooks the harness needs.
- **Do not implement** DG-01..DG-05 product decisions.
- Tracker GitHub issues were **not** bulk-created. Prefer these files.

## Completed Baseline

Already in tree. Do **not** recreate as new product work.

| Surface | Notes |
|---------|--------|
| Canvas P0 | Session-map / xyflow P0 shipped |
| Local Markdown Notes | `NotesPage` + local vault |
| Browser retention | Embedded browser pane + bounds sync |
| Onboarding | Wizard + provider choice |
| Geist | UI typeface |
| Provider badges | Model/connection badges |
| SiYuan opt-in | Graph/mindmap gated on connection |
| Localized column resize | i18n-safe column drag |

## Issue 00 result (Wave 0)

Recorded after `git fetch origin main` on 2026-09-02:

| Field | Value |
|-------|--------|
| `origin/main` | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| `HEAD` (at fetch) | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| merge-base | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| `rev-list --left-right --count origin/main...HEAD` | `0	0` |
| Rebase/merge | **not required** — already even |
| `git diff --check` | pass |
| `.omo/` / stray `Bn` | none committed |

Upstream surfaces to re-audit on the next fetch (Notes, Canvas, AppShell,
Cloud Runs, i18n): no new `origin/main` commits beyond HEAD at Wave 0.

Preserve all Rox commits if a future fetch is ahead. Never force-push
`main`. Never commit `.omo/` or stray `Bn` artifacts.

---

## Wave 0 — Hygiene and observability

### Issue 00 — Upstream synchronization and branch hygiene

- **Status:** done (Wave 0)
- **Size:** S
- **Dependencies:** none
- **Ownership:** git only
- **Tasks:**
  - Re-fetch `origin/main`
  - Record merge-base and changed upstream surfaces
  - Rebase or merge **only** if `origin/main` has commits not in HEAD
  - Preserve all Rox commits
  - Audit conflicts for Notes, Canvas, AppShell, Cloud Runs, i18n
  - Do not commit `.omo/` or stray `Bn` artifacts
- **Acceptance:** `git rev-list --left-right --count origin/main...HEAD`
  has 0 on the left; `git diff --check` passes.

### Issue 01 — Batch permission and session-metadata IPC

- **Status:** planned (not in Wave 0)
- **Size:** M
- **Dependencies:** Issue 03 counters
- **Ownership:** `App.tsx` `reconcilePermissionModeState`, sessions RPC
- **Tasks:** Replace per-session `sessions:getPermissionModeState` fan-out
  after `getSessions` with one batched snapshot. Keep collection metadata
  on `sessions:get` (already message-free).
- **Gherkin:**
  ```
  Scenario: Collection load is O(1) permission IPC
    Given N indexed sessions
    When the renderer loads the collection
    Then permission-mode state is fetched in at most one IPC
    And the Issue 03 counter does not flag N+1
  ```
- **Acceptance:** Harness N+1 detector stays green on a real collection load.

### Issue 02 — Cached session switch without collection reload

- **Status:** planned (not in Wave 0)
- **Size:** M
- **Dependencies:** Issue 03, Issue 01
- **Ownership:** `SessionItem`, `ChatPage`, `sessionMetaMapAtom`
- **Tasks:** Cached switch reads Jotai meta + already-loaded messages.
  Do not call `sessions:get` or rebuild the collection.
- **Gherkin:** same as Issue 03 scenario (product path, not fixtures-only).
- **Acceptance:** Real UI path meets the 120ms p95 budget with zero
  collection reloads.

### Issue 03 — Performance and observability benchmark harness

- **Status:** ready — **implement in Wave 0**
- **Size:** L
- **Dependencies:** none
- **Ownership:** `apps/electron/src/renderer/perf/**`, server tracing,
  benchmark fixtures. **No feature UI ownership.**
- **Tasks:**
  - Deterministic 500 / 2,000-session and large-vault fixtures
  - Instrument cold ready, cached session switch, view switch, Notes open,
    browser chrome, dropdown open, Canvas layout
  - IPC call counters against session permission/metadata N+1
  - Long-task, React commit, and payload-size telemetry with local redaction
  - CI thresholds and a human-readable local performance report
  - Profile bundle/minification hangs on a **separate** track
- **Gherkin:**
  ```
  Scenario: Cached session switch meets budget
    Given 2,000 indexed sessions and a warm renderer cache
    When the user switches to another cached session
    Then p95 interaction-to-content is below 120ms
    And no full collection reload occurs
  ```
- **Acceptance:** Benchmark report + fail-on-regression CI for declared
  budgets. Headless: `bun run test:perf`.
- **How to run:**
  ```bash
  bun test apps/electron/src/renderer/perf
  bun run test:perf
  bun run scripts/perf-benchmark.ts --report /tmp/rox-perf-report.md
  ```

---

## Wave 1 — Session collection at 2,000

### Issue 04 — Session list virtualization at 2,000

- **Status:** planned
- **Size:** L
- **Dependencies:** 03
- **Ownership:** `SessionList`, list virtualization
- **Tasks:** Keep 2,000-row list scrolling within list budget; no extra
  `sessions:get` on scroll.
- **Acceptance:** Harness list-scroll probe (when added) stays under budget.

### Issue 05 — Table collection at 2,000

- **Status:** planned
- **Size:** M
- **Dependencies:** 03, 04
- **Ownership:** `SessionTableHost`
- **Tasks:** Existing table virtualization holds 2,000 rows; no full
  reload on sort/filter of cached meta.
- **Acceptance:** Table open + filter p95 within Wave 1 table budget.

### Issue 06 — Board collection at 2,000

- **Status:** planned
- **Size:** M
- **Dependencies:** 03
- **Ownership:** kanban board
- **Tasks:** Column render stays incremental; rank ops do not refetch
  the full collection.
- **Acceptance:** Board paint + drag commit within budget.

### Issue 07 — Session content search at 2,000

- **Status:** planned
- **Size:** M
- **Dependencies:** 03
- **Ownership:** `useSessionSearch`
- **Tasks:** Debounced ripgrep IPC already exists; add harness mark and
  cancel-on-type budget.
- **Acceptance:** Search IPC p95 and no duplicate in-flight calls.

### Issue 08 — Unread and badge recompute budget

- **Status:** planned
- **Size:** S
- **Dependencies:** 03
- **Ownership:** `getUnreadSummary`, session badges
- **Tasks:** Unread summary stays O(workspaces), not O(sessions×IPC).
- **Acceptance:** Counter shows ≤1 unread-summary IPC per refresh.

---

## Wave 2 — Surface interaction budgets

### Issue 09 — Notes open / large-vault index

- **Status:** planned
- **Size:** L
- **Dependencies:** 03 (fixtures include large vault)
- **Ownership:** `NotesPage` (product; harness already marks `notes-open`)
- **Tasks:** Open Notes against the large-vault fixture without walking
  the vault on every keystroke.
- **Acceptance:** Notes-open p95 within declared notes budget.

### Issue 10 — Notes search and folder tree

- **Status:** planned
- **Size:** M
- **Dependencies:** 09
- **Ownership:** Notes sidebar + search
- **Tasks:** Folder counts and search stay incremental.
- **Acceptance:** Search/filter does not reload the vault.

### Issue 11 — Browser chrome first paint

- **Status:** planned
- **Size:** M
- **Dependencies:** 03
- **Ownership:** `BrowserPanelPage`, browser-pane manager
- **Tasks:** Bounds sync already rAF-throttled; meet chrome budget
  without extra `browser-pane:list` fan-out.
- **Acceptance:** `browser-chrome` mark p95 within budget.

### Issue 12 — Dropdown and menu open budget

- **Status:** planned
- **Size:** S
- **Dependencies:** 03
- **Ownership:** `dropdown-menu.tsx` (harness already marks open)
- **Tasks:** Session menu / model picker stay under dropdown budget.
- **Acceptance:** `dropdown-open` p95 within budget.

### Issue 13 — Canvas / session-map layout budget

- **Status:** planned
- **Size:** M
- **Dependencies:** 03 (harness marks `canvas-layout`)
- **Ownership:** `SessionWorkflowEditor`
- **Tasks:** xyflow layout pass stays within canvas budget for P0-sized
  graphs. No Canvas P1 product in Wave 0.
- **Acceptance:** `canvas-layout` p95 within budget.

### Issue 14 — Entity view switch budget

- **Status:** planned
- **Size:** S
- **Dependencies:** 03
- **Ownership:** `EntityViewTabs` / `useEntityView`
- **Tasks:** View switch is local state + storage; no collection reload.
- **Acceptance:** `view-switch` p95 within budget; 0× `sessions:get`.

---

## Wave 3 — Knowledge and outline

### Issue 15 — Knowledge navigator scale

- **Status:** planned
- **Size:** L
- **Dependencies:** 03, 09
- **Ownership:** knowledge tree
- **Tasks:** Envelope batch (`knowledge.envelopes.getMany`) stays the
  only list fetch. N+1 RPC remains forbidden.
- **Acceptance:** Navigator open meets knowledge budget.

### Issue 16 — SiYuan opt-in follow-through

- **Status:** planned
- **Size:** M
- **Dependencies:** baseline SiYuan opt-in
- **Ownership:** graph/mindmap tabs
- **Tasks:** Disabled tabs stay cheap; enabled path lazy.
- **Acceptance:** SiYuan-disconnected session does not import SiYuan UI.

### Issue 17 — Outline view

- **Status:** planned
- **Size:** M
- **Dependencies:** 14, 15
- **Ownership:** entity outline
- **Tasks:** Outline from already-loaded document; no extra collection IPC.
- **Acceptance:** Outline open within view-switch family budget.

### Issue 18 — Graph view

- **Status:** planned
- **Size:** M
- **Dependencies:** 16
- **Ownership:** SiYuan graph surface
- **Tasks:** Graph mounts only when connected + selected.
- **Acceptance:** Graph first layout recorded on the canvas track.

---

## Wave 4 — Shell residuals (extend baseline, do not recreate)

### Issue 19 — AppShell cold ready

- **Status:** planned
- **Size:** M
- **Dependencies:** 03
- **Ownership:** `App.tsx`, `AppShell`
- **Tasks:** First ready uses one `sessions:get`; harness `cold-ready`
  mark already exists.
- **Acceptance:** Cold-ready p95 within cold budget on 500-session fixture.

### Issue 20 — Column resize / layout persistence follow-through

- **Status:** planned
- **Size:** S
- **Dependencies:** baseline localized column resize
- **Ownership:** table columns
- **Tasks:** Persistence must not retrigger collection reload.
- **Acceptance:** Resize commit 0× `sessions:get`.

### Issue 21 — Provider badge and model picker latency

- **Status:** planned
- **Size:** S
- **Dependencies:** baseline provider badges, 12
- **Ownership:** model picker
- **Tasks:** Picker open uses cached connection list.
- **Acceptance:** Picker open within dropdown budget.

### Issue 22 — Onboarding residual

- **Status:** planned
- **Size:** S
- **Dependencies:** baseline onboarding
- **Ownership:** `OnboardingWizard`
- **Tasks:** No perf work that rewrites onboarding UX.
- **Acceptance:** Onboarding not on the Wave 0 critical path.

### Issue 23 — Geist / theme residual

- **Status:** planned
- **Size:** S
- **Dependencies:** baseline Geist
- **Ownership:** theme
- **Tasks:** Font/theme swap must not remount the session collection.
- **Acceptance:** Theme toggle 0× `sessions:get`.

---

## Wave 5 — Observability closeout and release

### Issue 24 — Cloud Runs list observability

- **Status:** planned
- **Size:** S
- **Dependencies:** 03
- **Ownership:** cloud-runs RPC (read-only marks)
- **Tasks:** List/status IPC counted; no Cloud Runs product rewrite.
- **Acceptance:** Counters exist; no new UI.

### Issue 25 — i18n parity residual

- **Status:** planned
- **Size:** S
- **Dependencies:** none
- **Ownership:** `packages/shared/src/i18n/locales/*`
- **Tasks:** Any new user-facing string from later issues: 10 locales,
  ASCII-sorted keys, ru default. Wave 0 harness has **no** UI strings.
- **Acceptance:** `bun test packages/shared/src/i18n` + lint:i18n:*

### Issue 26 — IPC channel audit

- **Status:** planned
- **Size:** S
- **Dependencies:** 03
- **Ownership:** `apps/electron/src/shared/ipc-call-counter.ts`
- **Tasks:** Keep the watch list current (`sessions:get`,
  `sessions:getPermissionModeState`, `sessions:getMessages`).
- **Acceptance:** New session-metadata channels are classified.

### Issue 27 — Bundle / minification hang isolation

- **Status:** planned (harness track exists in Wave 0)
- **Size:** M
- **Dependencies:** 03 `bundle-profile.ts`
- **Ownership:** electron renderer build
- **Tasks:** Treat minify/bundle hangs as a **separate** budget family.
  Do not mix into interaction p95.
- **Acceptance:** Bundle report never fails interaction CI.

### Issue 28 — Long-task and React commit budgets in product

- **Status:** planned
- **Size:** M
- **Dependencies:** 03 telemetry
- **Ownership:** AppShell Profiler (product wrap)
- **Tasks:** Optional `PerfProfiler` on AppShell; Wave 0 only ships the
  helper + tests.
- **Acceptance:** Commit/long-task samples appear in the local report.

### Issue 29 — RPC payload-size budgets

- **Status:** planned
- **Size:** S
- **Dependencies:** 03 (payload telemetry + `rpc.getSessions` bytes)
- **Ownership:** `packages/shared/src/utils/perf.ts`, sessions RPC
- **Tasks:** Fail CI if `sessions:get` payload bytes exceed the declared
  cap on the 2,000 fixture (metadata-only).
- **Acceptance:** Fixture payload stays under budget; bodies never included.

### Issue 30 — Telemetry redaction policy (settings)

- **Status:** planned
- **Size:** S
- **Dependencies:** 03 redact helpers
- **Ownership:** settings (product) — **not** Wave 0
- **Tasks:** If a user-facing export is ever added, it must run the same
  local redaction. No cloud export in this program unless a later issue
  explicitly says so.
- **Acceptance:** Redaction tests stay the source of truth.

### Issue 31 — Session family / collapse at 2,000

- **Status:** planned
- **Size:** M
- **Dependencies:** 04
- **Ownership:** `session-families`, list collapse
- **Tasks:** Family grouping stays CPU-bound on cached meta.
- **Acceptance:** Collapse/expand 0× collection IPC.

### Issue 32 — Workbench / mindmap residual

- **Status:** planned
- **Size:** M
- **Dependencies:** Canvas P0 baseline, 13
- **Ownership:** session workbench
- **Tasks:** No Canvas P1. Residual layout jank only.
- **Acceptance:** Workbench open uses `canvas-layout` mark.

### Issue 33 — Headless server perf

- **Status:** planned
- **Size:** M
- **Dependencies:** 03, existing `perf.start('rpc.getSessions')`
- **Ownership:** `packages/server-core` sessions RPC
- **Tasks:** `getSessions` stays metadata-only; rank backfill remains
  one-shot per workspace.
- **Acceptance:** Server span + payload bytes in the report.

### Issue 34 — Release checklist and tracker closeout

- **Status:** planned
- **Size:** S
- **Dependencies:** 00–33 as landed
- **Ownership:** this plan file
- **Tasks:** Update statuses; still do not bulk-open GitHub issues
  unless a tracker convention is adopted.
- **Acceptance:** Plan status table matches tree; Wave 0 evidence linked.

---

## DG checklist stub (execution only — not legal copy)

| ID | Decision | Wave 0 |
|----|----------|--------|
| DG-01 | (gated) | do not implement product |
| DG-02 | (gated) | do not implement product |
| DG-03 | (gated) | do not implement product |
| DG-04 | (gated) | do not implement product |
| DG-05 | (gated) | do not implement product |

Fill these only when a human owner records the actual decision. This
stub exists so later waves do not invent product behind a gate.

---

## Declared budgets (Issue 03)

| Interaction | p95 | Extra constraints |
|-------------|-----|-------------------|
| cached-session-switch | 120ms | 0× `sessions:get`; 0× permission fan-out |
| cold-ready (500) | 2500ms | ≤1× `sessions:get` |
| view-switch | 50ms | 0× collection reload |
| notes-open | 200ms | fixture-only in Wave 0 |
| browser-chrome | 200ms | fixture-only in Wave 0 |
| dropdown-open | 50ms | — |
| canvas-layout | 200ms | separate from bundle track |
| bundle/minify | n/a | **separate report**, never mixed |

IPC:

| Rule | Budget |
|------|--------|
| Collection load `sessions:get` | ≤ 1 |
| Collection load `sessions:getPermissionModeState` per session | 0 (product fix is Issue 01; harness **detects**) |
| Cached switch `sessions:get` | 0 |
| Cached switch `sessions:getMessages` if messages already in cache | 0 |

## Stack notes

- Bun tests: `bun test <path>`
- Typecheck: `bun run tsc --noEmit` in the package
- i18n: user-facing strings via `t()`; 10 locales; ASCII-sorted keys;
  ru default. Wave 0 harness is CLI/headless — no new locale keys.
- Prefer extending `packages/shared/src/utils/perf.ts` and
  `apps/electron/src/renderer/lib/perf.ts` over a new framework.
- No god files > 500 lines.
- No secrets in fixtures. Redact telemetry locally.
