---
type: C4 Component
title: Storage
status: stable
groma:
  id: chat-folders-storage
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/chat-folders/storage.ts
    - scanner: typescript
      file: packages/shared/src/chat-folders/ops.ts
    - scanner: typescript
      file: packages/shared/src/chat-folders/index.ts
    - scanner: typescript
      file: packages/shared/src/chat-folders/types.ts
description: Loads and atomically mutates the workspace chat-folders.json mapping sessions to folders, pruning stale assignments.
---
