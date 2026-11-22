---
type: C4 Component
title: Index
status: stable
groma:
  id: local-ipc-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/local-ipc/index.ts
    - scanner: typescript
      file: packages/shared/src/local-ipc/framing.ts
description: Barrel re-exporting the length-prefixed JSON framing codec for ROX helper processes.
---
