---
type: C4 Component
title: Commands
status: stable
groma:
  id: collab-commands
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/collab/commands.ts
    - scanner: typescript
      file: packages/core/src/collab/awareness.ts
    - scanner: typescript
      file: packages/core/src/collab/calendar.ts
    - scanner: typescript
      file: packages/core/src/collab/suggestions.ts
    - scanner: typescript
      file: packages/core/src/collab/anchor.ts
    - scanner: typescript
      file: packages/core/src/collab/presence.ts
    - scanner: typescript
      file: packages/core/src/collab/index.ts
    - scanner: typescript
      file: packages/core/src/collab/field-conflict.ts
    - scanner: typescript
      file: packages/core/src/collab/receipts.ts
description: Declares collaboration command contracts (presence, receipts, suggestions, free-busy) and their agent risk classes.
---
