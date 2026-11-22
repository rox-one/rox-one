---
type: C4 Component
title: Validate
status: stable
groma:
  id: tasks-validate
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/tasks/validate.ts
    - scanner: typescript
      file: packages/shared/src/tasks/refs.ts
    - scanner: typescript
      file: packages/shared/src/tasks/generator-prompt.ts
    - scanner: typescript
      file: packages/shared/src/tasks/storage.ts
    - scanner: typescript
      file: packages/shared/src/tasks/index.ts
    - scanner: typescript
      file: packages/shared/src/tasks/slug.ts
    - scanner: typescript
      file: packages/shared/src/tasks/schema.ts
description: Validates task.yaml graphs for cycles, dangling dependencies, unresolved references, unknown models and size caps.
---
