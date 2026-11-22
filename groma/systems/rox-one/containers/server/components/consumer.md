---
type: C4 Component
title: Consumer
status: stable
groma:
  id: consumer
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/rules/consumer.ts
    - scanner: typescript
      file: packages/server-core/src/rules/command-module.ts
    - scanner: typescript
      file: packages/server-core/src/rules/engine.ts
    - scanner: typescript
      file: packages/server-core/src/rules/store.ts
    - scanner: typescript
      file: packages/server-core/src/rules/wiring.ts
    - scanner: typescript
      file: packages/server-core/src/rules/index.ts
    - scanner: typescript
      file: packages/server-core/src/rules/host.ts
    - scanner: typescript
      file: packages/server-core/src/rules/settings.ts
description: Runs the local rule engine over committed workspace events while the rules flag is on.
---
