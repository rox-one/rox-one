---
type: C4 Component
title: Writer lock
status: stable
groma:
  id: writer-lock
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/state/writer-lock.ts
    - scanner: typescript
      file: packages/server-core/src/state/state-store.ts
    - scanner: typescript
      file: packages/server-core/src/state/sessions-projection.ts
    - scanner: typescript
      file: packages/server-core/src/state/write-queue.ts
  technology: SQLite
description: Enforces single-writer ownership of the unified SQLite state database across processes.
---
