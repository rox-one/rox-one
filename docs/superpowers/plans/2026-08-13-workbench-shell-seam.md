# Workbench Shell Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench shell seam honest (1D geometry, real parse, dirty Result, deterministic flags), unify the host with an in-memory adapter, migrate v1↔v2, and wire Mode Bar / SurfaceTabs / browser / status bar behind granular flags.

**Architecture:** Deepen `@craft-agent/core/platform` (feature-flags, modes, workbench, surfaces host). Renderer binds flags, ModeRegistry, layout persist, and chrome; URL stays focus SoT. No second shell.

**Tech Stack:** Bun, TypeScript, Jotai, react-i18next (10 locales, ASCII-sorted keys).

## Global Constraints

- Contracts live in `packages/core/src/platform/`; renderer imports `@craft-agent/core/platform`.
- All user-facing strings go through `t()`; new keys in all 10 locale files, ASCII-sorted.
- Tests: `bun test <path>`; typecheck per package. TDD: failing test before production code.
- Do not extend `SurfaceTab`. Do not add Session task fields. Do not reuse `ToolbarStatusSlot`.
- `featureUnifiedShellAtom` is OR-fallback for additive `workbench.*` chrome only (`status-bar`, `tab-groups`). Mode-registry / top-chrome / browser-surface need an explicit override.
- Continue PR #8 on `rox-workbench-convergence-bb11`; do not open a second PR.

---

## File map

**Core (T0–T2, T4 seed)**

- `packages/core/src/platform/workbench/types.ts` — drop `pinned` and `new-group-bottom`; delete `WorkbenchApi`; add `LayoutMutation`.
- `packages/core/src/platform/workbench/layout.ts` — dirty Result, dirty-preview pin, no module-global ids.
- `packages/core/src/platform/workbench/migrate.ts` — real parse; v2→v1 flatten.
- `packages/core/src/platform/workbench/memory-host.ts` — in-memory `WorkspaceSurfaceHost`.
- `packages/core/src/platform/surfaces/host.ts` — host speaks `WorkbenchLayout`.
- `packages/core/src/platform/surfaces/descriptor.ts` — `parseSurfaceTab`.
- `packages/core/src/platform/feature-flags/registry.ts` — two-phase resolve.
- `packages/core/src/platform/modes/registry.ts` — `requiredCapabilities`.
- `packages/core/src/platform/modes/core-modes.ts` — Chat / Knowledge / Settings seed.
- Tests under `packages/core/src/platform/__tests__/`.

**Renderer (T3–T7)**

- `apps/electron/src/renderer/lib/local-storage.ts` — `featureFlagOverrides`, `workbenchLayout`, `panelProfile`.
- `apps/electron/src/renderer/atoms/unified-shell.ts` + `platform/feature-flags.ts` — override adapter.
- `apps/electron/src/renderer/platform/{ModeBar,StatusBarHost,browser-pane-lifecycle,workbench-layout-sync}.ts(x)`.
- `ActivityRail.tsx`, `SurfaceTabs.tsx`, `TopBar.tsx`, `platform/index.tsx`, `layout-snapshot.ts`.

**Docs / i18n (T8)**

- `CONTEXT.md`, ADR-0001 addendum, S-02/S-03 pointers, 10 locale files.

---

### Task T0 — Honest geometry and invariants

**Files:** workbench types/layout/migrate, feature-flag registry, mode registry, existing core tests.

- [x] Write failing tests: dirty preview pins; close dirty without force; parse rejects; mutual incompat lex; unknown dep disables; `requiredCapabilities` filters `list()`.
- [x] Run `bun test packages/core/src/platform/__tests__` — new tests fail.
- [x] Implement: drop `pinned` / `new-group-bottom`; `LayoutMutation`; real parse; two-phase flags; capabilities in `list()`; no module-global id counter.
- [x] Update existing tests for the new `closeSurface` shape and `preview`-only role.
- [x] Run core tests + `bun run tsc --noEmit` in `packages/core`.

### Task T1+T2 — One host + v1↔v2

**Files:** `surfaces/host.ts`, `workbench/memory-host.ts`, `migrate.ts`, new tests.

- [x] Failing tests: in-memory restore/serialize round-trip; split 1D; v2→v1 flatten keeps every tab; parse snapshot cases.
- [x] Implement host + reverse migrate.
- [x] Green + tsc.

### Task T3 — Renderer flag adapter

**Files:** `local-storage.ts`, `atoms/unified-shell.ts`, `platform/feature-flags.ts` + test.

- [x] Failing test: additive `workbench.*` enabled via unified-shell fallback; mode-registry / browser-surface / `tasks.*` / `workgraph.*` not.
- [x] Implement singleton registry + persisted overrides.
- [x] Green.

### Task T4 — Mode seed + Mode Bar / rail

**Files:** `modes/core-modes.ts`, `ActivityRail.tsx`, `ModeBar.tsx`, `TopBar.tsx`, i18n.

- [x] Failing test: core seed ids/order/title keys; `list()` respects capabilities.
- [x] Wire rail to registry when flag on; Mode Bar in TopBar when `workbench.top-chrome.v2`.
- [x] i18n keys in all 10 locales.

### Task T5 — SurfaceTabs from WorkbenchLayout

**Files:** `workbench-layout-sync.ts`, `SurfaceTabs.tsx`, `layout-snapshot.ts`.

- [x] Failing test: panel-stack snapshot migrates to v2; parse persist round-trip; `SurfaceTabLike` alias equals `SurfaceTab`.
- [x] Persist `KEYS.workbenchLayout` via `parseWorkbenchLayout`; SurfaceTabs reads layout when flag on; writes still panel-stack/URL.

### Task T6 — Browser surface

**Files:** `browser-pane-lifecycle.ts`, `BrowserTabStrip.tsx`, `TopBar.tsx`.

- [x] Extract lifecycle hook; strip uses it; TopBar hides strip when `workbench.browser-surface.v2`.
- [x] Playground still mounts `BrowserTabStrip`.

### Task T7 — StatusBarHost

**Files:** `StatusBarHost.tsx`, `platform/index.tsx`, copy helper + test.

- [x] Pure copy helper tests (local/connected/ready/permission).
- [x] Mount on status slot; banners unchanged.

### Task T8 — Docs

- [x] `CONTEXT.md`, ADR addendum, S-02/S-03 pointers.
- [x] Verify: core tests, shared i18n + tsc, server-core tsc, electron typecheck.

---

## Verification

```
cd packages/core && bun test && bun run tsc --noEmit
cd packages/shared && bun test src/i18n && bun run tsc --noEmit
cd packages/server-core && bun run tsc --noEmit
cd apps/electron && bun run typecheck
bun test apps/electron/src/renderer/platform
```
