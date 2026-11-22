---
type: C4 Component
title: Data write
status: stable
groma:
  id: data-write
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/pages/data-write.ts
    - scanner: typescript
      file: packages/shared/src/pages/share-bundle.ts
    - scanner: typescript
      file: packages/shared/src/pages/data-store.ts
    - scanner: typescript
      file: packages/shared/src/pages/action-bridge.ts
    - scanner: typescript
      file: packages/shared/src/pages/data-store-constants.ts
    - scanner: typescript
      file: packages/shared/src/pages/publisher.ts
    - scanner: typescript
      file: packages/shared/src/pages/index.ts
    - scanner: typescript
      file: packages/shared/src/pages/demo-page.ts
    - scanner: typescript
      file: packages/shared/src/pages/refresh.ts
    - scanner: typescript
      file: packages/shared/src/pages/types.ts
    - scanner: typescript
      file: packages/shared/src/pages/storage.ts
    - scanner: typescript
      file: packages/shared/src/pages/validation.ts
  technology: Bun, SQLite
description: Applies page data patches to a page's SQLite store by spawning a self-contained one-shot, then refreshes the snapshot.
---
