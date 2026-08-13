# ADR-0001: Rox Workbench Architecture Convergence

- **Status**: Accepted
- **Date**: 2026-08-12
- **Related**: spec suite S (`docs/specs/2026-08-07-unified-shell/`), suite K ADRs (`docs/specs/2026-08-07-siyuan-integration/01-adrs.md`)

## Context

The application currently contains overlapping concepts for navigation, tabs,
panels, sessions, tasks, browser windows and execution runs:

- `SurfaceTabs` (`apps/electron/src/renderer/platform/SurfaceTabs.tsx`) is a
  visual projection of `panelStackAtom` — every `PanelStackEntry` renders side
  by side, and the strip can only focus/close entries. It is not a real tab
  model (no tab groups, no preview/pinned semantics, no splits).
- Browser windows have a second, independent tab metaphor
  (`BrowserTabStrip` inside `TopBar.tsx`) competing with `SurfaceTabs`.
- All unified-shell chrome is gated by a single `featureUnifiedShellAtom`
  (`apps/electron/src/renderer/atoms/unified-shell.ts`), which makes staged
  rollout of individual components impossible.
- `Session` accumulates task-shaped fields (`parentSessionId`, `priority`,
  `dueDate`, `taskSlug`, `taskRunId`, `taskNodeId`), while `tasks:*` RPC and
  `TaskSpec` (`packages/shared/src/tasks/schema.ts`) denote the YAML DAG
  conductor — a different concept from a user-facing task.

Adding more modules (Tasks, Meetings, Feed, Inbox, …) without stabilizing
these concepts would produce duplicate state, competing navigation systems and
migration debt.

## Decisions

1. **Mode, Surface, Tab and Panel are separate concepts.** A mode does not
   close; an object is opened as a Surface; a Tab places a Surface instance in
   a TabGroup; a Panel is a physical screen area (`PanelSlot`).
2. **Browser windows are normal Surfaces** (`{ kind: 'browser' }` tabs).
   `BrowserTabStrip` will be removed as an independent tab system.
3. **WorkItem and Run are separate aggregates.** A task describes a desired
   outcome; a run is one concrete execution attempt.
4. **Session is a conversation aggregate, not a task aggregate.** No new
   task-specific fields may be added to `Session`.
5. **CalendarEvent and Meeting are separate aggregates.**
6. **WorkflowDefinition and AutomationDefinition are separate aggregates**
   (workflow = graph of steps; automation = trigger + workflow + policy).
7. **ActivityEvent and Notification are separate aggregates** (fact vs.
   personalized delivery of a fact).
8. **Knowledge content and WorkGraph domain state use separate providers**,
   linked by `ContentRef`.
9. **All domain mutations are versioned, attributable and command-driven.**
10. **AI-generated mutations use ChangeProposal** unless policy explicitly
    permits automatic application.
11. **Current-state mutation, event append and outbox append are atomic.**
12. **Views are stored query/projection definitions, not independent data
    copies.**
13. **Presence is ephemeral** and server-authoritative for shared workspaces.
14. **Workbench layout is persisted per user** as `WorkbenchLayout` v2;
    `SurfaceLayoutSnapshot` v1 stays readable for at least two releases.
15. **Platform contracts live in `@craft-agent/core/platform`**
    (`packages/core/src/platform/`), next to the existing surfaces/panels/
    commands registries. The canonical `SurfaceTab` union is extended, never
    duplicated, so there is exactly one tab model.
16. **Granular feature flags replace the single `featureUnifiedShellAtom`
    wave gate** for new work; the flag catalog and resolution semantics live
    in `platform/feature-flags` (see §39 of the convergence plan).

## Naming

