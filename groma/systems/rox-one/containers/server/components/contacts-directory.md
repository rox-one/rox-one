---
type: C4 Component
title: Directory
status: stable
groma:
  id: contacts-directory
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/contacts/directory.ts
    - scanner: typescript
      file: packages/server-core/src/contacts/types.ts
    - scanner: typescript
      file: packages/server-core/src/contacts/index.ts
    - scanner: typescript
      file: packages/server-core/src/contacts/dossier-import.ts
    - scanner: typescript
      file: packages/server-core/src/contacts/store.ts
description: Builds a read-only people directory from server snapshots and organisation memberships.
---
