---
type: C4 Component
title: Index
status: stable
groma:
  id: observability-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/observability/index.ts
    - scanner: typescript
      file: packages/server-core/src/observability/rpc-call-counter.ts
description: Barrel re-exporting the RPC call counter and perf-trace helpers.
---
