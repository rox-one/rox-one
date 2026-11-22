---
type: C4 Component
title: Validate
status: stable
groma:
  id: workflows-validate
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/workflows/validate.ts
    - scanner: typescript
      file: packages/shared/src/workflows/run.ts
    - scanner: typescript
      file: packages/shared/src/workflows/version.ts
    - scanner: typescript
      file: packages/shared/src/workflows/magic-words.ts
    - scanner: typescript
      file: packages/shared/src/workflows/graph.ts
    - scanner: typescript
      file: packages/shared/src/workflows/index.ts
    - scanner: typescript
      file: packages/shared/src/workflows/promote.ts
    - scanner: typescript
      file: packages/shared/src/workflows/types.ts
description: 'Validates workflow canvas specs: permission modes, edge ports, cycles and provenance before execution.'
---
