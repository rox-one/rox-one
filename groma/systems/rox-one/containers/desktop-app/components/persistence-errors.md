---
type: C4 Component
title: Errors
status: stable
groma:
  id: persistence-errors
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/errors.ts
      symbol: LearningLeaseLostError
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/progress.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/lease.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/database.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/profile.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/browser-test-harness.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/browser-test-entry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/persistence/scope-key.ts
      symbol: createLearningScopeKey
description: Defines the error raised when a product-tour learning lease is lost.
---
