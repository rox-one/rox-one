---
type: C4 Component
title: Tasks
status: stable
groma:
  id: specs-tasks
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/tasks.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/messenger.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/index.ts
      symbol: REFERENCE_SPECS
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/types.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/goals.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/workspace.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/specs/docs.ts
description: Defines reference operations that create, update and link tasks, lists and statuses.
---
