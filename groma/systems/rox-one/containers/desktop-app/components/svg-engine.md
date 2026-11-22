---
type: C4 Component
title: Svg engine
status: stable
groma:
  id: svg-engine
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/mindmap/engine/svg-engine.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/mindmap/engine/svg-engine.tsx
    - scanner: react
      file: apps/electron/src/renderer/mindmap/engine/minimap.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/mindmap/engine/minimap.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/mindmap/engine/types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/mindmap/engine/fit.ts
  technology: SVG
description: Renders the interactive mind-map canvas with pan/zoom, node collapse, editing and a minimap.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/mindmap/engine/svg-engine.tsx](../../../../../../apps/electron/src/renderer/mindmap/engine/svg-engine.tsx) | [apps/electron/src/renderer/mindmap/MindMapHost.tsx](../../../../../../apps/electron/src/renderer/mindmap/MindMapHost.tsx) | Invokes supplied callbacks: onGraphChange, onSelect, onToggleCollapse | react |
