# Workbench shell seam — design spec

- **Date**: 2026-08-13
- **Status**: Accepted (implements ADR-0001 addendum)
- **Related**: [ADR-0001](../../architecture/adr/0001-rox-workbench-convergence.md), suite S ([S-02](../../specs/2026-08-07-unified-shell/02-surface-registry-tabs.md), [S-03](../../specs/2026-08-07-unified-shell/03-panels-rails.md)), [CONTEXT.md](../../../CONTEXT.md)

## 1. Goal

Finish the first workbench increment so the shell seam is honest, testable, and wired into the existing unified-shell chrome — without building a second application shell.

This spec covers tickets T0–T8. Out of scope: WorkGraph kernel, WorkItems, Meetings, Feed, Mail, Presence, CRDT, Home front page, Folo, hosted email, and extending the `SurfaceTab` union.

## 2. Invariants (non-negotiable)

- Mode ≠ Surface ≠ Tab ≠ Panel.
- Task ≠ Run; Session ≠ Task (no new Session task fields).
- CalendarEvent ≠ Meeting; ActivityEvent ≠ Notification.
- Knowledge ≠ WorkGraph; Workspace ≠ Space.
- AI output ≠ applied mutation.
- URL / NavigationContext remains the source of truth for **focus**. `?panels=` is 1D and cannot encode groups-with-multiple-tabs; `WorkbenchLayout` is the source of truth for tab-group membership, preview/dirty, and split shares.
- Chrome widths/visibility stay in `LayoutProfile` / `PanelRegistryState`. `WorkbenchLayout` does not store panel-slot geometry.
- Contracts live in `@craft-agent/core/platform`. There is one `SurfaceTab` union.
- Domain flags (`meetings.*`, `presence.*`, `workgraph.*`, …) are not flipped by the renderer’s unified-shell fallback.

## 3. Geometry (T0)

`OpenSurfaceTarget` is 1D for this increment:

```ts
type OpenSurfaceTarget = 'active-group' | 'new-group-right' | 'new-window'
```

`'new-group-bottom'` is removed. A split tree (`down`) is a later increment. `WorkspaceSurfaceHost.split(..., 'down')` maps to the same 1D insert as `'right'` until a split-tree lands.

`SurfaceInstance` uses a single role bit:

- `preview: true` — preview tab (one per group).
- `preview: false` — pinned tab.

The `pinned` boolean is deleted so `{ pinned: true, preview: true }` is unrepresentable. Helper: `isPinnedSurface(instance) === !instance.preview`.

## 4. Dirty policy (T0)

Mutations that can drop user data return `LayoutMutation`:

```ts
type LayoutMutation =
  | { ok: true; layout: WorkbenchLayout }
  | { ok: false; code: 'DIRTY_SURFACE' | 'NOT_FOUND'; layout: WorkbenchLayout }
```

- `closeSurface(layout, id)` on a dirty tab without `{ force: true }` returns `{ ok: false, code: 'DIRTY_SURFACE' }` and leaves the layout unchanged.
- Unknown id → `{ ok: false, code: 'NOT_FOUND' }` (same layout reference).
- Opening a new preview into a group whose current preview is **dirty** pins the dirty tab (`preview: false`) and appends the new preview. Data is never silently replaced.
- A clean preview is still replaced in place.

## 5. Parse invariants (T0)

`parseWorkbenchLayout` is a real parser. It returns `null` (never throws) unless every invariant holds:

- `version === 2`, `workspaceId` is a string.
- Group ids unique; tab instance ids unique across the layout.
- No empty groups.
- `activeGroupId` is `null` or names an existing group.
- Each `activeTabId` is `null` or names a tab in that group.
- Each `tab.tab` parses as a canonical `SurfaceTab`.
- `preview` and `dirty` are booleans; `proportion` is a finite number ≥ 0.
- Legacy v2 JSON that still has `pinned` is accepted: `preview` is the source of truth; `pinned` is dropped.

v1 snapshots are rejected here — callers must migrate explicitly.

## 6. Feature flags (T0, T3)

Resolution is two-phase and order-independent:

1. Base = `override ?? defaultValue`. Unknown dependency → disabled (`disabled-by-dependency`). Cycles → disabled (`disabled-by-cycle`).
2. Incompatibility:
   - one-way (`A.incompatibleWith` includes `B`, not vice versa): **A yields**.
   - mutual: **lexicographically smaller id wins**; the larger yields.

Renderer adapter:

