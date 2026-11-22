---
type: C4 Component
title: Reader harness fixture
status: stable
groma:
  id: reader-harness-fixture
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/reader-harness.fixture.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/reader-harness.fixture.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/use-feed-reader-tour.ts
      symbol: useFeedReaderTour
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/index.ts
description: Component-harness fixture exercising the feed reader product tour without production imports.
---
