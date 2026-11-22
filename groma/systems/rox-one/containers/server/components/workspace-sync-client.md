---
type: C4 Component
title: Client
status: stable
groma:
  id: workspace-sync-client
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/workspace-sync/client.ts
    - scanner: typescript
      file: packages/server-core/src/workspace-sync/realtime.ts
    - scanner: typescript
      file: packages/server-core/src/workspace-sync/outbox.ts
    - scanner: typescript
      file: packages/server-core/src/workspace-sync/index.ts
description: Posts workspace command envelopes over HTTP and drains a persistent outbox with backoff.
---
