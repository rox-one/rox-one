---
type: C4 Component
title: Migrations
status: stable
groma:
  id: database-migrations
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/database/migrations.ts
description: Loads and applies checksummed PostgreSQL schema migrations under an advisory lock.
---
