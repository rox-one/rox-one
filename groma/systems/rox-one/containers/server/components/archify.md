---
type: C4 Component
title: Archify
status: stable
groma:
  id: archify
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/archify.ts
      symbol: archifyAdapterSpec
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/groma.ts
      symbol: gromaAdapterSpec
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/openwiki.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/codegraph.ts
      symbol: codegraphAdapterSpec
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/contract.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/understand-anything.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/adapters/graphify.ts
      symbol: graphifyAdapterSpec
  technology: archify
description: Declares the archify CLI adapter that renders typed diagram IR into SVG artifacts.
---
