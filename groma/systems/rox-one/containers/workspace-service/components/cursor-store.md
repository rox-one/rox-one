---
type: C4 Component
title: Cursor store
status: stable
groma:
  id: cursor-store
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/realtime/cursor-store.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/realtime/handlers.ts
      symbol: registerRealtimeHandlers
    - scanner: typescript
      file: apps/workspace-service/src/modules/realtime/gateway.ts
  technology: PostgreSQL
description: Persists per-device realtime subscription cursors so clients can resume streams.
---
