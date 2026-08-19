# Session list sidebar: compact sort + cyclic views

**Date:** 2026-08-20  
**Status:** Draft (diagnosis-backed; implement after user OK)  
**Repo:** `rox-one/rox-one` (local `Git/rox-one`)

## 1. Diagnosis (current code)

The sessions **second sidebar** (navigator `PanelHeader`) is not a dedicated “status sort” widget. It mounts the **full collection ops strip** meant for a wide main canvas.

### 1.1 What is in the narrow header today

In `AppShell.tsx`, list mode (`viewMode` not `board`/`table`) renders:

```
CollectionViewChrome compact={false}
  → CollectionOpsBar
      → CollectionFilterChips   // ALL status + priority + project + label + due chips
      → CollectionDisplayPopover
      → CollectionViewToggle    // three labeled buttons: List | Board | Table
```

`CollectionFilterChips` lays every workspace status as a row of chips (`flex-wrap`). Combined with the 3-way labeled toggle (`gap-1.5`, icon **and** i18n label per mode), the header **overflows horizontally** in a typical navigator width. That is the “сортировка разъезжается вправо”.

Grouping/sorting itself is already in **Display** (`CollectionDisplayPopover`: `groupBy` includes `status`, `orderBy` is rank/priority/due/lastMessage/created/name). Chips are **filters**, not sort — but they occupy the same strip, so they read as “status sort”.

### 1.2 Views that exist (not lost in data model)

Approved PRD `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md`:

| Mode | Route / nav | Host |
|------|-------------|------|
| `list` | default sessions navigator | `SessionList` in sidebar; chat in main |
| `board` | `routes.view.board()` | `KanbanBoardContainer` full-width main |
| `table` | `routes.view.table()` | `SessionTableHost` full-width main |

`CollectionViewMode = 'list' | 'board' | 'table'` (`BoardListToggle.tsx`). Kanban package still lives (`packages/shared/src/kanban/*`, `KanbanBoardContainer.tsx`).

### 1.3 Why Kanban “disappeared”

`AppShell` **collapses the navigator to zero width** when `viewMode === 'board' || 'table'` (`isBoardView`). List-header chrome unmounts. Board/table are supposed to show their **own** `CollectionViewToggle`.

If the list-header strip is clipped/unusable, the user never reaches board. If they do reach board and the board header toggle is easy to miss (or they expect the sidebar control), there is no obvious way **back** to list — “kanban пропал / назад не работает”.

Cycle is **not** implemented: three independent buttons, no previous-mode stack. `onViewModeChange` in list chrome only handles `board` and `table`; it does **not** no-op `list` (already list). Board chrome maps `list` → `allSessions()`, `table` → table.

### 1.4 Other “views”

Orthogonal, **out of scope** (same as 2026-08-08 PRD): `EntityViewTabs` / `SessionViewTabs` (standard/map/outline/graph on an **open session**). Sidebar **smart views** (`ViewConfig` / filtrex: New, Plan, Explore, Processing) are **filters**, not layout modes.

---

## 2. Goals

1. Navigator header fits the second sidebar: no horizontal overflow from status chips or a 3-label toggle.
2. Keep **list / board (kanban) / table**; board remains a first-class layout for all sessions.
3. **One primary control** cycles layout; **explicit previous** restores the last mode (so list → board → back is list, not table).
4. Status filtering stays available without a chip runway in the sidebar.
5. Board and table always expose the same cycle control so the user can leave those full-width hosts.

## 3. Non-goals

- Redesign kanban columns or CollectionDisplay persistence RPC.
- Entity (per-session) tabs.
- New fourth collection layout.

## 4. UX

### 4.1 Sidebar (list) header

Replace full `CollectionOpsBar` with a **compact** row:

- Search remains as today (`SessionSearchHeader` / existing list search).
- **View cycle button** (one control, icon of *current* mode).
- **Display** popover (existing sliders) for groupBy / orderBy / properties — this is where “sort by status” lives (`groupBy: status`).
- **Filter** popover (new, or chips moved into a dropdown): status, priority, project, labels, due. Selected filters show as a **count badge** on the trigger, not as a chip row.

No `flex-wrap` chip groups in `PanelHeader`.

### 4.2 Cycle control (forward + previous)

Order: `list → board → table → list`.

| Input | Behavior |
|-------|----------|
| Click | Next mode in that order |
| Shift+click (and optional Alt+click) | Previous mode in that order |
| Context: after `list → board`, Shift+click | `list` (previous in cycle **and** last-used) |

Additionally persist `lastCollectionViewMode` in memory for the workspace window so:

- Click from list always goes to **board** first (kanban is the sibling of list, table is third).
- From board, click goes to table, then back to list.
- Shift+click always walks the ring backward.

Routes stay: `allSessions()` / `board()` / `table()`. Navigator still collapses on board/table; **the same cycle button is required** in `KanbanBoardContainer` and `SessionTableHost` headers (replace the 3-labeled `CollectionViewToggle` there too, or keep icon-only segmented as secondary — primary is the cycle button).

Recommended primary: **one cycle button everywhere** (sidebar + board + table). Optional: long-press menu listing List / Board / Table for discoverability.

### 4.3 Board / table

Keep full-width hosts. Ops chips **may** remain on the wide board/table canvas (`CollectionOpsBar`) because width exists. Sidebar must not show that strip.

## 5. Implementation sketch

| File | Change |
|------|--------|
| `collection/CollectionViewCycleButton.tsx` (new) | Current-mode icon; click next; shift-click prev; `aria-label` with next mode |
| `kanban/BoardListToggle.tsx` | Keep `CollectionViewMode` type; toggle becomes optional/icon-only or unused by chrome |
| `collection/CollectionViewChrome.tsx` | Sidebar: compact = cycle + Display + Filter popover. Never mount `CollectionOpsBar` in navigator |
| `AppShell.tsx` | List header: `compact` chrome (true). `onViewModeChange` handles all three modes via `nextCollectionViewRoute` |
| `KanbanBoardContainer.tsx` / `SessionTableHost.tsx` | Swap 3-button toggle for cycle button; keep navigate mapping |
| `collection/CollectionFilterMenu.tsx` (new) | Dropdown wrapping existing chip logic from `CollectionFilterChips` |
| `lib/navigate.ts` / routes | Unchanged paths |

## 6. Acceptance

- Second sidebar header does not overflow at ~240–280px width with many statuses.
- User can open kanban with one click from list; Shift+click (or cycle back) returns to list.
- From board, one click reaches table; another click returns to list.
- Display `groupBy: status` still groups the list.
- Filters still AND with smart views (`ViewConfig`).
- Board columns still from kanban config, independent of `sessionStatus`.
