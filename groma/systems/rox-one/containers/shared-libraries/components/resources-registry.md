---
type: C4 Component
title: Registry
status: stable
groma:
  id: resources-registry
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/resources/registry.ts
      symbol: createResourceProviderRegistry
    - scanner: typescript
      file: packages/core/src/platform/resources/types.ts
    - scanner: typescript
      file: packages/core/src/platform/resources/index.ts
description: Fans out resource searches across prefix-eligible providers and merges results by score.
---
