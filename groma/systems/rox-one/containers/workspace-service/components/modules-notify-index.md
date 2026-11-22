---
type: C4 Component
title: Index
status: stable
groma:
  id: modules-notify-index
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/index.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/audience-adapter.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/fanout.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/email-worker.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/store.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/notify/service.ts
description: Composes workspace notification fan-out, preferences storage and email batching.
---
