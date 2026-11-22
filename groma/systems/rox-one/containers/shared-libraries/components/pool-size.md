---
type: C4 Component
title: Pool size
status: stable
groma:
  id: pool-size
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/workers/pool-size.ts
    - scanner: typescript
      file: packages/shared/src/workers/pool.ts
    - scanner: typescript
      file: packages/shared/src/workers/handlers.ts
    - scanner: typescript
      file: packages/shared/src/workers/worker-runtime.ts
    - scanner: typescript
      file: packages/shared/src/workers/limit.ts
    - scanner: typescript
      file: packages/shared/src/workers/index.ts
    - scanner: typescript
      file: packages/shared/src/workers/pool.worker.ts
description: Computes the shared worker pool size from available parallelism, low-power mode and environment override.
---
