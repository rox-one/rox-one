---
type: C4 Component
title: Validation
status: stable
groma:
  id: views-validation
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/views/validation.ts
    - scanner: typescript
      file: packages/shared/src/views/evaluator.ts
    - scanner: typescript
      file: packages/shared/src/views/slice-views.ts
    - scanner: typescript
      file: packages/shared/src/views/defaults.ts
    - scanner: typescript
      file: packages/shared/src/views/functions.ts
      symbol: VIEW_FUNCTIONS
    - scanner: typescript
      file: packages/shared/src/views/storage.ts
    - scanner: typescript
      file: packages/shared/src/views/types.ts
    - scanner: typescript
      file: packages/shared/src/views/index.ts
  technology: filtrex
description: Validates view filter expressions with filtrex and documents available session fields for error hints.
---
