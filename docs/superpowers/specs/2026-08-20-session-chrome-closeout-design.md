# Session chrome close-out design

**Date:** 2026-08-20  
**Status:** Approved for implementation (close-out of compact chrome + native menus + slices)  
**Repo:** `rox-one/rox-one` (local `/Users/marklindgreen/Git/rox-one`)  
**Language:** English, written so a Russian-speaking teammate can follow without idiom.  
**Related:**

- Compact cycle + navigator chrome: `docs/superpowers/specs/2026-08-20-session-sidebar-views-sort-design.md`
- Collection linear views PRD: `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md`
- Deferred command-surface redesign: `docs/superpowers/specs/2026-08-20-session-command-surface-deferred.md`

This document is **design only**. It does not change application code.

---

## 1. Purpose

We already shipped the first two product points:

1. Compact cyclic list / board / table chrome in the sessions navigator.
2. Native filter and display menus, saved **slices**, and a dedicated **Layers** (group-by) control.

What remains is a **close-out**: the list must feel like a finished command strip, not a half-native inbox. Close-out is polish and a few missing group/row/slice behaviors. It is **not** the big session-row redesign (density, unify smart views, click-target split). Those forks stay in the deferred spec.

---

## 2. Status of shipped work

Commits below are **conceptual labels** for what landed on the sessions chrome track. Exact SHAs may move if history is rewritten; the **behavior** is the contract.

| Conceptual commit | What shipped | Where it lives |
|-------------------|--------------|----------------|
| **Compact cycle** | One cycle button: `list → board → table → list`. Click = next. Shift+click = previous. Last origin remembered (`craft-collection-last-view`). Global hotkeys for next/prev and each mode. Navigator stays collapsed on board/table; cycle exists on list header, `KanbanBoardContainer`, and `SessionTableHost`. | `collection-view-cycle.ts`, `CollectionViewCycleButton.tsx` / `CollectionViewChrome.tsx`, `AppShell.tsx` |
| **Native menus** | Filter and Display no longer dump a chip runway into the ~260px `PanelHeader`. Funnel + badge count. Display is icon sliders. Menu rows use check/dot glyphs, not boxed HTML checkboxes. | `CollectionFilterMenu.tsx`, `CollectionDisplayPopover.tsx`, `collection-menu-row.tsx` |
| **Slices** | Built-in slices: unread, flagged, overdue, today. Applying a matching slice again clears it (`applySlice` toggle). User can **save** the current filter set with a name. Saved slices persist in renderer `localStorage` under `KEYS.collectionSlices`. | `collection-slices.ts`, Filter menu “Saved” section |
| **Layers** | Dedicated Layers icon (`CollectionGroupByMenu`) writes `CollectionDisplay.groupBy` (`none` / `status` / `priority` / `project` / `dueDate` / `label`). Uses `DropdownMenu` + glass surface. | `CollectionGroupByMenu.tsx` |
| **Counts** | Unread grouping always renders Unread/Read buckets, including empty, with header counts. Collapsed groups surface `collapsedCount`. `CollapsibleGroupHeader` shows `label · count`. | `SessionList.tsx`, `entity-list.tsx` |
| **Hover** | Session row hover reveals a leading check (multi-select), project name, mark-unread, and flag. Archive is **not** on the hover strip; it is still in `SessionMenu`. | `SessionItem.tsx` `hoverActions` / leading check |
| **Empty** | Filtered empty list: funnel icon, “no matching sessions”, **Clear** button. Archive-only empty stays archive copy. Truly empty inbox stays “new session”. Search header stays pinned above empty UI. | `SessionList.tsx` empty branch |
| **Clear → allSessions** | Clear does two things: `setCollectionFilters({})` **and** `navigate(routes.view.allSessions())`. User is not left on a smart-view rail that still hides the sessions they expected. | `4d2ef58` behavior in empty Clear handler |

### 2.1 What this means for the user today

