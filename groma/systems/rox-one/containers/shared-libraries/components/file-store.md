---
type: C4 Component
title: File store
status: stable
groma:
  id: file-store
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/canvas-core/src/node/file-store.ts
    - scanner: typescript
      file: packages/canvas-core/src/node/asset-store.ts
    - scanner: typescript
      file: packages/canvas-core/src/node/index.ts
  technology: Yjs
description: Persists canvas boards as atomic Yjs snapshots plus appended update logs in the workspace.
---
