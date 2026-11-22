---
type: C4 Component
title: Crud
status: stable
groma:
  id: statuses-crud
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/statuses/crud.ts
    - scanner: typescript
      file: packages/shared/src/statuses/index.ts
    - scanner: typescript
      file: packages/shared/src/statuses/storage.ts
    - scanner: typescript
      file: packages/shared/src/statuses/default-icons.ts
    - scanner: typescript
      file: packages/shared/src/statuses/types.ts
    - scanner: typescript
      file: packages/shared/src/statuses/validation.ts
description: Creates, updates and deletes workspace status configurations while enforcing fixed, default and uniqueness rules.
---
