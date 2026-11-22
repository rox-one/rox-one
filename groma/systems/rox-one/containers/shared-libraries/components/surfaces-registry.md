---
type: C4 Component
title: Registry
status: stable
groma:
  id: surfaces-registry
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/surfaces/registry.ts
      symbol: createSurfaceRegistry
    - scanner: typescript
      file: packages/core/src/platform/surfaces/types.ts
    - scanner: typescript
      file: packages/core/src/platform/surfaces/index.ts
    - scanner: typescript
      file: packages/core/src/platform/surfaces/host.ts
      symbol: WorkspaceSurfaceHost
    - scanner: typescript
      file: packages/core/src/platform/surfaces/descriptor.ts
description: Registers one contribution per surface-tab kind and resolves the matching surface for navigation state.
---