- Persist overrides under `KEYS.featureFlagOverrides`.
- `featureUnifiedShellAtom` is an OR-fallback only for workbench chrome whose ON state is a **strict superset of W1**: `workbench.status-bar.v1`, `workbench.tab-groups.v2`.
- `workbench.mode-registry.v1`, `workbench.top-chrome.v2`, and `workbench.browser-surface.v2` stay off until an explicit override — they replace W1 destinations or hide `BrowserTabStrip`.
- Domain / workgraph flags never inherit that fallback.

## 7. One host (T1)

`WorkbenchApi` is deleted. `WorkspaceSurfaceHost` is the only host interface and speaks `WorkbenchLayout`:

- `open / close / pin / move / activate / layout / onDidChange`
- `split` (1D: both `right` and `down` insert a group to the right)
- `restore(layout: WorkbenchLayout)` / `serializeLayout(): WorkbenchLayout`
- `manageBounds` (no-op in the in-memory adapter)

Two adapters:

1. **In-memory** (`createInMemoryWorkspaceSurfaceHost`) — core tests; restore/serialize round-trip.
2. **Renderer** — later write-path owner; this increment keeps URL writes on `panelStackAtom` and **reads** `WorkbenchLayout` in SurfaceTabs when `workbench.tab-groups.v2` is on.

## 8. Migration (T2)

- v1 → v2: each legacy panel becomes a single-tab group (already shipped). Group id = `panelId`.
- v2 → v1 (rollback): **flatten** every tab to its own v1 panel so no surface is lost. Grouping is lost. Proportions: group share split equally across its tabs.
- Readers accept v1 for at least two releases.

## 9. Modes (T4)

Core seed (injected routes, i18n keys, icon **names**):

| id | title key | icon | root |
| --- | --- | --- | --- |
| `core.chat` | `modes.core.chat.title` | `message-square` | sessions |
| `core.knowledge` | `modes.core.knowledge.title` | `book-open` | knowledge |
| `core.settings` | `modes.core.settings.title` | `settings` | settings |

`ModeRegistry.list()` applies both `when` and `requiredCapabilities` (AND). A capability is present when `ctx[cap] === true`, `ctx.capability === cap`, or `ctx.capabilities` (array) contains it.

When `workbench.mode-registry.v1` is on, ActivityRail reads the registry (not a second copy of `APP_NAV_DESTINATIONS`). Other AppShell sidebar destinations stay as they are.

When `workbench.top-chrome.v2` is on, TopBar mounts a Mode Bar that reads the **same** registry (current mode + switch). It is not a second catalog.

## 10. SurfaceTabs and persist (T5)

When `workbench.tab-groups.v2` is on:

- SurfaceTabs **reads** `WorkbenchLayout` (derived from the live panel stack via the v1→v2 migration, then persisted).
- Focus/close still write through existing panel-stack / NavigationContext (URL remains focus SoT).
- Persist key: `KEYS.workbenchLayout` with workspace suffix. Writes go through `parseWorkbenchLayout` (drop on `null`); readers use the same parser. This persist is a mirror of the 1D stack, not grouping SoT.
- Renderer `SurfaceTabLike` becomes a type alias of canonical `SurfaceTab` from `@craft-agent/core/platform`.

## 11. Browser (T6)

Browser windows are `SurfaceTab { kind: 'browser' }`.

- Extract pane lifecycle (list / state / removed / interacted) out of `BrowserTabStrip` so TopBar is not the only owner. The strip calls `useBrowserPaneLifecycle(enabled)` when it owns IPC (playground).
- When `workbench.browser-surface.v2` is on, **do not** render `BrowserTabStrip` in TopBar. Playground may still mount the strip.
- SurfaceTabs already projects browser panels from the stack.

## 12. Status bar (T7)

`StatusBarHost` mounts on `PanelSlot` `'status'` at the bottom of `UnifiedShellLayout` when `workbench.status-bar.v1` is on.

Shows ready-state: transport (local / connected), runtime (omp ready / outdated). Permission mode of the **focused session** (`mode.safe` / `mode.ask` / `mode.allow-all`); off a session the chip is hidden rather than showing `defaultSessionOptions` (`ask`).

Intervening failures stay banners: `TransportConnectionBanner`, `ToolchainStatusBanner`. Do not reuse `ToolbarStatusSlot` (composer overlay).

## 13. Docs (T8)

- `CONTEXT.md` — agent-facing map of the seam.
- ADR-0001 addendum — geometry, dirty Result, one host, flag determinism, fallback.
- S-02 / S-03 — pointer: layout host and status slot are implemented against ADR-0001, not a second spec.
