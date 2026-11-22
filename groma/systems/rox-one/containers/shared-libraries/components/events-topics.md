---
type: C4 Component
title: Topics
status: stable
groma:
  id: events-topics
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/events/topics.ts
    - scanner: typescript
      file: packages/core/src/events/projection.ts
    - scanner: typescript
      file: packages/core/src/events/index.ts
    - scanner: typescript
      file: packages/core/src/events/sequence.ts
    - scanner: typescript
      file: packages/core/src/events/types.ts
description: Defines realtime topic grammar, parsing and formatting for ACL-checked per-topic event subscriptions.
---
