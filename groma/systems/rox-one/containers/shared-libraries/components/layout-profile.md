---
type: C4 Component
title: Layout profile
status: stable
groma:
  id: layout-profile
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/panels/layout-profile.ts
    - scanner: typescript
      file: packages/core/src/platform/panels/ordering.ts
    - scanner: typescript
      file: packages/core/src/platform/panels/index.ts
    - scanner: typescript
      file: packages/core/src/platform/panels/types.ts
    - scanner: typescript
      file: packages/core/src/platform/panels/registry.ts
      symbol: createPanelRegistry
description: Defines layout profiles and per-workspace panel registry state with delta-only overrides.
---
