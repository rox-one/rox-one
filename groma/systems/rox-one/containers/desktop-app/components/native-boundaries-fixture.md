---
type: C4 Component
title: Native boundaries fixture
status: stable
groma:
  id: native-boundaries-fixture
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/native-boundaries.fixture.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/native-browser-process.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/useMeetingArtifactTour.ts
description: Fixtures the native shell context and task bridge for the read-only meetings and automations tour.
---
