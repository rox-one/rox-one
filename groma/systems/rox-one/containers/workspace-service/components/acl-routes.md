---
type: C4 Component
title: Routes
status: stable
groma:
  id: acl-routes
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/acl/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/acl/queries.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/acl/repository.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/acl/service.ts
description: Defines workspace ACL check and listing HTTP routes.
---
