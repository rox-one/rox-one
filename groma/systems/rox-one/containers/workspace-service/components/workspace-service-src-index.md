---
type: C4 Component
title: Index
status: stable
groma:
  id: workspace-service-src-index
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/index.ts
    - scanner: typescript
      file: apps/workspace-service/src/http.ts
    - scanner: typescript
      file: apps/workspace-service/src/configuration.ts
    - scanner: typescript
      file: apps/workspace-service/src/routing.ts
    - scanner: typescript
      file: apps/workspace-service/src/server.ts
  technology: Bun
description: Starts the workspace HTTP service and its bootstrap admin commands.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/workspace-service/src/index.ts](../../../../../../apps/workspace-service/src/index.ts) | [postgresql](../../../../../externals/postgresql.md) | Stores workspace data | SQL |