- The second sidebar header fits a narrow navigator: cycle · Layers · Display · Filter.
- Filters AND with sidebar smart views (`ViewConfig` / filtrex). Chips persist per navigator key in `{workspace}/collection/filters.json`.
- Display persists in `{workspace}/collection/display.json`.
- Saved slices are **global to the Electron profile**, not per workspace (gap).
- Group headers count items but are not sticky, have no “select group”, and empty groups other than unread buckets are still omitted.
- Hover is unread + flag, not archive.

---

## 3. Decisions (locked, non-negotiable)

These decisions are already taken. Close-out work must not reopen them.

1. **Three layouts only.** `CollectionViewMode` stays `'list' | 'board' | 'table'`. No fourth collection layout. Entity tabs (Standard / Map / Outline / Graph) stay orthogonal.

2. **One cycle control.** Primary view switch is the cycle button (click next, Shift+click previous, optional context list of three modes). Do not put a three-label List | Board | Table strip back in the navigator `PanelHeader`.

3. **No chip runway in the navigator header.** Status / priority / project / label / due chips may exist **inside** the Filter popover (stacked) or on a **wide** board/table canvas. They must not `flex-wrap` in `PanelHeader`.

4. **Layers owns group-by.** `groupBy` is a first-class header control (Layers), persisted on `CollectionDisplay`. Display popover may still expose group-by as a duplicate for discoverability, but Layers is the compact path. Do not add inline Status | Project | Due **tabs** under the header.

5. **Filters AND smart views.** Collection chips never replace `ViewConfig`. Clicking a sidebar Sessions rail item (All / Flagged / Archived / status / label / smart view) is a **navigator key change**. Close-out must **clear live chips** when the rail changes so the user does not inherit another view’s funnel (see §6.6). Persistence **per key** in `filters.json` remains; the **active** chips on screen reset when the rail item changes.

6. **Slices are named filter snapshots, not a third view system.** Built-ins + user-saved slices live in the Filter menu. They apply `CollectionFilters`. They are **not** `ViewConfig` and **not** Display presets.

7. **Three stores, never four.**  
   - Chips → `{workspace}/collection/filters.json` (RPC, already).  
   - Display (including `groupBy`) → `{workspace}/collection/display.json` (RPC, already).  
   - Saved slices → renderer `localStorage`, **workspace-suffixed** (`KEYS.collectionSlices` + workspace id).  
   Do **not** add `collection-slices.json`, a new RPC, or a fourth atom family.

8. **Native menu visuals.** Glass surface (`COLLECTION_POPOVER_SURFACE`: translucent background, blur, soft shadow, no heavy border). Selected rows use a **check or radio dot**, never a boxed `<input type="checkbox">`. Mixed a11y today is a bug: Filter popover is `role="dialog"` with inner `menuitemcheckbox`; Layers is a real `menu`. Close-out picks one pattern per surface (see §7) and does not invent a third.

9. **Clear empty state returns to All Sessions.** Keep `setCollectionFilters({})` + `navigate(allSessions())`. Do not only wipe chips while staying on Flagged/Archived/smart view.

10. **Hover actions stay hover/focus only.** No permanent icon dump on the row. Archive joins unread + flag on hover; pin/more stay in the existing menu unless already there.

11. **Board columns stay `KanbanBoardConfig`.** Display `groupBy` does not delete or replace kanban columns.

12. **i18n.** New copy in every locale JSON, keys sorted alphabetically, RU + EN at minimum. No hardcoded English in the chrome we touch.

13. **Forks stay deferred.** Density (`comfortable` / `compact`), unifying slices with smart views, and click-target split (title → chat, status → board card) are **out of this close-out**. See §8 and the deferred spec.

14. **Tests stay scoped.** Unit tests for slice workspace keying, group select helper, and filter-clear-on-rail. Skip formatters and project-wide suites mid-flight.

15. **This spec does not ship app code.** Implementation follows a separate plan; this file is the contract.

