---
type: C4 Component
title: Index
status: stable
groma:
  id: server-core-src-drive-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/drive/index.ts
    - scanner: typescript
      file: packages/server-core/src/drive/module.ts
    - scanner: typescript
      file: packages/server-core/src/drive/reference-handlers.ts
      symbol: DRIVE_REFERENCE_SPECS
description: Binds local Drive quota commands and their reference specifications.
---
