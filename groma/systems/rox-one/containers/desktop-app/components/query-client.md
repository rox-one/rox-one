---
type: C4 Component
title: Client
status: stable
groma:
  id: query-client
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/client.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/workspace-work-revision.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/notes-cache.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/shared-read.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/persist.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/keys.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/event-bridge.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/query/runtime.ts
      symbol: startRoxQueryRuntime
  technology: TanStack Query
description: Creates the renderer's single TanStack Query client with long GC and stale-while-revalidate reads.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/lib/query/shared-read.ts](../../../../../../apps/electron/src/renderer/lib/query/shared-read.ts) | [apps/electron/src/renderer/lib/shell-warmup.ts](../../../../../../apps/electron/src/renderer/lib/shell-warmup.ts) | Invokes supplied callback: replaces | typescript |
| [apps/electron/src/renderer/lib/query/shared-read.ts](../../../../../../apps/electron/src/renderer/lib/query/shared-read.ts) | [apps/electron/src/renderer/lib/useWorkspaceWork.ts](../../../../../../apps/electron/src/renderer/lib/useWorkspaceWork.ts) | Invokes supplied callback: replaces | typescript |
