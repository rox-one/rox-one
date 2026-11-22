---
type: C4 Component
title: Hooks
status: stable
groma:
  id: runtime-hooks
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/runtime/hooks.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/hooks.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/collection-view-observation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/routes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/native-layer.ts
      symbol: useTourNativeLayer
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/bridge.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/runtime/dynamic-tours.ts
      symbol: useDynamicTours
description: Provides product-tour runtime context and hooks for registering targets and emitting signals.
---