---

## 4. Remaining gaps (current-code facts)

Facts as of 2026-08-20 in `/Users/marklindgreen/Git/rox-one`.

### 4.1 Group counts are incomplete

- `EntityList` `CollapsibleGroupHeader` shows `label · itemCount` for **collapsible** groups only.
- Non-collapsible groups use `SectionHeader` **without** a count.
- Unread mode forces empty buckets with counts (`Unread (0)` via count + empty items). Status / priority / project / due / label grouping **drops empty groups**.
- `collapsedCount` is used when a group is collapsed; expanded count is `group.items.length` (visible page), which can **undercount** if the list paginates inside a group.

**Gap:** Every group header (all `groupBy` values) must show a stable count of sessions in that group (full group size, not only the mounted page). Empty groups stay hidden except where we already force unread lanes.

### 4.2 Group headers are not sticky

- `EntityList` renders headers as the first child inside a scrolling `ScrollArea`. There is **no** `position: sticky` on `CollapsibleGroupHeader` or `SectionHeader`.
- Collapse state persists via `KEYS.collapsedSessionGroups` with a workspace/view suffix (`buildCollapsedGroupsScopeSuffix`). That part is fine.

**Gap:** While scrolling a long status (or other) group, the current group label + count must stay pinned under the list search header.

### 4.3 No “select group”

- Group header context menu: expand / collapse / collapse all / expand all. No select.
- Multi-select lives on `SessionItem` leading check + `useSessionSelection` / `CollectionBulkBar`.
- Selecting every row in a group requires manual shift-click.

**Gap:** One action “Select group” adds all **currently loaded** session ids in that group to the selection store (and turns multi-select on). It does not silently fetch the entire workspace.

### 4.4 Archive is missing from hover

- `SessionItem` `hoverActions`: mark unread (if read) + flag/unflag.
- `onArchive` / `onUnarchive` exist on context and `SessionMenu`, not on the hover strip.
- Leading check appears on hover for multi-select; that stays.

**Gap:** Archive (or Unarchive when already archived) on hover/focus, same density as flag. Keyboard focus-visible must show the same actions.

### 4.5 Slices are not workspace-scoped and cannot be renamed

- `loadSavedSlices` / `persistSavedSlices` call `storage.get/set(KEYS.collectionSlices)` **without** a suffix. Workspace switch keeps another workspace’s named slices.
- Save UI is a one-shot name field. Trailing control on a saved row is `collection.filter.clear` and **deletes** the slice. No rename, no duplicate-name guard beyond `saved-${Date.now()}`.
- `matchingSlice` is exact `filtersSignature` equality. Editing chips after applying a slice drops the highlight (correct).
- Built-ins are not persisted; they must stay code constants.

**Gap:** Suffix slices with workspace id (same pattern as `tabs`, `workspaceUrl`). Allow rename of **user** slices. Deleting stays. Built-ins never rename.

### 4.6 Sessions rail does not clear chips

- `collectionFilterKeyAtom` tracks the navigator key (`allSessions`, `flagged`, `archived`, `state:<id>`, …).
- `collectionFiltersAtom` reads/writes **that key’s** map entry in `filters.json`.
- AppShell already syncs the key from navigation. Jump-to-project **writes chips** then navigates to allSessions (intentional).
- Clicking Flagged / a smart view / a status in the **Sessions rail** does not reset the **on-screen** chip set. User can land on Flagged with leftover `status: todo` from All Sessions if they expected a clean rail filter.

**Gap (decision 5):** On rail navigation that **changes** `collectionFilterKey`, set the **active** filters to `DEFAULT_COLLECTION_FILTERS` (empty). Do not delete other keys in the JSON map. Exception: programmatic jumps that **intend** to carry a project/label (`handleJumpToProjectSessions`, `handleJumpToTaskSessions`) keep writing chips **after** navigation.

### 4.7 Visual / a11y drift

