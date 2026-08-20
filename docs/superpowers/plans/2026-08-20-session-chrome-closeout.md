# Session Chrome Close-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish session-list chrome: workspace-scoped slices with rename, rail/chip sync, always-on group counts with sticky headers and select-group, hover archive.

**Architecture:** Keep three stores (filters.json chips, display.json, localStorage slices with workspace suffix). Compact Filter menu owns slices. EntityList always shows counts; SessionList wires select-group into existing multi-select. SessionItem hoverActions add archive. No density, no ViewConfig unification, no click-split.

**Tech Stack:** Electron renderer React, Jotai, i18n 10 locales, bun test.

**Spec:** `docs/superpowers/specs/2026-08-20-session-chrome-closeout-design.md`

## Global Constraints

Locked decisions 1–15 from the spec (do not reopen):

1. Three layouts only: `CollectionViewMode` stays `'list' | 'board' | 'table'`. Entity tabs stay orthogonal.
2. One cycle control in the navigator `PanelHeader`; no List | Board | Table strip.
3. No chip runway in the navigator header; chips live in Filter (or wide board/table).
4. Layers owns group-by; no inline Status | Project | Due tabs under the header.
5. Filters AND smart views; changing Sessions rail item clears **active** chips; per-key `filters.json` map remains.
6. Slices are named filter snapshots in the Filter menu, not ViewConfig and not Display presets.
7. Three stores, never four: chips → `{workspace}/collection/filters.json`; Display → `display.json`; saved slices → renderer localStorage with workspace suffix. No `collection-slices.json`, no new RPC.
8. Native glass menus; check/dot selected state; never boxed `<input type="checkbox">` in these menus. Filter/Display = dialog + buttons; Layers = menu + menuitem.
9. Empty Clear stays `setCollectionFilters({})` + `navigate(allSessions())`.
10. Hover actions stay hover/focus only; archive joins unread + flag; pin/more stay in SessionMenu.
11. Board columns stay `KanbanBoardConfig`; Display `groupBy` does not replace kanban.
12. New copy in every locale JSON, keys sorted alphabetically, RU + EN at minimum; no hardcoded English in chrome we touch.
13. Forks stay deferred: density, unify slices with smart views, click-target split.
14. Tests stay scoped: slice workspace keying, group select helper, filter-clear-on-rail. Skip formatters and project-wide suites mid-flight.
15. This plan ships app code; the spec file is the contract and is not edited here.

Additional execution rules:

- Repo: `/Users/marklindgreen/Git/rox-one` only.
- Run `bun test` **only** on files listed in each task. Do not run eslint, prettier, or monorepo-wide suites.
- Do not touch Map, Outline, workbench rails, or kanban column config.
- Do not add `density`, `rowMeta`, or `hoverActions` fields to `CollectionDisplay`.
- Jump-to-project / jump-to-task must still write chips **after** navigation (exception to rail-clear).
- Overwriting a rail key’s `filters.json` entry with `{}` is intentional (rail = clean).

---

## File map

| Area | Path | Responsibility |
|------|------|----------------|
| Slice helpers | `apps/electron/src/renderer/components/app-shell/collection/collection-slices.ts` | Signature, apply toggle, load/persist with workspace suffix, copy-on-read legacy, rename, unique-name guard |
| Slice tests | `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-slices.test.ts` | TDD for suffix, migration, rename, uniqueness, apply toggle |
| Filter menu | `apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx` | Pass workspace id into load/persist; rename UI; delete stays |
| localStorage | `apps/electron/src/renderer/lib/local-storage.ts` | **Already** `get/set(key, value, suffix?)` via `buildKey` → `craft-collection-slices:{workspaceId}`. Do not invent a fourth store. |
| Rail helper | `apps/electron/src/renderer/components/app-shell/collection/collection-rail-filters.ts` (create) | Pure: when filter **key** changes, next chips = `DEFAULT_COLLECTION_FILTERS` |
| Rail tests | `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-rail-filters.test.ts` (create) | Key-change vs same-key vs jump exceptions |
| App shell | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | Sessions rail clicks (All Sessions required; other Sessions destinations same helper). Jump handlers stay chip-writing. |
| Group list | `apps/electron/src/renderer/components/ui/entity-list.tsx` (`EntityList`) | Count on `SectionHeader` **and** collapsible headers; sticky; Select group callback |
| Group tests | `apps/electron/src/renderer/components/ui/__tests__/entity-list-group.test.ts` (create) | Count helper + select-group payload |
| Session list | `apps/electron/src/renderer/components/app-shell/SessionList.tsx` | `onSelectGroup` → additive multi-select of loaded `group.items` ids |
| Selection | `apps/electron/src/renderer/hooks/useMultiSelect.ts` + `useEntitySelection.ts` | Additive `addToSelection(ids)` (do **not** use replacing `selectAll`) |
| Hover | `apps/electron/src/renderer/components/app-shell/SessionItem.tsx` | Archive / Unarchive in `hoverActions` after flag |
| i18n | `packages/shared/src/i18n/locales/{de,en,es,fr,hu,ja,pl,ru,zh-Hans,zh-Hant}.json` | 10 locales, alphabetical keys |
| Menu a11y | `collection-menu-row.tsx`, Filter/Display/Layers | Task 5 notes + only fix nested `menuitem*` inside Filter `dialog` if still present |

