# Settings Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare Settings fallback with a useful overview, make 18 settings pages searchable and grouped, and retain recent settings pages per workspace.

**Architecture:** `settings-registry.ts` remains the canonical page catalog. Two small pure modules add visual grouping/filtering and workspace-scoped recent-page persistence; `SettingsNavigator` consumes them, while `MainContentPanel` chooses a new `SettingsOverviewPage` only for the bare settings route.

**Tech Stack:** React 18, TypeScript, Tailwind utilities, Jotai/App Shell context, react-i18next, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-02-settings-command-center-design.md`

## Global Constraints

- Preserve all current settings routes, deeplinks, page IDs, page components, and IPC contracts.
- Desktop Electron renderer scope only; do not add service/provider integrations.
- Use `t()` for every visible string; add keys to all 10 locale files in ASCII order.
- Never create health/readiness claims from inferred data; Overview displays only existing renderer state.
- Persist at most five unique recent valid `SettingsSubpage` IDs, newest first, isolated by workspace.
- Do not commit or push; the user has not requested it.

---

### Task 1: Build tested settings presentation and recent-history primitives

**Files:**
- Create: `apps/electron/src/shared/settings-presentation.ts`
- Create: `apps/electron/src/shared/__tests__/settings-presentation.test.ts`
- Create: `apps/electron/src/renderer/lib/settings-recent.ts`
- Create: `apps/electron/src/renderer/lib/__tests__/settings-recent.test.ts`

**Interfaces:**
- Consumes: `SETTINGS_PAGES`, `VALID_SETTINGS_SUBPAGES`, `isValidSettingsSubpage`, and `SettingsSubpage` from `apps/electron/src/shared/settings-registry.ts`.
- Produces: `SETTINGS_GROUPS`, `getSettingsGroup(id)`, `groupSettingsPages(items)`, `filterSettingsPages(items, query)`, `readRecentSettings(workspaceId)`, and `recordRecentSetting(workspaceId, subpage)`.
- Contract: groups cover each registered settings page exactly once; filters preserve supplied order; recent storage rejects malformed and unknown IDs, de-duplicates, and caps at five.

- [x] **Step 1: Write grouping and filtering tests**

Create `apps/electron/src/shared/__tests__/settings-presentation.test.ts` with Bun assertions for:

```ts
import { describe, expect, it } from 'bun:test'
import { SETTINGS_PAGES } from '../settings-registry'
import {
  filterSettingsPages,
  groupSettingsPages,
  SETTINGS_GROUPS,
} from '../settings-presentation'

it('covers every registered settings page exactly once', () => {
  const ids = SETTINGS_GROUPS.flatMap(group => group.pageIds)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(ids)).toEqual(new Set(SETTINGS_PAGES.map(page => page.id)))
})

it('filters translated rows without reordering matching pages', () => {
  const rows = [
    { id: 'runtime' as const, label: 'Runtime', description: 'Agent runtime' },
    { id: 'appearance' as const, label: 'Appearance', description: 'Theme and font' },
  ]
  expect(filterSettingsPages(rows, 'theme')).toEqual([rows[1]])
})
```

- [x] **Step 2: Run presentation tests and observe failure**

Run:

```bash
bun test apps/electron/src/shared/__tests__/settings-presentation.test.ts
```

Expected: failure because `settings-presentation.ts` does not exist.

- [x] **Step 3: Implement presentation metadata and pure helpers**

Create `settings-presentation.ts` with a typed group definition whose `pageIds` retain the exact registry order. Implement `groupSettingsPages` by mapping registered IDs to supplied rows; throw only in development-facing helper code when a registry page is absent. Implement `filterSettingsPages` using normalized, trimmed case-insensitive matching against pretranslated `label` and `description`; blank query returns the original ordered rows.

- [x] **Step 4: Run presentation tests and typecheck**

Run:

```bash
bun test apps/electron/src/shared/__tests__/settings-presentation.test.ts && bun run --cwd apps/electron typecheck
```

Expected: both commands pass.

- [x] **Step 5: Write recent-history tests**

Create `apps/electron/src/renderer/lib/__tests__/settings-recent.test.ts`. Install a deterministic in-memory `localStorage` test double in `beforeEach`, then assert:

```ts
expect(recordRecentSetting('ws-a', 'runtime')).toEqual(['runtime'])
expect(recordRecentSetting('ws-a', 'ai')).toEqual(['ai', 'runtime'])
expect(recordRecentSetting('ws-a', 'runtime')).toEqual(['runtime', 'ai'])
expect(readRecentSettings('ws-b')).toEqual([])
```

Also assert that invalid JSON, non-array JSON, and `['runtime', 'obsolete', 5]` read as only valid IDs; then record six valid IDs and expect exactly the latest five.

- [x] **Step 6: Run recent-history tests and observe failure**

Run:

```bash
bun test apps/electron/src/renderer/lib/__tests__/settings-recent.test.ts
```

Expected: failure because `settings-recent.ts` does not exist.

- [x] **Step 7: Implement workspace-scoped recent storage**

Create `settings-recent.ts` with the single key format `craft.settings.recent.v1:<workspaceId>`. Parse storage defensively, validate IDs with `isValidSettingsSubpage`, filter duplicates while preserving most-recent order, and write only the bounded valid array. Treat missing workspace ID as non-persisting and return an empty list.

- [x] **Step 8: Run all primitive tests**

Run:

```bash
bun test apps/electron/src/shared/__tests__/settings-presentation.test.ts apps/electron/src/renderer/lib/__tests__/settings-recent.test.ts
```

Expected: all tests pass.

### Task 2: Add the Settings Overview page and locale copy

**Files:**
- Create: `apps/electron/src/renderer/pages/settings/SettingsOverviewPage.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx:18-105,202-214`
- Modify: `packages/shared/src/i18n/locales/de.json`
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/es.json`
- Modify: `packages/shared/src/i18n/locales/fr.json`
- Modify: `packages/shared/src/i18n/locales/hu.json`
- Modify: `packages/shared/src/i18n/locales/ja.json`
- Modify: `packages/shared/src/i18n/locales/pl.json`
- Modify: `packages/shared/src/i18n/locales/ru.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hant.json`

