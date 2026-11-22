---
type: C4 Component
title: RuntimeInspector
status: stable
groma:
  id: runtimeinspector
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/inspector/RuntimeInspector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/inspector/RuntimeInspector.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/runtime-map/inspector/ContentViewer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/runtime-map/inspector/ContentViewer.tsx
description: Renders the runtime-trace inspector panel with event properties, payload viewers and deep links.
---
