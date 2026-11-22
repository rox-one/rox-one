---
type: C4 Component
title: ActivityHeatmap
status: stable
groma:
  id: activityheatmap
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/activity/ActivityHeatmap.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/activity/ActivityHeatmap.tsx
      symbol: ActivityHeatmap
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/activity/ActivityPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/activity/ActivityPage.tsx
      symbol: ActivityPage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/activity/activity-model.ts
description: Displays a compact year heatmap of session activity with keyboard day navigation for the Activity screen.
---
