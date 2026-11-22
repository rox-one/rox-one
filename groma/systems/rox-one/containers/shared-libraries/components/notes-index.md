---
type: C4 Component
title: Index
status: stable
groma:
  id: notes-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/conation/notes/index.ts
    - scanner: typescript
      file: packages/core/src/conation/notes/types.ts
    - scanner: typescript
      file: packages/core/src/conation/notes/bridge.ts
      symbol: createNotesBridge
    - scanner: typescript
      file: packages/core/src/conation/notes/flags.ts
description: Exports the Conation notes bridge flags, factory and types for the notes panel.
---
