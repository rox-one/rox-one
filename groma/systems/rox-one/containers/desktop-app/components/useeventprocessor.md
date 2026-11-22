---
type: C4 Component
title: UseEventProcessor
status: stable
groma:
  id: useeventprocessor
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/useEventProcessor.ts
      symbol: useEventProcessor
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/helpers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/processor.ts
      symbol: processEvent
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/stream-delta-coalescer.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/runtime-trace-ingress.ts
description: Processes incoming agent events into per-session streaming state and side effects.
---
