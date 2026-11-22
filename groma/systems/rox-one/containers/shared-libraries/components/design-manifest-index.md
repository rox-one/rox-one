---
type: C4 Component
title: Index
status: stable
groma:
  id: design-manifest-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/design-manifest/index.ts
    - scanner: typescript
      file: packages/shared/src/design-manifest/compiler.ts
    - scanner: typescript
      file: packages/shared/src/design-manifest/schema.ts
description: Barrel re-exporting the design-manifest compiler, validation error and manifest/grid zod schemas.
---
