---
type: C4 Component
title: Index
status: stable
groma:
  id: search-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/search/index.ts
    - scanner: typescript
      file: packages/shared/src/search/fuzzy.ts
description: Barrel re-exporting fuzzy filtering and scoring helpers for command and resource search.
---
