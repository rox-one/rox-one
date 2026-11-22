---
type: C4 Component
title: Index
status: stable
groma:
  id: shared-src-xfn-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/xfn/index.ts
      symbol: XFN_QUERIES
    - scanner: typescript
      file: packages/shared/src/xfn/schemas.ts
description: Barrel re-exporting zod schemas for the cross-functional capability commands and queries.
---