**Interfaces:**
- Consumes: `useAppShellContext()` (`activeWorkspaceId`, `workspaces`, `llmConnections`, `workspaceDefaultLlmConnection`), `useActiveWorkspace()`, `navigate()`, `routes.view.settings(subpage)`, `getSettingsPage(id)`, recent-history helpers from Task 1.
- Produces: `SettingsOverviewPage`, rendered only when `navState` is settings navigation with `subpage === null`.
- Contract: overview never invokes new IPC; quick actions navigate through existing settings routes; no unavailable data is represented as a passing status.

- [x] **Step 1: Add complete locale coverage before rendering copy**

Add a `settings.overview` object in every locale file with the same ASCII-sorted leaf keys:

```json
{
  "actions": "Quick actions",
  "attention": "Needs attention",
  "configureAi": "Configure AI",
  "configureWorkspace": "Choose workspace",
  "emptyRecent": "Open a settings area to find it here later.",
  "recent": "Recently opened",
  "runtime": "Runtime",
  "title": "Settings",
  "workspace": "Workspace"
}
```

Use the natural translation for each locale; do not copy English into non-English files. Keep each locale's surrounding object keys ASCII-sorted.

- [x] **Step 2: Run i18n parity test and observe failure before page code**

Run:

```bash
bun test packages/shared/src/i18n
```

Expected: pass once all 10 locales contain the exact same new key shape; fix key parity before proceeding.

- [x] **Step 3: Implement `SettingsOverviewPage`**

Build a full-height page matching existing settings pages: `PanelHeader`, `ScrollArea`, centered `max-w-3xl` content, existing `SettingsCard`, and existing Button/icon components. Render:

- workspace name and root path when `useActiveWorkspace()` returns a workspace; otherwise neutral setup copy and a button to `routes.view.settings('workspace')`;
- the connection whose `slug` matches `workspaceDefaultLlmConnection` when the App Shell context exposes one; otherwise neutral setup copy and a button to `routes.view.settings('ai')`;
- `Needs attention` only for missing workspace and/or zero available LLM connections;
- seven quick action buttons for `runtime`, `ai`, `permissions`, `marketplace`, `accounts`, `appearance`, and `shortcuts`;
- a recently-opened row list resolved through `getSettingsPage` and its existing icon map. Omit the section when the history is empty.

Use a local `goTo(subpage: SettingsSubpage)` callback that calls `recordRecentSetting(activeWorkspaceId, subpage)` then `navigate(routes.view.settings(subpage))`. Give every action a translated accessible name.

- [x] **Step 4: Route bare Settings to the overview**

In `MainContentPanel`, import `SettingsOverviewPage`. Inside the existing `isSettingsNavigation(navState)` branch, render `<SettingsOverviewPage />` only when `navState.subpage === null`; otherwise retain `getSettingsPageComponent(navState.subpage)` unchanged. Do not keep `?? 'app'` fallback.

