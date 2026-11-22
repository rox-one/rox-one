---
type: C4 Component
title: Index
status: stable
groma:
  id: mirror-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/drive/mirror/index.ts
    - scanner: typescript
      file: packages/shared/src/drive/mirror/types.ts
    - scanner: typescript
      file: packages/shared/src/drive/mirror/journal.ts
    - scanner: typescript
      file: packages/shared/src/drive/mirror/catalog.ts
    - scanner: typescript
      file: packages/shared/src/drive/mirror/queue.ts
      symbol: createMirrorQueue
    - scanner: typescript
      file: packages/shared/src/drive/mirror/plan.ts
      symbol: planMirrorDiff
description: 'Exports the ROX Drive app-config mirror engine surface: catalog scan, diff planning, journal and upload queue.'
---
