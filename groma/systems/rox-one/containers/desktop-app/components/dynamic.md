---
type: C4 Component
title: Dynamic
status: stable
groma:
  id: dynamic
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/catalogue/dynamic.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/catalogue/validate.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/catalogue/product-tour-catalogue.ts
      symbol: productTourCatalogue
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/catalogue/index.ts
description: Admits generated product tours into the same validated catalogue as static tours.
---
