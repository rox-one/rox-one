---
type: C4 Component
title: Server spawner
status: stable
groma:
  id: server-spawner
  parent: cli
  code:
    - scanner: typescript
      file: apps/cli/src/server-spawner.ts
    - scanner: typescript
      file: apps/cli/src/keeper.ts
    - scanner: typescript
      file: apps/cli/src/index.ts
    - scanner: typescript
      file: apps/cli/src/client.ts
  technology: Bun
description: Spawns a headless ROX server child process and captures its URL and token.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/cli/src/index.ts](../../../../../../apps/cli/src/index.ts) | [packages/server-core/src/index.ts](../../../../../../packages/server-core/src/index.ts) | Drives sessions | RPC |
| [apps/cli/src/keeper.ts](../../../../../../apps/cli/src/keeper.ts) | [packages/shared/src/protocol/index.ts](../../../../../../packages/shared/src/protocol/index.ts) | Uses shared protocol | TypeScript imports |
