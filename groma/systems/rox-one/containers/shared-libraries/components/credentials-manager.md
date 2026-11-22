---
type: C4 Component
title: Manager
status: stable
groma:
  id: credentials-manager
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/credentials/manager.ts
    - scanner: typescript
      file: packages/shared/src/credentials/types.ts
    - scanner: typescript
      file: packages/shared/src/credentials/envelope.ts
    - scanner: typescript
      file: packages/shared/src/credentials/index.ts
    - scanner: typescript
      file: packages/shared/src/credentials/migration.ts
description: Stores and retrieves encrypted credentials through prioritized backends, exposing health and envelope metadata.
---
