---
type: C4 Component
title: Index
status: stable
groma:
  id: browser-intel-src-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/index.ts
    - scanner: typescript
      file: packages/browser-intel/src/url.ts
    - scanner: typescript
      file: packages/browser-intel/src/types.ts
    - scanner: typescript
      file: packages/browser-intel/src/paths.ts
    - scanner: typescript
      file: packages/browser-intel/src/state.ts
    - scanner: typescript
      file: packages/browser-intel/src/pipeline.ts
description: 'Exports the browser intelligence pipeline: URL helpers, state, paths, database, acquisition, hindsight, insights and unfurl workers.'
---
