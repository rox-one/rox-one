---
type: C4 Component
title: Outbox
status: stable
groma:
  id: account-replica-outbox
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/account-replica/outbox.ts
    - scanner: typescript
      file: packages/shared/src/account-replica/types.ts
    - scanner: typescript
      file: packages/shared/src/account-replica/replica.ts
    - scanner: typescript
      file: packages/shared/src/account-replica/index.ts
    - scanner: typescript
      file: packages/shared/src/account-replica/crypto.ts
  technology: SQLite
description: Stores a durable encrypted outbox of account-replica operations awaiting server acknowledgement.
---
