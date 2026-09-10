# Settings Command Center — Design

## Goal

Turn the bare `settings` route from a navigator plus an arbitrary fallback page into a focused operating surface. Users must be able to see their active workspace and AI runtime, find a settings area quickly, act on common configuration tasks, and return to recently used pages without altering existing settings routes.

## Scope

- Desktop Electron renderer settings experience only.
- Preserve existing settings page components, routes, deeplinks, identifiers, and IPC contracts.
- Add a first-class overview for bare `settings` navigation.
- Improve settings navigator discoverability and density through semantic groups and local search.
- Surface only status information already available to renderer state; never synthesize health or readiness claims.
- Persist recent settings pages in the existing preferences document, scoped per workspace.

Out of scope:

- New service/provider integrations.
- Changes to runtime, permissions, MCP, API, or cloud-run backend contracts.
- A global settings search spanning controls inside individual pages.
- Replacing individual settings page layouts.

## User Experience

### Navigation groups

The settings registry remains the canonical ordered source of every page. A new presentation map assigns each existing page to one of four stable groups:

- **Agent**: runtime, context, AI, permissions, input.
- **Workspace**: workspace, labels, knowledge, extensions.
- **Integrations**: marketplace, accounts, organizations, messaging, server, cloud runs.
- **Application**: app, appearance, shortcuts.

The navigator renders group headings and keeps the existing label, description, and icon rows. Search filters by translated label and description, hides empty groups, and preserves the registry's order within each group. Empty search results explain that no settings area matches the query; they do not invent a command or modify state.

### Overview

The bare `settings` route renders `SettingsOverviewPage` in the detail panel. It has four sections:

1. **Workspace & runtime** — active workspace name and path, active default LLM connection/model when the existing App Shell context exposes them, plus a direct route to Runtime or AI. Missing values render a neutral “not configured” state and the appropriate existing setup route.
2. **Needs attention** — only actionable facts supplied by existing renderer state, initially: no available LLM connection and no active workspace. The section is absent when no backed status is available.
3. **Quick actions** — explicit buttons to Runtime, AI, Permissions, Marketplace, Accounts, Appearance, and Shortcuts. They are navigation actions, not duplicate configuration forms.
4. **Recently opened** — up to five unique settings page IDs, most-recent-first, labelled through the existing registry. Empty state omits the section.

Overview cards use the existing `Panel`, `SettingsCard`, button, icon, and token patterns. They improve hierarchy without introducing another visual language.

### Selection behavior

- Selecting a page opens it and writes its ID into recent settings for the current workspace.
- Selecting `Settings` from elsewhere opens Overview, not `app` as a silent fallback.
- Opening a direct `settings/<subpage>` deeplink still renders that page and records it as recent.
- In compact mode, the navigator retains its drill-in behavior; Overview appears after navigating to bare settings.

## Architecture

### Registry metadata

Add an internal settings-presentation module adjacent to `settings-registry.ts`. It exposes:

- `SETTINGS_GROUPS`: labels and ordered IDs for visual grouping.
- `getSettingsGroup(id)`: total lookup for a valid settings page.
- `getSettingsPage(id)`: existing registry lookup remains the single source for labels and descriptions.

The new module contains no renderer imports and never duplicates page labels.

### Navigator

`SettingsNavigator` receives no new external contract. Internally it:

- resolves translated rows from `SETTINGS_ITEMS`;
- holds local query state;
- filters and groups rows using presentation metadata;
- calls its existing `onSelectSubpage` callback.

This keeps route ownership in `AppShell` and avoids a second navigation system.

### Main detail panel

`MainContentPanel` replaces the desktop-only fallback `navState.subpage ?? 'app'` with `SettingsOverviewPage` for `null`. It passes no route-derived page ID to the overview. Settings page loading remains through `getSettingsPageComponent` for non-null subpages.

### Recent pages

A small renderer utility stores a bounded `SettingsSubpage[]` in a versioned `settingsRecent.byWorkspace` record inside the existing preferences JSON through `window.electronAPI.readPreferences()` and `writePreferences()`. It validates every stored ID with `isValidSettingsSubpage`, removes malformed/obsolete entries, de-duplicates selected IDs, and caps at five while preserving unrelated preferences.

A route-selection hook at the Settings navigator boundary records selections. Direct deeplinks are recorded by an effect keyed to non-null `navState.subpage` in `MainContentPanel` or its closest settings-specific owner, ensuring all entry paths behave identically.

### Data dependencies

`SettingsOverviewPage` consumes existing App Shell values:

- active workspace and active workspace ID;
- loaded LLM connections and existing default-connection resolution;
- navigation callback supplied from the settings route owner.

It consumes existing renderer state and preferences IPC only. If model-level display data is unavailable from the current connection object, render connection name only.

## Error Handling and Accessibility

- Storage parsing failures fall back to an empty recent list and replace invalid data on the next successful write.
- A missing page icon or unknown registry ID cannot crash the navigator; valid IDs are the only input paths after validation.
- Search has an accessible label, keyboard focus indicator, and clear button.
- Overview actions are semantic buttons or links with translated accessible names.
- Empty and unavailable states explain the next existing action without declaring an error.

## Internationalization

All visible copy uses `t()`. New keys are added to all 10 locale JSON files, ASCII-sorted. Russian plural rules are used only if a count-bearing string needs them; this design does not require new plural copy.

## Test Strategy

- Unit-test presentation grouping: complete coverage of `VALID_SETTINGS_SUBPAGES`, no duplicates, registry order preserved.
- Unit-test recent-page preferences persistence: malformed content recovery, unknown IDs, deduplication, newest-first ordering, unrelated preference preservation, per-workspace isolation, and five-item cap.
- Renderer test for bare settings route: Overview renders instead of App settings fallback.
- Renderer test for navigator search: translated label/description matching, grouped result rendering, empty state.
- Existing i18n parity test covers all new keys.
- Manual Electron verification: open Settings, execute each quick action, search a page, open several pages, relaunch, and verify recents are scoped to the active workspace.

## Acceptance Criteria

- Bare desktop `settings` shows the Overview, never a blank surface or implicit App page.
- Every current settings page remains reachable by its existing route and deeplink.
- Every registry page appears exactly once in grouped navigator rendering.
- Search finds pages by translated title and description without changing navigation until a result is selected.
- Recent pages survive relaunch, cap at five, and do not appear in another workspace.
- All new visible strings have translations in every supported locale.
- Electron smoke verification covers the changed interaction path.
