---
type: C4 Component
title: Audience
status: stable
groma:
  id: audience
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/notify/audience.ts
    - scanner: typescript
      file: packages/core/src/notify/prefs.ts
    - scanner: typescript
      file: packages/core/src/notify/renderers-contract.ts
    - scanner: typescript
      file: packages/core/src/notify/index.ts
    - scanner: typescript
      file: packages/core/src/notify/command-bindings.ts
    - scanner: typescript
      file: packages/core/src/notify/triggers.ts
    - scanner: typescript
      file: packages/core/src/notify/batching.ts
    - scanner: typescript
      file: packages/core/src/notify/types.ts
    - scanner: typescript
      file: packages/core/src/notify/activity.ts
    - scanner: typescript
      file: packages/core/src/notify/review.ts
description: Resolves which principals receive a notification for an event, never notifying the actor themselves.
---
