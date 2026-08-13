# ADR-0001: Rox Workbench Architecture Convergence

Status: Accepted
Date: 2026-08-13

## Context

The application currently contains overlapping concepts for navigation,
tabs, panels, sessions, tasks, browser windows and execution runs.
Adding more modules without stabilizing these concepts would produce
duplicate state, competing navigation systems and migration debt.

Unified Shell suite S (`docs/specs/2026-08-07-unified-shell/`) already
introduced `SurfaceRegistry`, `PanelRegistry`, `LayoutProfile`,
`SurfaceLayoutSnapshot` v1 and `PanelSlot` including `status`. W1 chrome
is gated by a single `featureUnifiedShellAtom`. This ADR does not replace
suite S; it names the invariants that the next shell increment must keep
while splitting that one flag and introducing Mode / TabGroup primitives.

## Decisions

1. Mode, Surface, Tab and Panel are separate concepts.
2. Browser windows are represented as normal Surfaces (`kind: 'browser'`).
   `BrowserTabStrip` is not a second tab system; OS-window browsers join
   the surface tab strip when `workbench.browser-surface.v2` is on.
3. WorkItem and Run are separate aggregates. User tasks must not extend
   `Session`. Conductor DAGs are `WorkflowSpec` / `WorkflowRun`.
4. Session is a conversation aggregate, not a task aggregate.
5. CalendarEvent and Meeting are separate aggregates (future domain PRs).
6. WorkflowDefinition and AutomationDefinition are separate aggregates.
7. ActivityEvent and Notification are separate aggregates.
8. Knowledge content and WorkGraph domain state use separate providers.
   This increment does **not** start the WorkGraph kernel.
9. All domain mutations are versioned, attributable and command-driven
   (future WorkGraph PRs). UI must not store domain state in Jotai.
10. AI-generated mutations use ChangeProposal unless policy explicitly
    permits automatic application (future).
11. Views are stored query/projection definitions, not independent data
    copies (future `ViewConfig` v2).
12. Presence is ephemeral and server-authoritative for shared workspaces.
    Do not persist presence in localStorage as source of truth.
13. Workbench layout is persisted per user. URL / `NavigationContext`
    remains the source of truth for the focused surface.
14. Status Bar occupies the existing platform slot `status`. Transport and
    toolchain **banners** stay only for states that need intervention.
15. `featureUnifiedShellAtom` remains the W1 chrome master. New chrome
    ships behind granular `workbench.*` flags so pieces can roll out
    independently.

## Naming

| Legacy | Canonical |
| --- | --- |
| `TaskSpec` | `WorkflowSpec` (alias in this PR; on-disk `task.yaml` unchanged) |
| `TaskRun` / `RunSnapshot` / `TaskRunSnapshotDto` | `WorkflowRun` / `WorkflowRunSnapshot` |
| User task | `WorkItem` (not implemented here) |
| Browser tab strip | Browser Surface |
| Panel stack | `LegacyPanelStack` as input to `WorkbenchLayout` v2 |
| New layout | `WorkbenchLayout` version 2 (`TabGroup` + `SurfaceInstance`) |

RPC channels `tasks:*`, session keys `taskSlug` / `taskRunId` / `taskNodeId`,
and the `tasks/<slug>/` directory stay until a later migration PR.

## Consequences

- Existing surfaces migrate incrementally; W1 rail/tabs/inspector keep working.
- New Tasks functionality will not extend `Session`.
- BrowserTabStrip is hidden when browser-surface v2 is on; actions move to
  the surface tab context menu.
- New modules must register commands, modes, surfaces and panels through
  platform registries.
- Domain state must not be stored directly in renderer atoms.

## Rollout

Protected by granular feature flags. Legacy `SurfaceLayoutSnapshot` v1 and
URL `?panels=` remain readable. New writes of `WorkbenchLayout` v2 happen
only when `workbench.tab-groups.v2` is on; v1 snapshots stay readable for
at least two releases.

## Addendum (2026-08-13) — layout seam

Hardens the WorkbenchLayout contract without replacing suite S hosts or
the Appearance `workbench.*` toggles.

### Geometry is 1D

`OpenSurfaceOptions.target` is `'active-group' | 'new-group-right' | 'new-window'`.
`'new-group-bottom'` is not part of the model. `new-group-right` inserts after
the active group (not appended at the end). `splitGroup` still clones the
active tab into a new group to the right (`down` is accepted on the parallel
host and inserts right until a split-tree increment).

### Preview is a single bit

`SurfaceInstance` has `preview: boolean` (`false` ⇒ pinned via
`isPinnedSurface`). There is no `pinned` field, so a tab cannot be both.
This increment **keeps** `SurfaceInstance.route` because the live renderer
write path is still panel-stack / URL.

### Dirty close is a Result

`closeSurface` returns `LayoutMutation`. Closing a dirty tab without
`force: true` is `{ ok: false, code: 'DIRTY_SURFACE' }` and the same layout
object. Opening a new preview over a dirty preview pins the dirty tab and
appends the new one.

### Parse and persist

`parseWorkbenchLayout` never throws. v1 snapshots are rejected (callers
use `migrateLegacyLayout`). Legacy JSON that still has `pinned` is
accepted; `preview` wins when both are present. Renderer writes to
`KEYS.workbenchLayout` only after a successful parse.

### Two hosts, two snapshots

S-02 `WorkspaceSurfaceHost` still speaks `SurfaceLayoutSnapshot` (panel
stack). `WorkbenchLayoutHost` is a **parallel** layout seam with an
in-memory adapter. The renderer does not yet own TabGroups as write-path
state.

### Rollback

`flattenWorkbenchLayoutToLegacyEntries` maps every v2 tab to its own
legacy panel so no surface is lost. Grouping is not preserved. Live
`workbenchLayoutToPanelEntries` stays one panel per **group**.

## Out of scope

WorkGraph kernel, WorkItems UI, Meetings, Feed, Mail, CRDT, hosted email,
Home Front Page content, Agent Pulse, and renaming `tasks:*` RPC.
