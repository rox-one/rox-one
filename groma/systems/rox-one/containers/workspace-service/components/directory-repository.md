---
type: C4 Component
title: Repository
status: stable
groma:
  id: directory-repository
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/directory/repository.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/directory/queries.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/directory/routes.ts
      symbol: createDirectoryRoutes
    - scanner: typescript
      file: apps/workspace-service/src/modules/directory/service.ts
      symbol: DirectoryService
description: Reads workspace member, department and manager-chain directory data from Postgres.
---
