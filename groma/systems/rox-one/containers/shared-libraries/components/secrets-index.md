---
type: C4 Component
title: Index
status: stable
groma:
  id: secrets-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/secrets/index.ts
    - scanner: typescript
      file: packages/shared/src/secrets/runtime.ts
    - scanner: typescript
      file: packages/shared/src/secrets/availability.ts
    - scanner: typescript
      file: packages/shared/src/secrets/chain.ts
    - scanner: typescript
      file: packages/shared/src/secrets/redact.ts
    - scanner: typescript
      file: packages/shared/src/secrets/types.ts
description: Exports scoped secret providers, spawn-time resolution, redaction and Infisical availability diagnostics.
---
