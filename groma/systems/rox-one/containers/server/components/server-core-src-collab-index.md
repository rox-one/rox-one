---
type: C4 Component
title: Index
status: stable
groma:
  id: server-core-src-collab-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/collab/index.ts
    - scanner: typescript
      file: packages/server-core/src/collab/presence-store.ts
    - scanner: typescript
      file: packages/server-core/src/collab/module.ts
      symbol: COLLAB_COMMAND_MODULE
    - scanner: typescript
      file: packages/server-core/src/collab/reference-handlers.ts
description: Binds local collaboration command handlers for presence, suggestions, receipts and free-busy.
---
