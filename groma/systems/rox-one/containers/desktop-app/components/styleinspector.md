---
type: C4 Component
title: StyleInspector
status: stable
groma:
  id: styleinspector
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/canvas/StyleInspector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/StyleInspector.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/canvas/CanvasSurfacePage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/CanvasSurfacePage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/geometry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/image-frame.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/ink-path.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/style-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/marquee-snap.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/entity-wiring.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/canvas-target.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/canvas/live-text.ts
description: Edits fill, stroke, typography, opacity and corner radius for the selected canvas objects.
---
