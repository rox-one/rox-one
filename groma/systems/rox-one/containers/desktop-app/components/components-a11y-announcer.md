---
type: C4 Component
title: Announcer
status: stable
groma:
  id: components-a11y-announcer
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/a11y/Announcer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/a11y/Announcer.tsx
      symbol: Announcer
description: Mounts persistent screen-reader live regions that speak shell-level announcements.
---
