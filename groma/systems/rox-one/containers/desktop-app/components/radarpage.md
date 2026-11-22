---
type: C4 Component
title: RadarPage
status: stable
groma:
  id: radarpage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/radar/RadarPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/radar/RadarPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/radar/radar-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/radar/radar-store.ts
description: Renders the daily topic sweep digest with competitor/keyword tracking and task or reply-draft actions.
---
