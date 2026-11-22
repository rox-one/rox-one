---
type: C4 Component
title: TeamActivityFeed
status: stable
groma:
  id: teamactivityfeed
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/team/TeamActivityFeed.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/TeamActivityFeed.tsx
      symbol: TeamActivityFeed
    - scanner: react
      file: apps/electron/src/renderer/components/team/TeamOrgSettingsSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/TeamOrgSettingsSection.tsx
      symbol: TeamOrgSettingsSection
    - scanner: react
      file: apps/electron/src/renderer/components/team/TeamInboxSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/TeamInboxSection.tsx
      symbol: TeamInboxSection
    - scanner: react
      file: apps/electron/src/renderer/components/team/TeamInboxNavItem.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/TeamInboxNavItem.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/team/TeamSessionButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/TeamSessionButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/use-team-roster.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/team-store.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/team/team-labels.ts
description: Streams local team activity events with actor names and sync status in the Лента surface.
---
