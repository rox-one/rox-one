---
type: C4 Component
title: Runner omp
status: stable
groma:
  id: runner-omp
  parent: cloud-gateway
  code:
    - scanner: javascript
      file: apps/cloud-gateway/src/runner-omp.mjs
      symbol: runSubtask
    - scanner: typescript
      file: apps/cloud-gateway/src/index.ts
    - scanner: typescript
      file: apps/cloud-gateway/src/run-do.ts
      symbol: RunAgent
    - scanner: javascript
      file: apps/cloud-gateway/src/runner.mjs
description: Runs cloud research subtasks through omp sessions and writes done/fail markers.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/cloud-gateway/src/index.ts](../../../../../../apps/cloud-gateway/src/index.ts) | [cloudflare](../../../../../externals/cloudflare.md) | Runs cloud runs | Workers |
