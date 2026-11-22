---
type: C4 Component
title: Scheduler
status: stable
groma:
  id: scheduler
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/scheduler/scheduler.ts
    - scanner: typescript
      file: packages/server-core/src/scheduler/cron-expr.ts
    - scanner: typescript
      file: packages/server-core/src/scheduler/index.ts
    - scanner: typescript
      file: packages/server-core/src/scheduler/hooks-http.ts
    - scanner: typescript
      file: packages/server-core/src/scheduler/hooks.ts
    - scanner: typescript
      file: packages/server-core/src/scheduler/hooks-node.ts
description: Owns one host timer that runs cron jobs and dispatches named hook events.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/scheduler/hooks-http.ts](../../../../../../packages/server-core/src/scheduler/hooks-http.ts) | [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | Invokes supplied callback: warn | typescript |
