---
type: C4 Component
title: CloudRunsChip
status: stable
groma:
  id: cloudrunschip
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/cloud-runs/CloudRunsChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/cloud-runs/CloudRunsChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/cloud-runs/cloud-runs-chip-loader.ts
      symbol: loadCloudRunsChip
description: Provides the cloud runs entry point, list dialog and controls for queued and running jobs.
---
