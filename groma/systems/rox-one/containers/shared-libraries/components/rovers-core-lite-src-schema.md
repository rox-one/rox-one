---
type: C4 Component
title: Schema
status: stable
groma:
  id: rovers-core-lite-src-schema
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/rovers-core-lite/src/schema.ts
    - scanner: typescript
      file: packages/rovers-core-lite/src/loader.ts
    - scanner: typescript
      file: packages/rovers-core-lite/src/types.ts
    - scanner: typescript
      file: packages/rovers-core-lite/src/index.ts
    - scanner: typescript
      file: packages/rovers-core-lite/src/query.ts
  technology: zod
description: Validates the Rovers catalog v1 with zod, failing closed on any structural violation.
---
