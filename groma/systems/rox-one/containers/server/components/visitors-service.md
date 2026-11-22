---
type: C4 Component
title: Service
status: stable
groma:
  id: visitors-service
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/visitors/service.ts
    - scanner: typescript
      file: packages/server-core/src/visitors/types.ts
    - scanner: typescript
      file: packages/server-core/src/visitors/serial-queue.ts
      symbol: SerialQueue
    - scanner: typescript
      file: packages/server-core/src/visitors/tool-callbacks.ts
      symbol: buildVisitorToolCallbacks
    - scanner: typescript
      file: packages/server-core/src/visitors/index.ts
    - scanner: typescript
      file: packages/server-core/src/visitors/grant-store.ts
    - scanner: typescript
      file: packages/server-core/src/visitors/bootstrap.ts
    - scanner: typescript
      file: packages/server-core/src/visitors/provider.ts
description: Serializes visitor-grant mutations and exposes the visitor-access policy plugin.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/visitors/bootstrap.ts](../../../../../../packages/server-core/src/visitors/bootstrap.ts) | [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | Invokes supplied callback: log | typescript |