| Old | New | Notes |
| --- | --- | --- |
| `TaskSpec` | `WorkflowSpec` | Alias exported from `packages/shared/src/tasks/schema.ts`; wire format (`task.yaml`, `tasks:*` RPC channels) unchanged and now considered legacy-stable. |
| `TaskRunSnapshotDto` / `TaskRunRequest` | `WorkflowRunSnapshotDto` / `WorkflowRunRequest` | Aliases in `packages/shared/src/protocol/dto.ts`. No `TaskRun` type exists; runtimes keep `TaskRunner` internal. |
| user task | `WorkItem` | New aggregate (future PR). Must not reuse the `tasks:*` protocol namespace; new RPC goes to `workitems:*`. |
| browser tab | Browser Surface | `SurfaceTab { kind: 'browser' }` already exists. |
| panel stack | `LegacyPanelStack` | `panelStackAtom` / `PanelStackEntry` stay until the renderer migrates. |
| new layout | `WorkbenchLayout` | `packages/core/src/platform/workbench/`. |

## Consequences

- Existing surfaces migrate incrementally (strangler), no big-bang rewrite.
- New Tasks functionality will not extend `Session`.
- `BrowserTabStrip` will be removed as an independent tab system.
- New modules must register commands, modes, surfaces and panels through the
  platform registries (`platform/commands`, `platform/modes`,
  `platform/surfaces`, `platform/panels`).
- Domain state must not be stored directly in renderer atoms; atoms hold
  ephemeral and persisted *UI* state only.
- `WorkbenchLayout` v2 deliberately does **not** carry panel-slot visibility
  or widths: chrome geometry stays in `PanelRegistryState` / `LayoutProfile`
  (S-03 §3.7, delta-only overrides). A third competing store would violate
  decision 1.
- `SurfaceInstance` does not store `route`: routes are derived from the
  durable tab ref via `surfaceTabToRoute` (renderer), keeping
  URL/NavigationContext the single source of truth for the focused surface.

## Rollout

The migration is protected by granular feature flags
(`platform/feature-flags/workbench-flags.ts`) and reversible layout snapshots.
Legacy `SurfaceLayoutSnapshot` v1 remains readable for at least two releases;
the pure migration `migrateSurfaceLayoutSnapshotToWorkbench`
(`platform/workbench/migrate.ts`) maps every legacy panel to a single-tab
TabGroup so no open surface is lost.

## Addendum (2026-08-13) — shell seam

Implements `docs/superpowers/specs/2026-08-13-workbench-shell-seam-design.md`.
This addendum wins over the first-increment sketch where they disagree.

### Geometry is 1D

`OpenSurfaceTarget` is `'active-group' | 'new-group-right' | 'new-window'`.
`'new-group-bottom'` is not part of the model. `WorkspaceSurfaceHost.split`
with `'down'` inserts a group to the right until a split-tree increment.

### Preview is a single bit

`SurfaceInstance` has `preview: boolean` (`false` ⇒ pinned). There is no
`pinned` field, so a tab cannot be both preview and pinned.

### Dirty close / replace is a Result

`closeSurface` returns `LayoutMutation`. Closing a dirty tab without
`force: true` is `{ ok: false, code: 'DIRTY_SURFACE' }`. Opening a new
preview over a dirty preview pins the dirty tab and appends the new one.

### One host

`WorkbenchApi` is removed. `WorkspaceSurfaceHost` is the only host and
speaks `WorkbenchLayout` (`restore` / `serializeLayout`). Core ships an
in-memory adapter; the renderer adapter keeps URL writes on the panel
stack in this increment.

### Flag resolution is deterministic

Unknown dependencies disable the dependent flag. One-way
`incompatibleWith`: the declarer yields. Mutual incompatibility: the
lexicographically smaller id wins. `featureUnifiedShellAtom` is an
OR-fallback for `workbench.*` flags only.

### Rollback

`migrateWorkbenchToSurfaceLayoutSnapshot` flattens every v2 tab into its
own v1 panel so no surface is lost. Grouping is not preserved.

### Status slot

`StatusBarHost` occupies `PanelSlot` `'status'`. Ready transport/runtime
and permission mode live there. Failures stay
`TransportConnectionBanner` / `ToolchainStatusBanner`. Composer
`ToolbarStatusSlot` is unrelated.
