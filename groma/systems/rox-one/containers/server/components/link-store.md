---
type: C4 Component
title: Link store
status: stable
groma:
  id: link-store
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/entities/link-store.ts
    - scanner: typescript
      file: packages/server-core/src/entities/extract.ts
    - scanner: typescript
      file: packages/server-core/src/entities/acl-gate.ts
    - scanner: typescript
      file: packages/server-core/src/entities/resolver-host.ts
    - scanner: typescript
      file: packages/server-core/src/entities/workbench-flags.ts
    - scanner: typescript
      file: packages/server-core/src/entities/note-links-indexer.ts
  technology: SQLite
description: Stores entity links and backlinks per workspace in a SQLite database.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/entities/note-links-indexer.ts](../../../../../../packages/server-core/src/entities/note-links-indexer.ts) | [packages/server-core/src/handlers/rpc/notes.ts](../../../../../../packages/server-core/src/handlers/rpc/notes.ts) | Invokes supplied callback: notify | typescript |
