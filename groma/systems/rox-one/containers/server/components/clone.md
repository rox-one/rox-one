---
type: C4 Component
title: Clone
status: stable
groma:
  id: clone
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/devspace/clone.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/tool-runtime.ts
      symbol: createDevSpaceToolRuntime
    - scanner: typescript
      file: packages/server-core/src/devspace/watch.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/artifacts.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/publish-port.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/runner.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/runs.ts
  technology: git
description: Clones and fetches Dev Space repositories over git with token-safe askpass handling.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/devspace/runner.ts](../../../../../../packages/server-core/src/devspace/runner.ts) | [packages/server-core/src/handlers/rpc/dev-space.ts](../../../../../../packages/server-core/src/handlers/rpc/dev-space.ts) | Invokes supplied callback: audit | typescript |
