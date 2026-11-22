---
type: C4 Component
title: Fractional index
status: stable
groma:
  id: fractional-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/canvas-core/src/fractional-index.ts
    - scanner: typescript
      file: packages/canvas-core/src/doc.ts
    - scanner: typescript
      file: packages/canvas-core/src/undo.ts
    - scanner: typescript
      file: packages/canvas-core/src/text.ts
    - scanner: typescript
      file: packages/canvas-core/src/asset-meta.ts
    - scanner: typescript
      file: packages/canvas-core/src/schema.ts
    - scanner: typescript
      file: packages/canvas-core/src/entities.ts
    - scanner: typescript
      file: packages/canvas-core/src/spatial.ts
    - scanner: typescript
      file: packages/canvas-core/src/index.ts
  technology: CRDT
description: Generates lexicographically sortable fractional z-order keys so concurrent canvas reorders never conflict.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/canvas-core/src/entities.ts](../../../../../../packages/canvas-core/src/entities.ts) | [apps/electron/src/renderer/pages/canvas/CanvasSurfacePage.tsx](../../../../../../apps/electron/src/renderer/pages/canvas/CanvasSurfacePage.tsx) | Invokes supplied callback: onError | typescript |