- [x] **Step 5: Record direct page route visits**

Add a settings-specific effect in `MainContentPanel` that observes a non-null settings subpage and `activeWorkspaceId`, calls `recordRecentSetting`, and performs no work for any other navigation mode. This records deeplinks and quick-action navigation exactly once per selected page/workspace pair.

- [x] **Step 6: Verify page and locale contracts**

Run:

```bash
bun test packages/shared/src/i18n && bun run --cwd apps/electron typecheck
```

Expected: both commands pass.

### Task 3: Replace flat settings navigation with searchable groups

**Files:**
- Modify: `apps/electron/src/renderer/pages/settings/SettingsNavigator.tsx:10-183`
- Modify: `packages/shared/src/i18n/locales/de.json`
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/es.json`
- Modify: `packages/shared/src/i18n/locales/fr.json`
- Modify: `packages/shared/src/i18n/locales/hu.json`
- Modify: `packages/shared/src/i18n/locales/ja.json`
- Modify: `packages/shared/src/i18n/locales/pl.json`
- Modify: `packages/shared/src/i18n/locales/ru.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hant.json`

**Interfaces:**
- Consumes: `SETTINGS_ITEMS`, `SETTINGS_GROUPS`, `filterSettingsPages`, `groupSettingsPages`, and the existing `SettingsNavigatorProps` callback.
- Produces: grouped settings rows, a controlled local search query, and a translated empty-search state.
- Contract: `SettingsNavigatorProps` remains unchanged and every result still invokes `onSelectSubpage(item.id)`.

- [x] **Step 1: Extend locale copy**

Add the same keys to each locale under `settings.overview` or a sibling `settings.navigator` object, maintaining ASCII order:

```json
{
  "clearSearch": "Clear search",
  "noResults": "No settings areas match \"{{query}}\".",
  "search": "Search settings"
}
```

Translate values naturally in every supported locale and run the parity test.

- [x] **Step 2: Implement grouped filtering in `SettingsNavigator`**

Import `Search`, `X`, `Input`, and Task 1 presentation helpers. Add `query` state. Build translated rows exactly as today, filter through `filterSettingsPages`, then render `groupSettingsPages(filteredRows)`. Each nonempty group gets a small uppercase/label-style translated heading followed by existing `SettingsItemRow` instances. Preserve existing separator behavior within a group and preserve `selectedSubpage` highlighting.

- [x] **Step 3: Add accessible search and empty state**

Place a compact search input above the scrollable groups with `aria-label={t('settings.navigator.search')}` and a visible clear button only when query is nonempty. The clear button resets query and returns focus to the search input. When no rows match, render the translated no-results text with the escaped query interpolation; do not change current route or selection.

- [x] **Step 4: Run focused tests and static checks**

Run:

```bash
bun test apps/electron/src/shared/__tests__/settings-presentation.test.ts apps/electron/src/renderer/lib/__tests__/settings-recent.test.ts && bun test packages/shared/src/i18n && bun run --cwd apps/electron typecheck
```

Expected: all commands pass.

### Task 4: Validate the shipped Electron interaction

**Files:**
- No source changes expected unless this verification exposes a concrete defect.

**Interfaces:**
- Consumes: completed Tasks 1–3 and the existing `bun run electron:dev` process.
- Produces: observed evidence for the settings command-center acceptance criteria.

- [ ] **Step 1: Run lint and production renderer build**

Run:

```bash
bun run --cwd apps/electron lint && bun run --cwd apps/electron build:renderer
```

Expected: both commands pass with no new lint errors.

- [ ] **Step 2: Launch Electron development mode**

Run in the project workspace using the established desktop workflow:

```bash
ELECTRON_ENABLE_LOGGING=1 bun run electron:dev
```

Expected: Vite renderer becomes available and Electron opens a Craft Agents window without CrashFallback.

- [ ] **Step 3: Exercise the visible settings flow**

In Electron: open Settings; confirm Overview appears on the bare route; invoke Runtime, AI, Permissions, Marketplace, Accounts, Appearance, and Shortcuts from quick actions; return to Settings; search by a page title and by a page description; clear search with the clear control; open at least six unique settings pages; relaunch; verify only five recents appear, newest first; switch workspace and verify its recents list is empty until that workspace opens a settings page.

- [ ] **Step 4: Inspect runtime output and regressions**

Confirm the Electron terminal has no `renderer crash boundary`, unhandled TypeError, or i18n missing-key warnings generated by the interaction. If any occurs, fix its source, rerun the focused test suite, typecheck, and repeat the affected manual flow.
