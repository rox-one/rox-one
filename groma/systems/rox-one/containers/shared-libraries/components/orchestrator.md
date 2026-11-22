---
type: C4 Component
title: Orchestrator
status: stable
groma:
  id: orchestrator
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/orchestrator.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/snapshot.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/identity.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/index.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/broker-server.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/broker-client.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/key.ts
    - scanner: typescript
      file: packages/cloud-runner/src/handoff/types.ts
  technology: Daytona
description: Packages a local snapshot, creates a Daytona sandbox, starts the Rox session server and returns a gated cloud URL.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/cloud-runner/src/handoff/orchestrator.ts](../../../../../../packages/cloud-runner/src/handoff/orchestrator.ts) | [packages/server-core/src/handlers/rpc/cloud-handoff.ts](../../../../../../packages/server-core/src/handlers/rpc/cloud-handoff.ts) | Invokes supplied callback: onProgress | typescript |
