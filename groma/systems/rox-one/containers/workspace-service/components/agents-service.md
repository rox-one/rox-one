---
type: C4 Component
title: Service
status: stable
groma:
  id: agents-service
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/agents/service.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/agents/audit-log.ts
description: Composes the agent governance pipeline, audit log and approval runtime.
---
