---
type: C4 Component
title: Index
status: stable
groma:
  id: modules-im-index
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/index.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/feed.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/repository.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/relay-client.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/im/service.ts
description: Bridges workspace-service IM channels to the external relay service.
---
