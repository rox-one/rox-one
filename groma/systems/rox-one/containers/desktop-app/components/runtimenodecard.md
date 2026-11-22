---
type: C4 Component
title: RuntimeNodeCard
status: stable
groma:
  id: runtimenodecard
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/nodes/RuntimeNodeCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/nodes/RuntimeNodeCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/nodes/LearningNodeCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/nodes/LearningNodeCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/nodes/node-content.ts
  technology: React Flow
description: Renders one runtime-trace event as a node card with kind icon, status, duration and tokens.
---
