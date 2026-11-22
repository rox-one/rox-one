---
type: C4 Component
title: BrowserPreview
status: stable
groma:
  id: browserpreview
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/browser-preview/BrowserPreview.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/browser-preview/BrowserPreview.tsx
      symbol: renderBrowserPreview
  technology: React Flow
description: Browser-only canvas preview of runtime-map node types for visual development.
---
