---
type: C4 Component
title: Thinking
status: stable
groma:
  id: thinking
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/handlers/thinking.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/handlers/text.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/handlers/tool.ts
    - scanner: typescript
      file: apps/electron/src/renderer/event-processor/handlers/session.ts
description: Accumulates streaming reasoning deltas into runtime-only thinking messages in renderer session state.
---
