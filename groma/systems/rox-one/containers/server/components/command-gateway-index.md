---
type: C4 Component
title: Index
status: stable
groma:
  id: command-gateway-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/command-gateway/index.ts
    - scanner: typescript
      file: packages/server-core/src/command-gateway/pending-commands.ts
description: Barrel re-exporting the pending-commands gateway module.
---
