# Session sidebar compact sort + cyclic views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit collection chrome into the sessions navigator, restore list/board/table switching with one cycle button (forward + previous), and keep kanban as a first-class layout.

**Architecture:** Keep existing `CollectionViewMode` and routes. Stop mounting `CollectionOpsBar` in the narrow `PanelHeader`. Add a cycle button (`list → board → table → list`, Shift+click reverse) shared by list header, `KanbanBoardContainer`, and `SessionTableHost`. Move sidebar filters into a dropdown; leave chips on wide board/table if desired.

**Tech Stack:** Electron renderer, React, jotai, existing collection display/filter atoms, bun tests.

## Global Constraints

- Do not change `CollectionViewMode` union (`'list' | 'board' | 'table'`).
- Do not vendor new view types; EntityViewTabs stay out of scope.
- i18n keys in all locale files, alphabetically sorted.
- Board still collapses navigator (`isBoardView`); cycle control must exist on board/table hosts.
- Skip formatters/project-wide test suites until the end of a slice; unit-test new cycle helper first.

---

### Task 1: Pure cycle helper + tests

**Files:**

- Create: `apps/electron/src/renderer/components/app-shell/collection/collection-view-cycle.ts`
- Create: `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-view-cycle.test.ts`

**Step 1:** Write failing tests for:

- `COLLECTION_VIEW_ORDER = ['list','board','table']`
- `nextCollectionView(mode)` / `prevCollectionView(mode)` wrap-around
- `collectionViewRoute(mode)` mapping: list → `routes.view.allSessions()`, board → `board()`, table → `table()` (mock or import real routes)

**Step 2:** Implement the helper.

**Step 3:** Run the new test file only; confirm pass.

**Step 4:** Commit.

---

### Task 2: Cycle button UI

**Files:**

- Create: `apps/electron/src/renderer/components/app-shell/collection/CollectionViewCycleButton.tsx`
- Modify: `packages/shared/src/i18n/locales/*.json` (`collection.view.cycleNext`, `collection.view.cyclePrev`, keep existing list/board/table labels)

**Step 1:** Button shows icon of **current** mode (List / LayoutGrid / Table2). `aria-label` includes next mode. `title` mentions Shift for previous.

**Step 2:** `onClick`: if `event.shiftKey` then prev else next; call `onChange(nextMode)`.

**Step 3:** Optional: `onContextMenu` preventDefault + tiny menu of three modes (nice-to-have; skip if timeboxed).

**Step 4:** Commit.

---

### Task 3: Filter dropdown for narrow chrome

**Files:**

- Create: `apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx`
- Reuse: `CollectionFilterChips` inside popover content (do not duplicate toggle logic)

**Step 1:** Trigger = funnel icon + badge count of active filter dimensions.

**Step 2:** Popover content = existing chips (width ~16rem, wrap **inside** popover only).

**Step 3:** Commit.

---

### Task 4: CollectionViewChrome compact vs wide

**Files:**

- Modify: `collection/CollectionViewChrome.tsx`
- Modify: `AppShell.tsx` list header (~2490)

**Step 1:** Default `compact={true}`: `CollectionViewCycleButton` + `CollectionDisplayPopover` + `CollectionFilterMenu`. **Never** `CollectionOpsBar` in compact.

**Step 2:** `AppShell` list header: `compact` (true). `onViewModeChange` navigates via `collectionViewRoute` for all three modes.

**Step 3:** Wide `compact={false}` only if still needed on table; prefer cycle + existing table header. Do not put OpsBar in `PanelHeader`.

**Step 4:** Commit.

---

### Task 5: Board and table hosts

**Files:**

- Modify: `kanban/KanbanBoardContainer.tsx` (CollectionViewChrome ~946)
- Modify: `session-table/SessionTableHost.tsx` (`CollectionViewToggle` ~585)

**Step 1:** Replace three-label `CollectionViewToggle` with `CollectionViewCycleButton` (or compact chrome).

**Step 2:** `onChange` navigates with the same helper. From board, next is table; prev is list. From table, next is list; prev is board.

**Step 3:** Smoke: list → click → board visible; Shift+click → list; navigator width restored.

**Step 4:** Commit.

---

### Task 6: Display popover already has group-by status

**Files:** none unless copy is wrong.

**Step 1:** Confirm `CollectionDisplayPopover` `groupBy: status` remains the sidebar “sort by status”. No extra status-sort chips in the header.

**Step 2:** If i18n for display trigger is long, icon-only Display in compact chrome.

---

### Task 7: Verify

**Step 1:** Targeted tests: cycle helper + any chrome unit tests.

**Step 2:** Manual: narrow navigator (~260px) — no overflow; cycle list/board/table/list; Shift reverse; filters in dropdown still AND with smart views.
