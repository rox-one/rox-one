---
type: C4 Component
title: Native continuity browser
status: stable
groma:
  id: native-continuity-browser
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/core/native-continuity.browser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/core/native-continuity.browser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/core/initial-state.ts
      symbol: initialRuntimeState
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/core/index.ts
description: Browser test fixture wiring production renderer adapters for the product-tour native continuity flow.
---
