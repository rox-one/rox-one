---
type: C4 Component
title: Store
status: stable
groma:
  id: agents-store
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/agents/store.ts
    - scanner: typescript
      file: packages/server-core/src/agents/audit-log.ts
    - scanner: typescript
      file: packages/server-core/src/agents/governance-install.ts
    - scanner: typescript
      file: packages/server-core/src/agents/handlers.ts
    - scanner: typescript
      file: packages/server-core/src/agents/module.ts
    - scanner: typescript
      file: packages/server-core/src/agents/runtime.ts
    - scanner: typescript
      file: packages/server-core/src/agents/rate-limit.ts
    - scanner: typescript
      file: packages/server-core/src/agents/index.ts
description: Provides in-memory reference stores for agent governance and identity rows.
---
