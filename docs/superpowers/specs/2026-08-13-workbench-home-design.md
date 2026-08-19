# Workbench Home Front Page

**Date:** 2026-08-13
**Depends on:** [Workbench Shell v2](./2026-08-13-workbench-shell-v2-design.md), ADR-0001

## Goal

Make Mode Bar **Home** a live mode. The page composes existing objects
(recent sessions, knowledge, new session, omnibox) through the current
URL / panel-stack shell. No WorkGraph, Meetings, Feed, Mail, or CRDT.

## Design

- New navigator `{ navigator: 'home' }` with route `home` (same shape as `memory`).
- `CORE_MODES.home.rootRoute = routes.view.home()`; `isActive = isHomeNavigation`.
- Home pins next to Chat and Knowledge. Other modes stay overflow/unavailable.
- `HomeFrontPage` in `MainContentPanel`. Navigator column width is 0 (dashboard).
- Recent sessions: not hidden, not archived, sorted by `lastMessageAt` then `createdAt`, cap 8.
- Clicks use existing routes: `allSessions(id)`, `knowledge()`, `newSession()`, omnibox atom.
- Home is a legacy surface tab (no new `SurfaceTab` kind). Tab label `surfaceTabs.home`.
- No new feature flag. The Mode Bar already gates the destination; the route works if opened directly.

## Out of scope

WorkGraph kernel, WorkItems, Meetings, Feed, Mail, presence, layout profiles,
open-in-current-group NavigationContext hook.
