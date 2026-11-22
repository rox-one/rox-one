---
type: C4 Component
title: Model
status: stable
groma:
  id: src-meetings-model
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/meetings/model.ts
    - scanner: typescript
      file: packages/core/src/meetings/rpc.ts
    - scanner: typescript
      file: packages/core/src/meetings/index.ts
    - scanner: typescript
      file: packages/core/src/meetings/schemas.ts
description: Defines meeting-agent domain types, statuses, transcript sources and proposal lifecycle without performing I/O.
---
