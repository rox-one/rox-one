---
type: C4 Component
title: Collections
status: stable
groma:
  id: collections
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/work/reference/collections.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/types.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/engine.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/ops.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/index.ts
    - scanner: typescript
      file: packages/server-core/src/work/reference/module.ts
  technology: Postgres
description: Maps each work record type to its entity kind, Postgres table and local directory.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/work/reference/ops.ts](../../../../../../packages/server-core/src/work/reference/ops.ts) | [packages/server-core/src/work/reference/specs/docs.ts](../../../../../../packages/server-core/src/work/reference/specs/docs.ts) | Invokes supplied callback: defaults | typescript |
| [packages/server-core/src/work/reference/ops.ts](../../../../../../packages/server-core/src/work/reference/ops.ts) | [packages/server-core/src/work/reference/specs/goals.ts](../../../../../../packages/server-core/src/work/reference/specs/goals.ts) | Invokes supplied callback: defaults | typescript |
| [packages/server-core/src/work/reference/ops.ts](../../../../../../packages/server-core/src/work/reference/ops.ts) | [packages/server-core/src/work/reference/specs/tasks.ts](../../../../../../packages/server-core/src/work/reference/specs/tasks.ts) | Invokes supplied callback: defaults | typescript |
| [packages/server-core/src/work/reference/ops.ts](../../../../../../packages/server-core/src/work/reference/ops.ts) | [packages/server-core/src/work/reference/specs/workspace.ts](../../../../../../packages/server-core/src/work/reference/specs/workspace.ts) | Invokes supplied callback: defaults | typescript |
