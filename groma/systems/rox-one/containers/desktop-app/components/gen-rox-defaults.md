---
type: C4 Component
title: Gen rox defaults
status: stable
groma:
  id: gen-rox-defaults
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/scripts/gen-rox-defaults.ts
    - scanner: typescript
      file: apps/electron/scripts/gen-shared-keys.ts
    - scanner: javascript
      file: apps/electron/scripts/afterPack.cjs
      symbol: hasCurrentAssetProvenance
    - scanner: typescript
      file: apps/electron/scripts/gen-call-defaults.ts
    - scanner: typescript
      file: apps/electron/scripts/copy-assets.ts
description: Build script baking the shared ROX gateway API key into a generated main-process module.
---
