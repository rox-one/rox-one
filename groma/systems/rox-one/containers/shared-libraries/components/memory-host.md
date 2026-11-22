---
type: C4 Component
title: Memory host
status: stable
groma:
  id: memory-host
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/workbench/memory-host.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/layout.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/index.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/types.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/extra-screen-flags.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/migrate.ts
    - scanner: typescript
      file: packages/core/src/platform/workbench/flags.ts
description: Implements an in-memory workbench layout host with pure reducers for tabs, splits, pinning and restore.
---
