---
type: C4 Component
title: Surface capabilities
status: stable
groma:
  id: surface-capabilities
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/bases/surface-capabilities.ts
      symbol: getTableCapabilityAvailability
    - scanner: typescript
      file: packages/core/src/bases/surface-types.ts
    - scanner: typescript
      file: packages/core/src/bases/index.ts
    - scanner: typescript
      file: packages/core/src/bases/table-surface.ts
description: Computes table-surface capability availability metadata from surface and evidence, explicitly not authorization.
---