- `COLLECTION_POPOVER_SURFACE`: glass, `w-64`, `role="dialog"` on Filter `PopoverContent`.
- Filter rows: `CollectionMenuRow` `role="menuitemcheckbox"` **inside** a dialog. Invalid pairing for some AT.
- Layers: real `DropdownMenu` + `StyledDropdownMenuItem` (menuitem) + `CollectionMenuCheck` radio. Closer to native.
- Display popover: mixed disclosure rows + switches.
- Some older compact filter UI (`CompactSessionListFilter`) still uses boxed checks in a drawer; close-out must **not** revive that in the desktop navigator.

**Gap:** One surface contract (§7). Filter popover stays dialog; interactive rows are `button` without `menuitem*` **or** Filter becomes a menu like Layers. Chosen contract: **dialog + plain buttons** for Filter/Display (complex, save field); **menu + menuitem** for Layers. Never nest `menuitemcheckbox` in `dialog`.

### 4.8 Hover unread vs empty Clear — already acceptable

Unread hover and Clear → allSessions are shipped. Close-out **verifies** them; it does not redesign copy unless i18n is missing in a locale.

---

## 5. Product picture (close-out only)

The navigator header stays a **single cluster**:

`[ search… ]`  
`[ cycle ] [ Layers ] [ Display ] [ Filter • n ]`

The list body:

- Sticky group headers with counts.
- Header context menu: collapse / expand / collapse all / expand all / **Select group**.
- Rows: title + status glyph; hover/focus reveals check, unread, flag, **archive**.
- Empty filtered list: Clear → empty chips + All Sessions route.
- Filter menu: built-in slices, workspace-local saved slices (rename/delete), then stacked dimension rows.
- Clicking **Sessions** in the left rail (a different smart view / All / Flagged / …) shows that view with **empty chips**. Saved slices remain available to re-apply.

Board and table keep the same cycle + Layers + Filter language. Group sticky/select is **list** first; table already has `SessionTableGroupHeader` — if it already counts, do not regress; select-group on table is **out of scope** unless it is a one-line reuse.

---

## 6. UX per close-out item

### 6.1 Counts

**Trigger:** Any list `groupBy` other than visual “flat date sections we already count”.

**Display:** `GROUP LABEL · N` where N is the number of sessions that belong to the group **after** collection filters AND smart view, **before** row virtualization. Use tabular nums. Do not say “items”.

**Empty groups:** Do not insert empty status/priority/project groups. Keep the unread-mode exception (both buckets always visible).

**Collapsed:** Show the same N (persisted `collapsedCount` must be updated when filters change).

**i18n:** Count is numeric; label stays translated. `aria-label` on the header button: `{label}, {n} sessions`.

### 6.2 Sticky group headers

**Behavior:** The active group header sticks to the top of the session list scrollport (below `SessionSearchHeader`). One sticky header at a time. Background = list background / glass so rows do not show through.

**Do not:** Stick the search header twice; do not stick board column titles in this slice.

**Collapse click:** Still toggles collapse. Sticky header remains the current group.

**Scroll jump:** Collapsing must not send the viewport to y = 0. Prefer keeping the sticky header in place (existing collapse persistence is enough if we do not remount the list).

### 6.3 Select group

**Where:** Group header context menu, after expand/collapse, before collapse-all.

**Label:** `collection.group.select` / “Select group”.

**Behavior:**

1. Enable multi-select if off.
2. Add all session ids currently in `group.items` (visible family heads + expanded branches that are in the group array).
3. Do not remove selections from **other** groups (additive).  
   Optional later: Alt+click replace — **not** in v1.
4. `CollectionBulkBar` appears as today.

**Keyboard:** When the header is focused, context menu key / Shift+F10. No new global hotkey.

**Disabled:** If `group.items.length === 0` (empty unread bucket), the action is disabled.

### 6.4 Archive on hover

**Placement:** Trailing hover cluster, after flag: Unread (if needed) · Flag · Archive.

