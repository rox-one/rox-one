---
type: C4 Component
title: RuntimeMapDock
status: stable
groma:
  id: runtimemapdock
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/RuntimeMapDock.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/RuntimeMapDock.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/ChatRuntimeSplit.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/ChatRuntimeSplit.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/AgentLane.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/AgentLane.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/RuntimeCanvas.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/RuntimeCanvas.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/RuntimeContextCanvas.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/RuntimeContextCanvas.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/RuntimeReplayControls.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/RuntimeReplayControls.tsx
      symbol: RuntimeReplayControls
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/RuntimeToolbar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/RuntimeToolbar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/public-metadata.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/launch-details.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/measurements.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/learning-nodes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/coverage-text.ts
      symbol: coverageMissingText
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/useLearningOverlay.ts
      symbol: useLearningOverlay
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/learning-overlay.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/context-groups.ts
description: Renders the runtime trace map of agent runs, tools and learning chains with replay and inspector.
---
