---
type: C4 Component
title: Router
status: stable
groma:
  id: commands-router
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/commands/router.ts
    - scanner: typescript
      file: packages/server-core/src/commands/index.ts
    - scanner: typescript
      file: packages/server-core/src/commands/registry.ts
    - scanner: typescript
      file: packages/server-core/src/commands/ping.ts
    - scanner: typescript
      file: packages/server-core/src/commands/flags.ts
    - scanner: typescript
      file: packages/server-core/src/commands/store.ts
    - scanner: typescript
      file: packages/server-core/src/commands/local-store.ts
    - scanner: typescript
      file: packages/server-core/src/commands/notify.ts
      symbol: NOTIFY_COMMAND_MODULE
    - scanner: typescript
      file: packages/server-core/src/commands/event-bus.ts
    - scanner: typescript
      file: packages/server-core/src/commands/executor.ts
description: Routes command envelopes to local, workspace or target authority with pre-queue validation.
---