**Archived view:** Button is Unarchive, same slot.

**Affordances:** `aria-label` from existing `sessionMenu` archive strings. `opacity-0` until `group-hover` or `:focus-within` / `data-focus-visible`.

**Do not:** Archive on click-row. Do not add Delete to hover.

**Toast:** Reuse existing archive toast + undo if `SessionList` already toasts (`handleArchiveWithToast`).

### 6.5 Slice rename + workspace storage

**Storage key:** `storage.get/set(KEYS.collectionSlices, data, workspaceId)` — same suffix style as other workspace keys in `local-storage.ts`. Empty workspace id → persist nothing / return `[]`.

**Migration:** On first load for a workspace, if suffixed key is empty and the **legacy unsuffixed** key has an array, **copy** (not move) into the suffixed key. Do not delete the legacy key in v1 (other windows / old builds). Do not merge slices across workspaces.

**Rename:** On a saved slice row: current delete trailing control stays. Add a second trailing “Rename” **or** double-click the name → inline input (same field as save). Enter commits; Escape cancels. Duplicate names allowed (ids stay unique). Built-in rows have no rename/delete.

**Apply:** Unchanged toggle via `applySlice`. Tooltip on Filter trigger still `Filter · {slice name}` when matched (`73557bc`).

### 6.6 Sessions rail clears chips

**When:** User clicks a Sessions rail destination whose `collectionFilterKey` **differs** from the previous key (All Sessions, Flagged, Archived, a status, a label, a smart view).

**Then:** `setCollectionFilters(DEFAULT_COLLECTION_FILTERS)` for the **new** key’s **active atom** (write empty into that key). User sees badge count 0.

**When not:**

- Cycle list/board/table (same key, layout only).
- Display / Layers changes.
- Applying a slice (that **sets** chips on purpose).
- Jump-to-project / jump-to-task helpers (they set chips then go to allSessions).
- Empty-state Clear (already sets empty + allSessions).

**Why empty the new key rather than “leave whatever was last saved for flagged”:** Saved per-key maps surprised people: Flagged + old todo chip looked like a broken smart view. Close-out prefers **rail = clean**. Users who want a combo use slices.

**Persistence implication:** We will **overwrite** that key’s `filters.json` entry with `{}`. That is intentional. Document in the plan so we do not “restore last chips for flagged” later without a product pass.

---

## 7. Visual and accessibility bar

### 7.1 Glass

All collection chrome popovers/menus use `COLLECTION_POPOVER_SURFACE` (or the same tokens):

- `bg-background/90` (or equivalent)
- `backdrop-blur-xl`
- `border-border/40` or thinner
- Large soft shadow, not a 1px prison box
- `p-1`, rows `rounded-[5px]`, hover `bg-foreground/[0.055]`

Layers already does this. Filter must match. Do not introduce a solid elevated card.

### 7.2 No boxed checkboxes

Selected state = `CollectionMenuCheck` (check or 6px radio dot). Native `<input type="checkbox">` and shadcn `Checkbox` are **banned** in these menus.

Multi-select on the **row** already uses a Check glyph in a borderless button — keep that; do not put a box around it.

### 7.3 Dialog vs menu

| Surface | Widget | Root role | Row role |
|---------|--------|-----------|----------|
| Filter (slices + dimensions + save field) | `Popover` | `dialog` + `aria-label` | `button` (no `menuitemcheckbox`) |
| Display | `Popover` | `dialog` | `button` / native `Switch` only for boolean display flags |
| Layers | `DropdownMenu` | `menu` | `menuitem` (`aria-current` on the active groupBy) |

Rationale: Filter contains a text field; menus-with-inputs fight focus. Layers is a pure radio list.

`aria-haspopup="dialog"` on Filter trigger; `aria-haspopup="menu"` on Layers.

Escape closes. Focus returns to the trigger.

### 7.4 Density of the header cluster

