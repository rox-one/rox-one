---
type: C4 Component
title: Lock
status: stable
groma:
  id: lock
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/marketplace/lock.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/trust.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/index.ts
      symbol: MarketplaceCatalogResult
    - scanner: typescript
      file: packages/shared/src/marketplace/filters.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/installer.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/stats.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/catalog-signing.ts
    - scanner: typescript
      file: packages/shared/src/marketplace/catalog.ts
description: Records marketplace installs and per-artifact provenance markers so removal can prove ownership and detect local edits.
---
