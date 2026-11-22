---
type: C4 Component
title: UnfurlCore
status: stable
groma:
  id: unfurlcore
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/workers/unfurlCore.ts
    - scanner: typescript
      file: packages/browser-intel/src/workers/unfurlWorker.ts
description: Pure bounded URL decoder that builds the parent/child token graph for the unfurl worker.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/browser-intel/src/workers/unfurlWorker.ts](../../../../../../packages/browser-intel/src/workers/unfurlWorker.ts) | [apps/electron/src/main/browser-intel/worker.ts](../../../../../../apps/electron/src/main/browser-intel/worker.ts) | Invokes supplied callbacks: dbPathFromWorkerData, post | typescript |