Icon buttons stay `h-7 w-7`, `header-icon-btn`. Badge on Filter is the existing 9px pill. Do not add labels next to icons in compact chrome.

---

## 8. Deferred forks (do not implement here)

Full write-up: `docs/superpowers/specs/2026-08-20-session-command-surface-deferred.md`.

Close-out **must not** pick or implement:

| Fork (deferred spec §3) | Topic | Why later |
|-------------------------|-------|-----------|
| 3.1 Density | `comfortable` / `compact` on Display | Needs `CollectionDisplay` field + row secondary line; mixes with hover polish |
| 3.2 already mostly A | Hover trailing + `…` | We only add archive; we do not rebuild the row |
| 3.3 Unify slices vs smart views | One `ViewConfig` model | Would be a fourth store or a migration; decision 7 forbids a new file |
| 3.4 Inline group tabs | Status \| Project \| Due under header | Decision 4: Layers only |
| 3.5 Click split | Title → chat, status → board card | Needs workbench stability |

**Configuration fields** `density`, `rowMeta`, `hoverActions` proposed in the deferred spec stay off `CollectionDisplay` until that project starts.

If a close-out PR starts unifying storage or adding density, it is **out of contract** and should be rejected.

---

## 9. Storage map (authoritative)

| Concern | Store | Key / file | Scope |
|---------|-------|------------|--------|
| Filter chips | Workspace JSON via RPC | `{workspace}/collection/filters.json` | Per navigator filter key |
| Display + groupBy + properties + order | Workspace JSON via RPC | `{workspace}/collection/display.json` | One object per workspace |
| Saved slices (user named snapshots) | Renderer localStorage | `craft-collection-slices:{workspaceId}` | Per workspace, this profile |
| Last cycle origin | Renderer localStorage | `craft-collection-last-view` | Window/profile (already) |
| Collapsed groups | Renderer localStorage | `craft-collapsed-session-groups` + suffix | Already |

**Forbidden:** `collection-slices.json`, IndexedDB, mixing slices into `filters.json`, mixing slices into `ViewConfig`.

Chips remain the source of truth for “what is filtered”. A slice is only a **recipe** that writes chips. Matching is by signature, not by storing `activeSliceId` in Display.

---

## 10. Files likely touched (implementation later)

Design hint for the plan; not a mandate to edit them in this spec:

| Area | Files |
|------|--------|
| Slices + workspace suffix | `collection-slices.ts`, tests, `CollectionFilterMenu.tsx` |
| Menu a11y | `collection-menu-row.tsx`, Filter/Display/Layers |
| Group chrome | `entity-list.tsx`, `SessionList.tsx`, `list-grouping.ts` |
| Hover archive | `SessionItem.tsx` |
| Rail clears chips | `AppShell.tsx` (rail click handlers / filter key effect) |
| i18n | `packages/shared/src/i18n/locales/*.json` |

Do not touch Map, Outline, workbench rails, or kanban column config.

---

## 11. Exit criteria checklist

Close-out is done when **all** of the following are true:

- [ ] Navigator header at ~240–280px: no horizontal chip overflow; cycle + Layers + Display + Filter only.
- [ ] Filter popover is glass; no boxed checkboxes; root `dialog`; rows are buttons.
- [ ] Layers is glass `menu` + `menuitem`; current `groupBy` shown with radio dot.
- [ ] Saved slices read/write **workspace-suffixed** localStorage; switching workspace does not show the other workspace’s names.
- [ ] User can rename a saved slice; built-ins cannot.
- [ ] No fourth persistence file or RPC for slices.
- [ ] `filters.json` still owns chips; `display.json` still owns Display.
- [ ] Changing Sessions rail item (new filter key) shows Filter badge 0; slices can re-apply.
- [ ] Jump-to-project still lands on All Sessions **with** that project chip.
- [ ] Empty filtered list Clear wipes chips **and** routes to All Sessions.
- [ ] Every collapsible/non-collapsible collection group header shows a count.
- [ ] Group headers stick while scrolling the session list.
- [ ] Header context menu includes Select group; bulk bar appears; other groups’ selection is not cleared.
- [ ] Hover **and** keyboard focus show Archive/Unarchive next to flag.
- [ ] Unread empty buckets still show count 0; other empty groups stay omitted.
- [ ] Density setting, smart-view unification, and click-split are **absent**.
- [ ] New strings exist in locale files (EN + RU), keys alphabetical.
- [ ] Targeted unit tests pass for: slice suffix + rename helper, `applySlice` toggle, rail-clear (pure helper if extracted), group count used by headers.
- [ ] Formatters / monorepo-wide test not required to merge this slice if the plan says skip.

