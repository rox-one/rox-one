---
type: C4 Component
title: Store
status: stable
groma:
  id: canvas-relay-src-store
  parent: canvas-relay
  code:
    - scanner: typescript
      file: packages/canvas-relay/src/store.ts
      symbol: RoomStore
    - scanner: typescript
      file: packages/canvas-relay/src/server.ts
    - scanner: typescript
      file: packages/canvas-relay/src/index.ts
    - scanner: typescript
      file: packages/canvas-relay/src/main.ts
    - scanner: typescript
      file: packages/canvas-relay/src/auth.ts
description: Persists Yjs room updates and compacted snapshots in SQLite for the canvas relay.
---
