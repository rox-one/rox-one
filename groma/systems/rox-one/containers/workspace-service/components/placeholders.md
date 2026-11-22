---
type: C4 Component
title: Placeholders
status: stable
groma:
  id: placeholders
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/identity/placeholders.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/identity/commands.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/identity/observability.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/identity/repository.ts
      symbol: IdentityRepository
    - scanner: typescript
      file: apps/workspace-service/src/modules/identity/routes.ts
  technology: PostgreSQL
description: Provides SQL statements for placeholder principals, invitations and activation.
---
