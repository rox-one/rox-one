---
type: C4 Component
title: Registry
status: stable
groma:
  id: nodes-registry
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/nodes/registry.ts
    - scanner: typescript
      file: packages/server-core/src/nodes/presence.ts
    - scanner: typescript
      file: packages/server-core/src/nodes/index.ts
    - scanner: typescript
      file: packages/server-core/src/nodes/pending-invokes.ts
    - scanner: typescript
      file: packages/server-core/src/nodes/node-client.ts
description: Tracks connected nodes, enforcing server allowlists, presence TTLs and invoke fencing.
---
