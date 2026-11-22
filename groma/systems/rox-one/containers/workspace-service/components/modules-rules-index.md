---
type: C4 Component
title: Index
status: stable
groma:
  id: modules-rules-index
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/rules/index.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/rules/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/rules/store.ts
      symbol: PostgresRulesStore
    - scanner: typescript
      file: apps/workspace-service/src/modules/rules/runtime.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/rules/host.ts
description: Wires the workspace automation-rules store, runtime and HTTP API.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/workspace-service/src/modules/rules/routes.ts](../../../../../../apps/workspace-service/src/modules/rules/routes.ts) | [packages/shared/src/workspace-domain/identity/contracts.ts](../../../../../../packages/shared/src/workspace-domain/identity/contracts.ts) | Shares domain contracts | TypeScript imports |
| [apps/workspace-service/src/modules/rules/routes.ts](../../../../../../apps/workspace-service/src/modules/rules/routes.ts) | [packages/server-core/src/rules/settings.ts](../../../../../../packages/server-core/src/rules/settings.ts) | Reuses rule settings | TypeScript imports |
