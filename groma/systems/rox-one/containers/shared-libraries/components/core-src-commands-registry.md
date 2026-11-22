---
type: C4 Component
title: Registry
status: stable
groma:
  id: core-src-commands-registry
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/commands/registry.ts
    - scanner: typescript
      file: packages/core/src/commands/receipt.ts
    - scanner: typescript
      file: packages/core/src/commands/authorizer.ts
    - scanner: typescript
      file: packages/core/src/commands/errors.ts
    - scanner: typescript
      file: packages/core/src/commands/index.ts
    - scanner: typescript
      file: packages/core/src/commands/pipeline.ts
    - scanner: typescript
      file: packages/core/src/commands/client.ts
    - scanner: typescript
      file: packages/core/src/commands/envelope.ts
description: Registers domain command definitions, binds schemas and handlers, and derives capability availability.
---
