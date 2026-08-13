# Workbench Home Front Page Implementation Plan

> **For agentic workers:** Execute inline. Steps use checkbox syntax.

**Goal:** Live Home mode that opens existing sessions and knowledge through the current shell.

**Architecture:** Add navigator `home` like `memory`. HomeFrontPage reads SessionMeta; navigation stays URL / panel-stack.

**Tech Stack:** Bun, TypeScript, React, Jotai, react-i18next.

## Global Constraints

- Flags default OFF. Home is reachable from Mode Bar when mode-registry or top-chrome is on.
- All user-facing strings via `t()`; 10 locales; ASCII-sorted keys.
- No WorkGraph / Meetings / Feed / Mail.

---

### Task 1: Route + model

- Add `HomeNavigationState`, `isHomeNavigation`, route `home`, parser round-trip.
- `pickRecentHomeSessions` + tests.
- Seed Home as navigable.

### Task 2: UI + wiring

- `HomeFrontPage`, MainContentPanel, AppShell navigator width 0, tab label.

### Task 3: i18n + verify

- Keys in all 10 locales. Tests + electron tsc.
