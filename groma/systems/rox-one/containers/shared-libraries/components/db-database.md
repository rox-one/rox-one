---
type: C4 Component
title: Database
status: stable
groma:
  id: db-database
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/db/database.ts
    - scanner: typescript
      file: packages/browser-intel/src/db/repositories.ts
    - scanner: typescript
      file: packages/browser-intel/src/db/index.ts
  technology: SQLite
description: Opens the browser-intel SQLite database in WAL mode and applies the packaged schema.
---