---

## 12. Suggested sequence (matches the implementation plan)

Do the work in this order so each step is demoable without depending on a later visual rewrite.

1. **A11y + glass contract** on Filter / Display / Layers (`collection-menu-row` roles, shared surface). Unblocks every menu change.

2. **Slice workspace suffix + rename** (`collection-slices.ts` + Filter menu). Isolated persistence; tests first.

3. **Sessions rail clears chips** (AppShell key-change → `DEFAULT_COLLECTION_FILTERS`). Depends on understanding filter keys; does not need group UI.

4. **Group counts** (pass full-group N into `EntityList`, show on `SectionHeader` too).

5. **Sticky headers** (CSS + scrollport). After counts so the stuck bar is not a unlabeled strip.

6. **Select group** (context menu + selection store). After counts so users select a labeled, counted group.

7. **Archive hover** (`SessionItem` hover/focus cluster). Independent; last because it is row chrome and easy to conflict with select-check hover.

8. **Verify shipped paths:** cycle, Layers, empty Clear → allSessions, builtin slice toggle, Filter badge.

9. **Stop.** Do not start deferred §3 forks.

If timeboxed, **drop order** (keep contract): skip sticky first (counts still ship); never skip workspace-suffixed slices or rail-clear (they are data bugs). Select group may slip one PR if bulk-bar selection APIs fight; do not ship a fake “select group” that only selects the first row.

---

## 13. Non-goals (repeat)

- New collection layouts; replacing kanban.
- Entity tabs on an open session.
- Unifying `ViewConfig` with slices.
- Density / secondary meta line / click split.
- Fourth storage.
- Boxed checkboxes “for a11y”.
- Chip runway in `PanelHeader`.
- App code in this document.

---

## 14. Open questions (must not block close-out)

These may be answered in the plan with a one-line pick. They do **not** reopen §3.

1. Select group: additive (locked in §6.3) vs replace — already additive.
2. Sticky header blur vs opaque list background — pick opaque list bg to avoid bleed.
3. Legacy unsuffixed slices: copy-on-read (locked in §6.5) vs ignore — copy-on-read.

No other product forks.

---

## 15. Traceability

| Close-out item | Decision | Gap | UX section |
|----------------|----------|-----|------------|
| Counts | 4, 11 | 4.1 | 6.1 |
| Sticky | — | 4.2 | 6.2 |
| Select group | 10 (selection already exists) | 4.3 | 6.3 |
| Archive hover | 10 | 4.4 | 6.4 |
| Slice rename / workspace | 6, 7 | 4.5 | 6.5 |
| Rail clears chips | 5 | 4.6 | 6.6 |
| Glass / no boxes / dialog+menu | 8 | 4.7 | 7 |
| Clear → allSessions | 9 | shipped | 2, 11 |
| Deferred forks | 13 | — | 8 |

---

## 16. One-paragraph summary

Ship the rest of the compact sessions chrome: native glass menus with legal roles, workspace-local renameable slices in localStorage (chips stay `filters.json`, Display stays `display.json`), rail clicks that start from empty chips, group headers that count and stick and can select their rows, and archive on hover. Leave density, smart-view unification, and click-split to `2026-08-20-session-command-surface-deferred.md`.
