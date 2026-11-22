---
type: C4 Component
title: Index
status: stable
groma:
  id: platform-commands-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/commands/index.ts
    - scanner: typescript
      file: packages/core/src/platform/commands/types.ts
    - scanner: typescript
      file: packages/core/src/platform/commands/registry.ts
      symbol: createCommandRegistry
description: Barrel re-exporting the host-side command registry contract and factory.
---
