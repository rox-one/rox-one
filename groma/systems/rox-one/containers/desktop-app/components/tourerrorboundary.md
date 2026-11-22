---
type: C4 Component
title: TourErrorBoundary
status: stable
groma:
  id: tourerrorboundary
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/ui/TourErrorBoundary.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/TourErrorBoundary.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/ui/TourPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/TourPopover.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/ui/presentation.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/presentation.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/ui/TourVignette.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/TourVignette.tsx
      symbol: TourVignette
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/geometry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/geometry-observer.ts
      symbol: observeTargetGeometry
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/ui/target-registry.ts
description: Contains product-tour render failures so a broken tour never takes down the workspace.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx](../../../../../../apps/electron/src/renderer/features/product-tour/ui/SpotlightOverlay.tsx) | [apps/electron/src/renderer/features/product-tour/adapters/connections/source-picker.browser.tsx](../../../../../../apps/electron/src/renderer/features/product-tour/adapters/connections/source-picker.browser.tsx) | Invokes supplied callback: onPause | react |
| [apps/electron/src/renderer/features/product-tour/ui/target-registry.ts](../../../../../../apps/electron/src/renderer/features/product-tour/ui/target-registry.ts) | [apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx](../../../../../../apps/electron/src/renderer/features/product-tour/runtime/ProductTourProvider.tsx) | Invokes supplied callback: getTargetScope | typescript |
