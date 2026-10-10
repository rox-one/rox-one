# 007 — Session view tabs honesty (T8)

Ticket T8 (`docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md:40,102`;
inventory items A2, A3, A15) — «каждая вкладка либо открывает работающий вид,
либо скрыта/честно помечена решением».

**Status:** ACCEPTED — shipped slice. The session strip now shows only views with
a real surface; the placeholder/duplicate paths that fabricated states are gone,
and the one conditional branch that stays is recorded here so the next agent does
not "fix" it. The remaining "real backend" work (team chat, live SiYuan surfaces)
is **not scheduled** by this record.

**Owner:** product (pzd). An agent must not invent team-chat views or re-enable
the retired SiYuan probe from this note.

## Context

Before T8 the session view strip (`EntityViewTabs`) carried three dishonest
paths:

- **A2 — teamchat.** `ChatPage` re-mapped the strip's own capability list to
  force `teamchat.available = false`, duplicating the source in
  `EntityViewTabs.tsx` (where `teamchat` is already `available: false` and has
  no view or backend).
- **A3 — «Скоро» placeholder.** `ChatPage.renderSessionViewBody` ended in
  `return <EntityViewPlaceholder view={sessionView as EntityViewId} />`, an
  unreachable branch whose label defaulted to `entityView.${view}` — keys that
  do not exist in the locale files (`entityView.teamchat`,
  `entityView.mindmap`; the shipped keys are `entityView.teamChat`,
  `entityView.mindmapKnowledge`).
- **A15 — graph/mindmap.** The `graph` and `mindmap` capabilities are
  `available: siyuan`; with the SiYuan probe retired (`useSiyuanConnected`
  always `false`) they never appear. Their render branches are conditional-only
  and stay (see below).
- A dead back-compat wrapper `components/app-shell/SessionViewTabs.tsx` was
  kept "just in case" but had no importers.

## What this slice ships

Desktop-renderer only; no new backend.

- **Single capability source (`ChatPage.tsx`).** The local
  `buildSessionEntityCapabilities` remap is deleted; the page consumes
  `defaultSessionEntityCapabilities({ siyuanConnected })` directly. The strip's
  table is the only place that decides visibility.
- **No unreachable placeholder (`ChatPage.tsx`).** The final fallback return is
  removed (with the now-unused `EntityViewPlaceholder`, `EntityViewCapability`,
  `EntityViewId` imports). An unhandled view id renders nothing rather than a
  fabricated "Coming soon" surface — the capability table only exposes views
  this function renders (`standard | map | graph | mindmap | outline`).
- **Explicit label keys (`EntityViewTabs.tsx`).** New exported
  `ENTITY_VIEW_LABEL_KEYS: Record<EntityViewId, string>` is the single source
  every capability table now reads its `labelKey` from, and
  `EntityViewPlaceholder` resolves its default through the same map instead of
  `entityView.${view}`. The component can no longer fabricate a key.
- **Dead wrapper removed.** `components/app-shell/SessionViewTabs.tsx`
  (`SessionViewTabs`, `SessionViewPlaceholder`, `useSessionView`, `SessionViewId`)
  is deleted — `grep` confirmed no importers outside its own file.
- **Tests.** `components/app-shell/__tests__/entity-view-tabs.test.tsx` adds a
  `labelKey` contract: every capability's `labelKey` equals
  `ENTITY_VIEW_LABEL_KEYS[id]`; the placeholder resolves the real keys for
  `teamchat` → "Team chat" and `mindmap` → "Rox Notes map" (never
  `entityView.teamchat` / `entityView.mindmap`); an explicit capability key wins.

## Conditional-only (do not delete): SiYuan graph/mindmap branches

`ChatPage.renderSessionViewBody` keeps its `sessionView === 'graph'` and
`sessionView === 'mindmap'` branches (both mount `KnowledgeSurfacePage` on
`SIYUAN_FULL_SURFACE_ID`). They are **conditional-only**: reachable solely when a
session capability reports `graph`/`mindmap` available, which today requires
`siyuanConnected === true`. The SiYuan kernel probe is retired
(`hooks/useSiyuanConnected.ts` returns `false` by product decision), so the tabs
are hidden and the branches are currently unreachable — but they are a
**product decision, not dead code** (unknoting item (4)): when the SiYuan surface
returns, the capability table flips `available` and the branches light up with no
further change. Do not delete them without a product decision to drop SiYuan
session views.

## What would flip this

- A ticket that lands a real team-chat view (surface + backend): flip
  `teamchat.available` in `defaultSessionEntityCapabilities` and add its body
  branch — the strip then shows it honestly.
- A product decision to retire SiYuan session views: drop the two conditional
  branches together with the `graph`/`mindmap` capabilities in the same change.
- A product decision to re-enable the SiYuan probe: `useSiyuanConnected` returns
  the real state and the branches become reachable again (no strip change needed).

## Evidence

- Ticket: `docs/plans/2026-10-10-main-guardrails-and-ui-to-code.md:40,102,170-171,183`
  (T8; inventory A2/A3/A15).
- Strip + label map + placeholder: `apps/electron/src/renderer/components/app-shell/EntityViewTabs.tsx`
  (`ENTITY_VIEW_LABEL_KEYS`, `defaultSessionEntityCapabilities`,
  `EntityViewPlaceholder`).
- Session page consumption: `apps/electron/src/renderer/pages/ChatPage.tsx`
  (`sessionEntityCapabilities`, `renderSessionViewBody`; no placeholder import).
- Probe: `apps/electron/src/renderer/hooks/useSiyuanConnected.ts` (returns
  `false`).
- Removed wrapper: `apps/electron/src/renderer/components/app-shell/SessionViewTabs.tsx`
  (deleted; no importers).
- Tests: `apps/electron/src/renderer/components/app-shell/__tests__/entity-view-tabs.test.tsx`.