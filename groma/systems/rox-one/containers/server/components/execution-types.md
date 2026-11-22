---
type: C4 Component
title: Types
status: stable
groma:
  id: execution-types
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/execution/types.ts
    - scanner: typescript
      file: packages/server-core/src/execution/index.ts
    - scanner: typescript
      file: packages/server-core/src/execution/coordinator.ts
      symbol: ExecutionCoordinator
description: Declares the small execution-host, run and pause result types.
---
