---
type: C4 Component
title: Omp
status: stable
groma:
  id: omp
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/backend/internal/drivers/omp.ts
      symbol: ompDriver
    - scanner: typescript
      file: packages/shared/src/agent/backend/internal/drivers/anthropic.ts
      symbol: anthropicDriver
    - scanner: typescript
      file: packages/shared/src/agent/backend/internal/drivers/pi.ts
description: Backend driver that launches the OMP CLI subprocess and supplies no extra runtime payload.
---
