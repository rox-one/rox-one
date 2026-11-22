---
type: C4 Component
title: Goals migration
status: stable
groma:
  id: goals-migration
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/work/migrations/goals-migration.ts
description: Migrates project OKR and roadmap files into local work records idempotently.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/work/migrations/goals-migration.ts](../../../../../../packages/server-core/src/work/migrations/goals-migration.ts) | [packages/server-core/src/work/reference/module.ts](../../../../../../packages/server-core/src/work/reference/module.ts) | Invokes supplied callbacks: isFlagEnabled, now | typescript |
