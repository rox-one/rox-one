# Workbench Shell v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the first Unified Shell increment (PR-0…PR-4): Mode Bar, TabGroups snapshot, browser-as-surface tabs, and Status Bar — without a second AppShell.

**Architecture:** Reuse suite S hosts (`ActivityRail`, `SurfaceTabs`, `InspectorHost`). Granular `workbench.*` flags (default OFF) independently gate new chrome. URL / `panelStackAtom` remain focused-surface truth. Core already has `ModeRegistry` and `WorkbenchLayout` v2 reducers.

**Tech Stack:** Bun, TypeScript, React, Jotai, react-i18next, `@craft-agent/core/platform`.

## Global Constraints

- Flags default **OFF**. `featureUnifiedShellAtom` stays the W1 master.
- Mode Bar is on if **either** `workbench.mode-registry.v1` **or** `workbench.top-chrome.v2` is on.
- Do not hook “open in current group” into `NavigationContext`.
- Do not push OS browser windows into `panelStackAtom`.
- Do not store presence or domain state in Jotai/localStorage as source of truth.
- All user-facing strings via `t()`; new keys in all 10 locales, ASCII-sorted.
- No WorkGraph / Meetings / Feed / Mail / CRDT / Home Front Page in this increment.

---

### Task 1: Renderer chrome + layout helpers

**Files:**
- Create: `apps/electron/src/renderer/platform/workbench-chrome.ts`
- Create: `apps/electron/src/renderer/platform/os-browser-tabs.ts`
- Modify: `apps/electron/src/renderer/platform/tab-groups.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/workbench-chrome.test.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/tab-groups.test.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/status-model.test.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/os-browser-tabs.test.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/modes-seed.test.ts`

**Produces:** `resolveWorkbenchChrome`, `groupTabsByLayout`, `osBrowserSurfaceTabs`, `panelStackToWorkbenchLayout`.

- [x] Write failing tests then implement helpers (this session executes inline).

---

### Task 2: Hosts

**Files:**
- Create: `apps/electron/src/renderer/platform/ModeBar.tsx`
- Create: `apps/electron/src/renderer/platform/StatusBarHost.tsx`
- Create: `apps/electron/src/renderer/components/browser/use-workspace-browser-windows.ts`
- Modify: `ActivityRail.tsx`, `SurfaceTabs.tsx`, `BrowserTabStrip.tsx`

---

### Task 3: Wiring

**Files:**
- Modify: `platform/index.tsx`, `TopBar.tsx`, `AppShell.tsx` (rail offset), `App.tsx` (status slot)

---

### Task 4: i18n

**Files:** `packages/shared/src/i18n/locales/{de,en,es,fr,hu,ja,pl,ru,zh-Hans,zh-Hant}.json`

Keys: `workbench.mode.*`, `workbench.rail.*`, `workbench.status.*` (plurals `_one/_few/_many/_other`), `workbench.browser.*`, presence/usage placeholders.

---

### Task 5: Verify and ship

Run: core tests, renderer platform tests, i18n parity, `packages/core` tsc, electron typecheck for touched files. Commit, push, open PR against `main`.
