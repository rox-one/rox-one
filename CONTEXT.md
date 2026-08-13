# CONTEXT — Rox Workbench shell seam

Agent-facing map of the workbench increment. Read this before changing chrome, tabs, flags, or modes.

## Where the truth lives

| Concern | Source of truth | Store |
| --- | --- | --- |
| Focused surface | URL / NavigationContext (`?route=`, `?panels=`, `?fi=`) | `KEYS.workspaceUrl` |
| Tab groups, preview, dirty, split shares | `WorkbenchLayout` v2 | `KEYS.workbenchLayout` (workspace suffix) |
| Chrome widths / visibility | `LayoutProfile` / `PanelRegistryState` | `KEYS.panelProfile` (when persisted) |
| Wave-era unified shell | `featureUnifiedShellAtom` | `KEYS.featureUnifiedShell` |
| Granular flags | `FeatureFlagRegistry` + overrides | `KEYS.featureFlagOverrides` |

`?panels=` is 1D. It cannot encode a group with multiple tabs. Do not try to round-trip full `WorkbenchLayout` through the URL.

## Modules

- Platform contracts: `packages/core/src/platform/` (`feature-flags/`, `modes/`, `workbench/`, `surfaces/`, `panels/`).
- Host: `WorkspaceSurfaceHost` in `surfaces/host.ts`. In-memory adapter: `workbench/memory-host.ts`. There is no second `WorkbenchApi`.
- Renderer chrome: `apps/electron/src/renderer/platform/` (`UnifiedShellLayout`, ActivityRail, SurfaceTabs, ModeBar, StatusBarHost).
- Canonical tab union: `SurfaceTab` in `packages/core/src/platform/surfaces/types.ts`. Renderer `SurfaceTabLike` is an alias, not a twin.

## Flags

Catalog: `WORKBENCH_FEATURE_FLAGS`. All default OFF.

Renderer: a `workbench.*` flag is on if the registry resolves it **or** `featureUnifiedShellAtom` is on. `workgraph.*` / domain flags never get that fallback.

Relevant shell flags: `workbench.mode-registry.v1`, `workbench.top-chrome.v2`, `workbench.tab-groups.v2`, `workbench.browser-surface.v2`, `workbench.status-bar.v1`.

## Naming (do not collapse)

Mode ≠ Surface ≠ Tab ≠ Panel. Session ≠ Task. Task ≠ Run. Browser windows are `SurfaceTab { kind: 'browser' }`, not a second tab strip.

`TaskSpec` / `tasks:*` RPC are the YAML DAG conductor (legacy-stable). User-facing tasks will be `WorkItem` later — not this increment.

## Docs

- Architecture: `docs/architecture/adr/0001-rox-workbench-convergence.md`
- This increment: `docs/superpowers/specs/2026-08-13-workbench-shell-seam-design.md`
- Plan: `docs/superpowers/plans/2026-08-13-workbench-shell-seam.md`
- Suite S (shell slots / surfaces / panels) remains historical; ADR-0001 + this spec win on conflicts. Pointers live at the top of S-02 and S-03.

## Out of scope here

WorkGraph kernel, WorkItems, Meetings, Feed, Mail, Presence, CRDT, Home, Folo, hosted email, extending `SurfaceTab`.
