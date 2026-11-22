---
type: C4 Component
title: Routes
status: stable
groma:
  id: licenses-routes
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/licenses/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/licenses/registry.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/licenses/repository.ts
      symbol: LicenseRepository
    - scanner: typescript
      file: apps/workspace-service/src/modules/licenses/commands.ts
description: Routes license audit commands and license component queries.
---
