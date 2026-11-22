---
type: C4 Component
title: Metrics
status: stable
groma:
  id: analytics-metrics
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/analytics/metrics.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/analytics/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/analytics/events.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/analytics/diagnostics.ts
description: Computes product-tour learning metrics from functional tour progress records.
---
