---
type: C4 Component
title: Source picker browser
status: stable
groma:
  id: source-picker-browser
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/adapters/connections/source-picker.browser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/connections/source-picker.browser.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/product-tour/adapters/connections/native-handoff.browser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/connections/native-handoff.browser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/connections/index.ts
description: Browser test harness for the source picker and its product-tour spotlight overlay.
---
