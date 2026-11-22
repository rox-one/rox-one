---
type: C4 Component
title: Install
status: stable
groma:
  id: graph-install
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/memory/graph/install.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/cognee-provider.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/cost-cap.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/cognee-runtime.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/ingest.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/one-time-import.ts
    - scanner: typescript
      file: packages/server-core/src/memory/graph/cognee-node.ts
  technology: cognee
description: Registers the cognee graph-memory provider with the memory index service.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/memory/graph/install.ts](../../../../../../packages/server-core/src/memory/graph/install.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callbacks: info, warn | typescript |
| [packages/server-core/src/memory/graph/install.ts](../../../../../../packages/server-core/src/memory/graph/install.ts) | [packages/server/src/index.ts](../../../../../../packages/server/src/index.ts) | Invokes supplied callbacks: info, warn | typescript |
| [packages/server-core/src/memory/graph/one-time-import.ts](../../../../../../packages/server-core/src/memory/graph/one-time-import.ts) | [packages/server-core/src/handlers/rpc/memory.ts](../../../../../../packages/server-core/src/handlers/rpc/memory.ts) | Invokes supplied callback: warn | typescript |