**Do not create:** `collection-slices.json`, IndexedDB, `activeSliceId` on Display.

---

### Task 1: Workspace-suffixed slices + rename + unique names

**Files:**

- Modify: `apps/electron/src/renderer/components/app-shell/collection/collection-slices.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-slices.test.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx`
- Read-only: `apps/electron/src/renderer/lib/local-storage.ts` (suffix already exists)
- Modify: `packages/shared/src/i18n/locales/*.json` (10 files)

Current facts: `loadSavedSlices()` / `persistSavedSlices()` call `storage.get/set(KEYS.collectionSlices)` **without** suffix. Test file imports are already out of date vs source (`applySlice`, `BUILTIN_SLICES`, `filtersSignature`) — rewrite tests to the **real** exports: `applySlice`, `BUILTIN_SLICES`, `filtersSignature`, `matchingSlice`, `matchingSliceId`, `sliceMatches`.

**Step 1: Write failing tests** (`collection-slices.test.ts`)

- [ ] Keep existing apply/toggle/signature tests, fixed to real names.
- [ ] `persistSavedSlices(slices, workspaceId)` uses suffixed storage; `loadSavedSlices(workspaceId)` reads that suffix. Different workspace ids do not see each other’s names.
- [ ] Empty workspace id: persist is a no-op; load returns `[]`.
- [ ] Copy-on-read: if suffixed key is empty and unsuffixed `KEYS.collectionSlices` has an array, copy into the suffixed key and return it. Do **not** delete the legacy key.
- [ ] `renameSavedSlice(slices, id, name)` updates `name` on a non-builtin row; returns same array reference policy (new array). Built-in ids are not in saved storage; calling rename on missing id is a no-op.
- [ ] Unique names: `assertUniqueSliceName(name, slices, excludeId?)` — trim; case-insensitive; empty name invalid; duplicate vs another saved slice fails. Duplicate names are **not** allowed (this plan; ids stay unique via `saved-${Date.now().toString(36)}`).
- [ ] `createSavedSlice` still unique ids; save path must reject duplicate names before persist.

Mock `localStorage` in the test file (or mock `@/lib/local-storage`) so tests do not depend on a browser.

**Step 2: Implement helpers in `collection-slices.ts`**

- [ ] `loadSavedSlices(workspaceId?: string)` → `storage.get(KEYS.collectionSlices, [], workspaceId)` when `workspaceId` is non-empty.
- [ ] Migration as specified. Persist the copy with suffix.
- [ ] `persistSavedSlices(slices, workspaceId?: string)` → `storage.set(..., workspaceId)`.
- [ ] `renameSavedSlice`, `assertUniqueSliceName` (export both).
- [ ] Do not persist builtins. Do not add a fourth atom family.

**Step 3: Wire Filter menu**

- [ ] Read active workspace id the same way other renderer chrome does (`windowWorkspaceIdAtom` from session atoms, or AppShell context). Pass it into load/persist.
- [ ] Reload saved slices when workspace id changes (effect).
- [ ] Saved row: keep delete trailing (`collection.filter.clear`). Add Rename trailing **or** double-click name → inline input (same field as save). Enter commits; Escape cancels.
- [ ] On commit: unique-name check; then `renameSavedSlice` + persist.
- [ ] Built-in rows: no rename, no delete.
- [ ] `applySlice` toggle unchanged. Filter trigger tooltip still `Filter · {slice name}` when matched.

**Step 4: i18n (all 10 locale files, keys alphabetical)**

- [ ] `collection.slice.rename` — EN: `Rename`, RU: `Переименовать`
- [ ] `collection.slice.nameTaken` — EN: `That name is already used`, RU: `Это имя уже занято`
- [ ] Do not hardcode English in the menu.

