---
type: C4 Component
title: Storage
status: stable
groma:
  id: orgs-storage
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/orgs/storage.ts
    - scanner: typescript
      file: packages/shared/src/orgs/index.ts
    - scanner: typescript
      file: packages/shared/src/orgs/types.ts
description: Persists organizations, members and expiring invites in the local orgs.json config file.
---
