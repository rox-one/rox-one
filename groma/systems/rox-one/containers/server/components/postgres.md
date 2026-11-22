---
type: C4 Component
title: Postgres
status: stable
groma:
  id: postgres
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/work/reference/backends/postgres.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/backends/local.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/backends/memory.ts
  technology: Postgres
description: Reads and writes work reference records as Postgres rows with snapshot fallback.
---
