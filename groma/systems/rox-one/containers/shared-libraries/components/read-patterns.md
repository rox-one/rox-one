---
type: C4 Component
title: Read patterns
status: stable
groma:
  id: read-patterns
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/backend/read-patterns.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/omp-session-policy.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/base-event-adapter.ts
      symbol: BaseEventAdapter
    - scanner: typescript
      file: packages/shared/src/agent/backend/types.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/event-queue.ts
      symbol: EventQueue
    - scanner: typescript
      file: packages/shared/src/agent/backend/factory.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/index.ts
description: Detects file-reading shell commands (cat, head, tail, sed) so adapters can emit them as Read tool events.
---