**Step 5: Run tests (this file only)**

```bash
bun test apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-slices.test.ts
```

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/collection/collection-slices.ts \
  apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-slices.test.ts \
  apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx \
  packages/shared/src/i18n/locales/*.json
git commit -m "feat(sessions): workspace-scoped slices with rename and unique names"
```

---

### Task 2: Sessions rail click clears chips

**Files:**

- Create: `apps/electron/src/renderer/components/app-shell/collection/collection-rail-filters.ts`
- Create: `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-rail-filters.test.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

**Product rule:** When the user clicks a Sessions rail destination whose `collectionFilterKey` **differs** from the previous key, write `DEFAULT_COLLECTION_FILTERS` into the **new** key’s active atom. Do not delete other keys in the JSON map. Badge count becomes 0. Saved slices remain available to re-apply.

**Do not clear when:** same key (including All Sessions clicked while already on All Sessions); list/board/table cycle; Display/Layers; applying a slice; jump-to-project / jump-to-task (they set chips then `navigate(allSessions())`); empty-state Clear (already correct).

**Step 1: Failing tests**

- [ ] `shouldClearChipsOnFilterKeyChange(prev, next)` is true iff both keys are non-empty and `prev !== next`.
- [ ] `chipsAfterRailChange()` returns a clone of `DEFAULT_COLLECTION_FILTERS` (empty object / default export from `@craft-agent/shared/sessions/collection`).
- [ ] Document in comments: overwriting that key in `filters.json` is intentional.

**Step 2: Implement helper**

- [ ] Keep it pure — no Jotai, no React.

**Step 3: AppShell**

- [ ] `handleAllSessionsClick` (Sessions / All Sessions `onClick` ~1572 and LeftSidebar `nav:allSessions` ~2314): if the new key differs, `setCollectionFilters({ ...DEFAULT_COLLECTION_FILTERS })` **after** `collectionFilterKeyAtom` matches the destination (set key first, then empty chips, then `navigate(routes.view.allSessions())` **or** navigate then clear in the existing key-sync effect).
- [ ] Preferred: in the effect that already does `setCollectionFilterKey(sessionFilterKey ?? 'allSessions')`, if previous key !== next key **and** the change was not a jump helper, write empty chips to the active atom.
- [ ] Guard jumps: `handleJumpToProjectSessions` / `handleJumpToTaskSessions` must still write project/label chips after navigation. Use a ref (`skipRailChipClearRef`) set true around those two helpers only.
- [ ] Apply the same clear to Flagged, Archived, status, label, smart-view rail clicks (they all change `collectionFilterKey`). Task title calls out All Sessions; behavior is all Sessions rail destinations per spec §6.6.
- [ ] Do **not** clear on workspace switch beyond existing workspace-switch reset (~840).

**Step 4: Tests**

```bash
bun test apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-rail-filters.test.ts
```

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/collection/collection-rail-filters.ts \
  apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-rail-filters.test.ts \
  apps/electron/src/renderer/components/app-shell/AppShell.tsx
git commit -m "fix(sessions): clear collection chips when Sessions rail key changes"
```

---

### Task 3: Group counts always on, sticky headers, Select group

**Files:**

- Modify: `apps/electron/src/renderer/components/ui/entity-list.tsx`
- Create: `apps/electron/src/renderer/components/ui/__tests__/entity-list-group.test.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/SessionList.tsx`
- Modify: `apps/electron/src/renderer/hooks/useMultiSelect.ts`
- Modify: `apps/electron/src/renderer/hooks/useEntitySelection.ts`
- Modify: locale JSONs
- Optional one-line: `SessionTableGroupHeader` only if count would **regress**; table select-group is out of scope.

**Count rules (spec §6.1):** Display `LABEL · N` with tabular nums. N = sessions in the group after collection filters AND smart view, **before** virtualization. Collapsed uses the same N (`collapsedCount` must stay in sync). Empty status/priority/project groups stay omitted. Unread buckets still always show, including `(0)`. `aria-label`: `{label}, {n} sessions`. Do not say “items”.

**Sticky (spec §6.2):** Header sticks to the **session list scrollport** below `SessionSearchHeader`. Opaque list background (not blur) so rows do not bleed. One sticky header at a time. Collapse must not jump viewport to y = 0. Do not stick search twice; do not stick board columns.

**Select group (spec §6.3):** Context menu after expand/collapse, before collapse-all. Additive: enable multi-select; union currently loaded `group.items` ids; do not clear other groups. Disabled when `group.items.length === 0`. No new global hotkey. No silent fetch of the whole workspace.

**Step 1: Failing tests**

- [ ] `groupItemCount(group)` returns `collapsedCount` when collapsed placeholder, else `group.items.length`.
- [ ] `selectGroupIds(existingIds, groupItemIds)` unions ids (additive). Empty group ids → unchanged.
- [ ] `addToSelection` (or equivalent) does **not** replace the existing set the way `selectAll` does.

**Step 2: EntityList**

- [ ] `SectionHeader` takes `itemCount` and renders `label · count` like `CollapsibleGroupHeader`.
- [ ] Both headers: `tabular-nums`; `aria-label` via i18n `entityList.groupAria` / `collection.group.sessionCount`.
- [ ] Sticky: `sticky top-0 z-10 bg-background` (opaque) on the header row inside the ScrollArea viewport. Search stays outside ScrollArea (already).
- [ ] Props: `onSelectGroup?: (groupKey: string) => void`. Context menu item `collection.group.select` / “Select group”, disabled if count 0 / items empty.
- [ ] Pass `itemCount={isCollapsed ? (group.collapsedCount ?? 0) : group.items.length}` into **both** header variants.

**Step 3: Selection store**

- [ ] Add `addToSelection(ids: string[])` that unions into `selectedIds`, sets multi-select active, does not drop ids from other groups.
- [ ] Expose on `useEntitySelection` / `useSessionSelection`.

**Step 4: SessionList**

- [ ] `onSelectGroup={(key) => { const g = groups.find(...); selection.addToSelection(g.items.map(sessionId)) }}` using currently loaded family heads + expanded branches already in `group.items`.
- [ ] Do not fetch more pages.

**Step 5: i18n**

- [ ] `collection.group.select` — EN: `Select group`, RU: `Выбрать группу`
- [ ] `collection.group.sessionCount` — EN: `{label}, {count} sessions`, RU: `{label}, сессий: {count}`
- [ ] All 10 locales, alphabetical keys.

**Step 6: Tests**

```bash
bun test apps/electron/src/renderer/components/ui/__tests__/entity-list-group.test.ts
```

If you added tests next to `useMultiSelect`, list that file too in the same `bun test` invocation only.

**Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/ui/entity-list.tsx \
  apps/electron/src/renderer/components/ui/__tests__/entity-list-group.test.ts \
  apps/electron/src/renderer/components/app-shell/SessionList.tsx \
  apps/electron/src/renderer/hooks/useMultiSelect.ts \
  apps/electron/src/renderer/hooks/useEntitySelection.ts \
  packages/shared/src/i18n/locales/*.json
git commit -m "feat(sessions): group counts, sticky headers, and select-group"
```

---

### Task 4: SessionItem hover archive

**Files:**

- Modify: `apps/electron/src/renderer/components/app-shell/SessionItem.tsx`
- Optional test: `apps/electron/src/renderer/components/app-shell/__tests__/session-item-hover-archive.test.ts` only if a lightweight helper is extracted; otherwise a focused comment + existing toast path. Prefer extracting `archiveHoverKind(item): 'archive' | 'unarchive'` for TDD.

**Step 1: Failing test (helper)**

- [ ] Non-archived → `'archive'`; archived (`item.archived` / existing SessionItem archived flag) → `'unarchive'`.

**Step 2: Implement hover cluster**

- [ ] Trailing hover: Unread (if read) · Flag · **Archive**. Same `h-3.5 w-3.5` density as flag.
- [ ] Archived view: Unarchive in the same slot.
- [ ] `aria-label` from existing `sessionMenu.archive` / unarchive strings (do not invent new English).
- [ ] `opacity-0` until `group-hover` or `:focus-within` / `data-focus-visible` — match flag/unread, including keyboard focus-visible.
- [ ] `onClick` / `onMouseDown` `stopPropagation`. Call `ctx.onArchive?.(item.id)` / `ctx.onUnarchive?.(item.id)` so `SessionList` `handleArchiveWithToast` still toasts + undo.
- [ ] Do not archive on row click. Do not add Delete to hover. Leading check stays.

**Step 3: Tests**

```bash
bun test apps/electron/src/renderer/components/app-shell/__tests__/session-item-hover-archive.test.ts
```

If no test file was added (helper lived in SessionItem only), skip this command and rely on typecheck-free visual verification in Task 5 — **prefer adding the helper test**.

**Step 4: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/SessionItem.tsx \
  apps/electron/src/renderer/components/app-shell/__tests__/session-item-hover-archive.test.ts
git commit -m "feat(sessions): archive and unarchive on session row hover"
```

---

### Task 5: Visual / a11y notes (no density, no ViewConfig, no click-split)

**Files (touch only if roles are still illegal):**

- `apps/electron/src/renderer/components/app-shell/collection/collection-menu-row.tsx`
- `CollectionFilterMenu.tsx`, `CollectionDisplayPopover.tsx`, `CollectionGroupByMenu.tsx`

This task is **notes + the smallest role fix**. Do not redesign rows. Do not add density. Do not unify slices with smart views. Do not split click targets.

**Step 1: Checklist (verify, then fix only Filter row roles if still `menuitemcheckbox` inside `role="dialog"`)**

- [ ] Filter: `Popover` root `role="dialog"` + `aria-label`; trigger `aria-haspopup="dialog"`. Rows are `button` **without** `menuitemcheckbox`. Save field stays a text input inside the dialog.
- [ ] Display: dialog; rows `button`; native `Switch` only for boolean display flags.
- [ ] Layers: `DropdownMenu` `menu` + `menuitem`; `aria-haspopup="menu"`; radio dot / `aria-current` on active `groupBy`.
- [ ] Surface: `COLLECTION_POPOVER_SURFACE` — `bg-background/90`, `backdrop-blur-xl`, `border-border/40`, soft shadow, `p-1`, rows `rounded-[5px]`, hover `bg-foreground/[0.055]`. No solid elevated card. No boxed `Checkbox`.
- [ ] Icon buttons stay `h-7 w-7` `header-icon-btn`. Filter badge stays 9px pill. No labels next to compact icons.
- [ ] Escape closes; focus returns to trigger.
- [ ] Compact `CompactSessionListFilter` boxed checks must **not** be revived in the desktop navigator.
- [ ] Shipped paths still work: cycle, Layers, empty Clear → allSessions, builtin slice toggle, Filter badge.

**Step 2: If Filter rows still use `role="menuitemcheckbox"`**

- [ ] Change `CollectionMenuRow` used inside Filter to `role="button"` / no menu role (or a Filter-specific variant) so AT pairing is legal. Do not break Layers items that legitimately use `menuitem`.

**Step 3: Tests**

No project-wide suite. If you changed `collection-menu-row.tsx` and a unit test exists, run only that file. Otherwise no `bun test` in this task.

**Step 4: Commit** (omit if git status is clean)

```bash
git add apps/electron/src/renderer/components/app-shell/collection/collection-menu-row.tsx \
  apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx
git commit -m "fix(sessions): Filter dialog rows are buttons, not nested menu items"
```

---

## Verification (after Tasks 1–5; not a sixth product task)

Manual / agent smoke (do not start deferred forks):

- Navigator ~240–280px: cycle · Layers · Display · Filter only; no chip overflow.
- Workspace A saved slice name absent in workspace B.
- Rename user slice; builtins have no rename.
- Rail click to Flagged or All Sessions: Filter badge 0; re-apply a slice restores chips.
- Jump-to-project: All Sessions **with** project chip.
- Filtered empty Clear: empty chips + All Sessions route.
- Group headers count + stick; Select group additive; empty unread bucket select disabled.
- Hover and keyboard focus show Archive/Unarchive next to flag.
- Density / ViewConfig unification / click-split **absent**.

## Out of scope (reject if a PR starts them)

- `comfortable` / `compact` density, secondary meta line, click-split.
- Unifying slices with `ViewConfig`.
- Fourth persistence file or RPC.
- Chip runway in `PanelHeader`.
- Replacing kanban; entity tabs on an open session.
- Formatters / monorepo-wide test as a merge gate for this slice.

## Open questions (one-line picks; do not reopen §3)

1. Select group: additive (locked).
2. Sticky header: opaque list background, not blur.
3. Legacy unsuffixed slices: copy-on-read, do not delete legacy key.

## Suggested vs this plan

Spec §12 listed a11y first. This plan follows the assignment order (slices → rail → groups → hover → visual notes). If Filter `menuitemcheckbox` inside `dialog` blocks slice rename a11y, do the row-role one-liner at the start of Task 1, then continue. Timebox drop order: skip sticky before skipping workspace-suffixed slices or rail-clear. Never ship a fake Select group that only selects the first row.
