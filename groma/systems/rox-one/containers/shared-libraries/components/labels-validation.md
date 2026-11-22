---
type: C4 Component
title: Validation
status: stable
groma:
  id: labels-validation
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/labels/validation.ts
      symbol: validateSessionLabels
    - scanner: typescript
      file: packages/shared/src/labels/crud.ts
    - scanner: typescript
      file: packages/shared/src/labels/resolve.ts
    - scanner: typescript
      file: packages/shared/src/labels/index.ts
    - scanner: typescript
      file: packages/shared/src/labels/filter.ts
    - scanner: typescript
      file: packages/shared/src/labels/types.ts
    - scanner: typescript
      file: packages/shared/src/labels/values.ts
    - scanner: typescript
      file: packages/shared/src/labels/tree.ts
    - scanner: typescript
      file: packages/shared/src/labels/storage.ts
description: Filters a session's label entries down to IDs that still exist in the workspace label tree.
---
