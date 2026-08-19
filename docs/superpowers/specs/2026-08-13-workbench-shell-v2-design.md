# Workbench Shell v2 — first increment design

**Date:** 2026-08-13
**ADR:** [0001-rox-workbench-convergence.md](../../architecture/adr/0001-rox-workbench-convergence.md)
**Depends on:** suite S (`docs/specs/2026-08-07-unified-shell/`) — do not fork a second shell.

## Goal

Ship the executable shell foundation: one Mode Bar, one surface tab system
with TabGroups, browser as a Surface, and a Status Bar in slot `status`.
Old objects (sessions, knowledge, embedded browser) keep opening through
existing URL / panel-stack truth.

## What already exists (reuse)

- `SurfaceTab` 7-kind union, `SurfaceRegistry`, `SurfaceLayoutSnapshot` v1
- `PanelSlot` including `status`, `PanelRegistry`, `LayoutProfile`
- `panelStackAtom` + `NavigationContext` (URL is source of truth)
- W1 hosts: `ActivityRail`, `SurfaceTabs`, `InspectorHost` behind
  `featureUnifiedShellAtom`
- CommandRegistry bridged from native `actions/`
- Embedded browser as `kind: 'browser'` panel; OS windows in `BrowserTabStrip`

## What this increment adds

### Contracts (`packages/core/src/platform`)

- `ModeRegistry` / `ModeContribution` — static modes, not document tabs
- `WorkbenchLayout` v2 — `TabGroup` + `SurfaceInstance`
- Pure migration: each `LegacyPanelStack` entry → one group with one tab
- `FeatureFlagDefinition` list for `workbench.*` flags
- `WorkflowSpec` / `WorkflowRunSnapshot` aliases (no RPC/FS rename)

### Renderer

- Granular jotai flags (default OFF, independent of W1 master)
- `ModeBar` in `TopBar` when mode/chrome flags are on
- Activity rail becomes global actions (search / create / settings) when
  top-chrome v2 is on; destinations stay in the Mode Bar
- `SurfaceTabs` can show TabGroups and OS-window browser surfaces
- `StatusBarHost` at the bottom of the main column
- `BrowserTabStrip` hidden from TopBar when browser-surface v2 is on

## Flag matrix

| Flag | Default | Effect |
| --- | --- | --- |
| `featureUnifiedShellAtom` (existing) | false | W1 rail + SurfaceTabs + inspector |
| `workbench.mode-registry.v1` | false | Mode Bar |
| `workbench.top-chrome.v2` | false | Mode Bar + utility rail + presence/usage placeholders |
| `workbench.tab-groups.v2` | false | Derive/persist WorkbenchLayout v2; tab strip groups splits |
| `workbench.browser-surface.v2` | false | OS browser windows appear in SurfaceTabs; hide TopBar strip |
| `workbench.status-bar.v1` | false | StatusBarHost |
| `workbench.panel-registry.v2` | false | Reserved; StatusBarHost is the first `status` slot occupant |

`workbench.top-chrome.v2` implies the mode bar even if mode-registry is off.

## Modes (seed)

Pinned and live: `chat` → sessions, `knowledge` → knowledge.
Registered but unavailable (disabled + tooltip): `home`, `meetings`,
`tasks`, `feed`, `inbox`. No empty Home page in this increment.

## TabGroups vs panel stack

Panel stack remains the live split columns. Each stack entry is one
TabGroup with one tab after migration. Reducers for open/close/split/move
and preview-tab replacement live in core and are unit-tested. Wiring
“open in current group instead of replacing the panel” is ready in the
reducer, not yet hooked into `NavigationContext` (avoids dual persistence).

URL still wins over a v2 snapshot on conflict.

## Browser merge

`kind: 'browser'` already exists for embedded panes. Non-embedded OS
windows are extra surface tabs with the existing window actions (show
window, open linked session, terminate). They are not forced into
`panelStackAtom` (that would mount `BrowserPanelPage` for a real OS window).

## Status bar vs banners

Status bar shows durable Local/Remote/Offline, sync OK, run/approval
placeholders, permission label, presence/usage placeholders.
`TransportConnectionBanner` / `ToolchainStatusBanner` remain for failed /
installing states that need intervention.

## Anti-goals (this increment)

No WorkGraph, no WorkItems UI, no second command system, no presence in
localStorage, no 15 destinations in the rail, no CRDT, no hosted email,
no Folo copy, no sim.ai backend.
