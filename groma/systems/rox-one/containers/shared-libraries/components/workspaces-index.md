---
type: C4 Component
title: Index
status: stable
groma:
  id: workspaces-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/workspaces/index.ts
    - scanner: typescript
      file: packages/shared/src/workspaces/rox-layout.ts
    - scanner: typescript
      file: packages/shared/src/workspaces/types.ts
    - scanner: typescript
      file: packages/shared/src/workspaces/storage.ts
description: Barrel re-exporting workspace config types, storage operations and ROX folder-layout helpers.
---
