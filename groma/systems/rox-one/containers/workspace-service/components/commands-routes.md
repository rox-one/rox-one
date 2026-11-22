---
type: C4 Component
title: Routes
status: stable
groma:
  id: commands-routes
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/commands/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/commands/store.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/commands/runtime.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/commands/authorizer.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/commands/service.ts
description: Exposes the workspace command-bus HTTP endpoint with authentication and receipt semantics.
---
