---
type: C4 Component
title: Types
status: stable
groma:
  id: personal-types
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/tasks/personal/types.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/cache.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/store.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/rpc.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/index.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/dates.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/import-validation.ts
      symbol: personalTaskBundleRowsAreValid
    - scanner: typescript
      file: packages/core/src/tasks/personal/projections.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/quick-entry.ts
    - scanner: typescript
      file: packages/core/src/tasks/personal/work-item.ts
description: 'Defines the Things-style personal task model: lists, projects, priorities, recurrence, links and checklist items.'
---
