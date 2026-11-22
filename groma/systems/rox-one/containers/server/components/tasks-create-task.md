---
type: C4 Component
title: Create task
status: stable
groma:
  id: tasks-create-task
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/tasks/create-task.ts
    - scanner: typescript
      file: packages/server-core/src/tasks/index.ts
    - scanner: typescript
      file: packages/server-core/src/tasks/personal-persist.ts
    - scanner: typescript
      file: packages/server-core/src/tasks/work-item-link-migration.ts
    - scanner: typescript
      file: packages/server-core/src/tasks/personal-tasks-service.ts
    - scanner: typescript
      file: packages/server-core/src/tasks/TaskRunner.ts
description: Creates a task board entry, orchestrator session and labels without starting a run.
---
