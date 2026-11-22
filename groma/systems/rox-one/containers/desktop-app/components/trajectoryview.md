---
type: C4 Component
title: TrajectoryView
status: stable
groma:
  id: trajectoryview
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/trajectory/TrajectoryView.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/trajectory/TrajectoryView.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/trajectory/trajectory-model.ts
description: Renders the trajectory tab with timing lanes, virtualized event ledger and record inspector.
---
