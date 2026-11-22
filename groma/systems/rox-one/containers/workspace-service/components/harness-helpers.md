---
type: C4 Component
title: Harness helpers
status: stable
groma:
  id: harness-helpers
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/test/harness-helpers.ts
    - scanner: typescript
      file: apps/workspace-service/test/helpers.ts
description: Provides temporary-home and Postgres fixture helpers for workspace-service tests.
---
