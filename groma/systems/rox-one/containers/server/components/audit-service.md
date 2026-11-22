---
type: C4 Component
title: Audit service
status: stable
groma:
  id: audit-service
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/openclaw/audit-service.ts
    - scanner: typescript
      file: packages/server-core/src/openclaw/runtime-manager.ts
    - scanner: typescript
      file: packages/server-core/src/openclaw/persistence.ts
    - scanner: typescript
      file: packages/server-core/src/openclaw/index.ts
    - scanner: typescript
      file: packages/server-core/src/openclaw/collectors.ts
    - scanner: typescript
      file: packages/server-core/src/openclaw/runtime-config.ts
  technology: OpenClaw
description: Aggregates OpenClaw security findings into domain summaries and snapshots.
---
