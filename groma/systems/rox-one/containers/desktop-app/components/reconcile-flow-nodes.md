---
type: C4 Component
title: Reconcile flow nodes
status: stable
groma:
  id: reconcile-flow-nodes
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/layout/reconcile-flow-nodes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/layout/initial-geometry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/layout/stable-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/layout/viewport-policy.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/layout/learning-flow.ts
  technology: React Flow
description: Reuses unchanged React Flow nodes so the runtime canvas only re-renders what actually changed.
---
