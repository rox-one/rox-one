---
type: C4 Component
title: Index
status: stable
groma:
  id: research-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/research/index.ts
    - scanner: typescript
      file: packages/core/src/research/rank.ts
    - scanner: typescript
      file: packages/core/src/research/types.ts
    - scanner: typescript
      file: packages/core/src/research/cache-policy.ts
    - scanner: typescript
      file: packages/core/src/research/planner.ts
    - scanner: typescript
      file: packages/core/src/research/citations.ts
    - scanner: typescript
      file: packages/core/src/research/execute.ts
description: Re-exports bounded research planning, source ranking, caching, citation extraction and execution helpers.
---
